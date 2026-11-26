// Desktop fast export: FFmpeg decodes source frames at the exact output frame rate,
// the canvas renderer composes each one, WebCodecs encodes on the GPU, and FFmpeg
// mixes the audio and muxes the final MP4. Faster than real time and frame-accurate.
import { Muxer, StreamTarget } from 'mp4-muxer'
import { store } from '../store'
import type { MediaItem } from '../types'
import { desktop, type MuxJob } from './desktop'
import { canvasSize, engine } from './engine'
import { renderFrame, type Drawable } from './render'

export class ExportCancelled extends Error {}

/** Per-stage timings (ms) of the last export, logged to the console for tuning. */
export const exportProfile = { decode: 0, render: 0, encode: 0, wait: 0, frames: 0 }

let cancelled = false
export function cancelFastExport() {
  cancelled = true
}

interface EncoderChoice {
  config: VideoEncoderConfig
  mux: 'avc' | 'vp9'
  hardware: boolean
}

/** Pick the best encoder: hardware H.264, then software H.264, then VP9 (re-encoded by FFmpeg). */
export async function pickEncoder(width: number, height: number, fps: number, bitrate: number): Promise<EncoderChoice | null> {
  if (typeof VideoEncoder === 'undefined') return null
  const base = { width, height, framerate: fps, bitrate, latencyMode: 'quality' as const }
  const tries: EncoderChoice[] = [
    { config: { ...base, codec: 'avc1.640033', avc: { format: 'avc' }, hardwareAcceleration: 'prefer-hardware' }, mux: 'avc', hardware: true },
    { config: { ...base, codec: 'avc1.4d0033', avc: { format: 'avc' }, hardwareAcceleration: 'prefer-hardware' }, mux: 'avc', hardware: true },
    { config: { ...base, codec: 'avc1.640033', avc: { format: 'avc' } }, mux: 'avc', hardware: false },
    { config: { ...base, codec: 'vp09.00.51.08' }, mux: 'vp9', hardware: false },
  ]
  for (const t of tries) {
    try {
      const r = await VideoEncoder.isConfigSupported(t.config)
      if (r.supported) return t
    } catch {
      /* try the next one */
    }
  }
  return null
}

export function canFastExport(): { ok: boolean; reason?: string } {
  if (!desktop) return { ok: false, reason: 'Fast export needs the desktop app' }
  const s = store.get()
  const id = s.project.slots[0].sourceId
  const m = id ? s.media[id] : null
  if (!m) return { ok: false, reason: 'Add a video first' }
  if (!m.path) return { ok: false, reason: 'The main video has no file path (drag it in from disk)' }
  if (typeof VideoEncoder === 'undefined') return { ok: false, reason: 'This system has no WebCodecs encoder' }
  return { ok: true }
}

const nextFrame = (id: number) =>
  desktop!.decodeNext(id).then((buf) => (buf ? createImageBitmap(new Blob([buf as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })) : null))

/** A small read-ahead queue so JPEG decoding overlaps rendering and encoding. */
class FrameStream {
  private q: Promise<ImageBitmap | null>[] = []
  last: ImageBitmap | null = null
  private done = false
  readonly id: number
  constructor(id: number) {
    this.id = id
    for (let i = 0; i < 3; i++) this.q.push(nextFrame(id))
  }
  async next(): Promise<ImageBitmap | null> {
    if (this.done) return this.last
    const bm = await this.q.shift()!
    this.q.push(nextFrame(this.id))
    if (!bm) {
      // Source ran out (shorter than the segment): hold the last frame.
      this.done = true
      return this.last
    }
    this.last?.close()
    this.last = bm
    return bm
  }
  async stop() {
    await desktop!.decodeStop(this.id)
    for (const p of this.q) void p.then((b) => b?.close()).catch(() => {})
    this.last?.close()
    this.last = null
  }
}

export async function fastExport(output: string, onProgress: (p: number, status: string) => void): Promise<void> {
  const d = desktop!
  cancelled = false
  const { project: p, media } = store.get()
  const master = media[p.slots[0].sourceId!]
  const fps = p.export.fps
  const [W, H] = canvasSize(p, p.export.resolution)
  const bitrate = Math.round(p.export.bitrate * 1_000_000 * Math.max(0.5, (p.export.resolution / 1080) ** 2) * (fps > 30 ? 1.4 : 1))
  const choice = await pickEncoder(W, H, fps, bitrate)
  if (!choice) throw new Error('No video encoder is available on this system')

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false })!

  const temp = await d.tempPath('mp4')
  const fid = await d.openFile(temp)
  const writes: Promise<void>[] = []
  const muxer = new Muxer({
    target: new StreamTarget({
      onData: (data, position) => writes.push(d.write(fid, position, data.slice())),
      chunked: true,
      chunkSize: 4 * 1024 * 1024,
    }),
    video: { codec: choice.mux, width: W, height: H, frameRate: fps },
    fastStart: false,
    firstTimestampBehavior: 'offset',
  })
  let encError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encError = e as Error),
  })
  encoder.configure(choice.config)

  // Decode at the source's own resolution, capped so 4K sources don't slow down a 1080p export.
  const maxHeight = p.export.resolution >= 1440 ? 2160 : 1440
  const secondary = [...new Set(p.slots.slice(1).map((s) => s.sourceId))].filter(
    (id): id is string => !!id && id !== master.id && media[id]?.kind === 'video' && !!media[id].path,
  )
  const total = p.segments.reduce((a, s) => a + Math.max(1, Math.round((s.end - s.start) * fps)), 0)
  const duration = total / fps
  const overrides = new Map<string, Drawable>()
  const getSource = (id: string | null) => (id && overrides.get(id)) || engine.getSource(id)
  const waitQueue = () =>
    new Promise<void>((r) => {
      const t = setTimeout(r, 50)
      encoder.addEventListener('dequeue', () => (clearTimeout(t), r()), { once: true })
    })

  Object.assign(exportProfile, { decode: 0, render: 0, encode: 0, wait: 0, frames: 0 })
  let n = 0
  let segOut = 0
  const started = performance.now()
  try {
    for (const seg of p.segments) {
      const len = seg.end - seg.start
      const frames = Math.max(1, Math.round(len * fps))
      const streams: [string, FrameStream][] = []
      streams.push([master.id, new FrameStream(await d.decodeStart({ file: master.path!, start: seg.start, duration: len, fps, maxHeight }))])
      for (const id of secondary) {
        const m = media[id] as MediaItem
        if (seg.start >= m.duration) continue
        const sid = await d.decodeStart({ file: m.path!, start: seg.start, duration: Math.min(len, m.duration - seg.start), fps, maxHeight })
        streams.push([id, new FrameStream(sid)])
      }
      try {
        for (let j = 0; j < frames; j++) {
          if (cancelled) throw new ExportCancelled('Export cancelled')
          if (encError) throw encError
          let t0 = performance.now()
          const bms = await Promise.all(streams.map(([, s]) => s.next()))
          exportProfile.decode += performance.now() - t0
          t0 = performance.now()
          streams.forEach(([id], i) => (bms[i] ? overrides.set(id, bms[i]!) : overrides.delete(id)))
          renderFrame(ctx, W, H, {
            project: p,
            media,
            getSource,
            outTime: segOut + j / fps,
            srcTime: seg.start + j / fps,
            duration,
          })
          exportProfile.render += performance.now() - t0
          t0 = performance.now()
          const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) })
          encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 })
          frame.close()
          n++
          exportProfile.encode += performance.now() - t0
          t0 = performance.now()
          while (encoder.encodeQueueSize > 6) await waitQueue()
          exportProfile.wait += performance.now() - t0
          exportProfile.frames = n
          if (n % 5 === 0) {
            const secs = (performance.now() - started) / 1000
            const speed = n / fps / Math.max(0.001, secs)
            onProgress((n / total) * 0.92, `Rendering ${speed.toFixed(1)}× speed`)
          }
        }
      } finally {
        await Promise.all(streams.map(([, s]) => s.stop()))
        overrides.clear()
      }
      segOut += frames / fps
    }
    const per = (k: 'decode' | 'render' | 'encode' | 'wait') => (exportProfile[k] / Math.max(1, n)).toFixed(1)
    console.info(`[export] ${n} frames, ms/frame: decode ${per('decode')}, render ${per('render')}, encode ${per('encode')}, queue wait ${per('wait')}; encoder ${choice.config.codec} hw=${choice.hardware}`)
    onProgress(0.92, 'Finishing video')
    await encoder.flush()
    if (encError) throw encError
    muxer.finalize()
    await Promise.all(writes)
  } finally {
    if (encoder.state !== 'closed') encoder.close()
    await d.closeFile(fid)
    if (cancelled || encError) await d.removeFile(temp)
  }

  // Audio: voice cut to the same segments, music with its end riser, and sound effects.
  const job: MuxJob = { video: temp, output, duration, reencode: choice.mux !== 'avc', sfx: [] }
  if (!p.tracks.video.muted && p.sourceVolume > 0) {
    job.voice = { file: master.path!, volume: p.sourceVolume, segments: p.segments.map((s) => ({ start: s.start, end: s.end })) }
  }
  const music = p.music.mediaId ? media[p.music.mediaId] : null
  if (music?.path && !p.tracks.music.muted) {
    job.music = { file: music.path, offset: p.music.offset, volume: p.music.volume, peak: p.music.peakVolume, riser: p.music.riser }
  }
  if (!p.tracks.sfx.muted) {
    for (const s of p.sfx) {
      const m = media[s.mediaId]
      if (m?.path && s.at < duration) job.sfx.push({ file: m.path, at: s.at, volume: s.volume })
    }
  }
  onProgress(0.93, job.reencode ? 'Encoding H.264 and mixing audio' : 'Mixing audio')
  const off = d.onMuxProgress((x) => onProgress(0.93 + 0.07 * x, job.reencode ? 'Encoding H.264 and mixing audio' : 'Mixing audio'))
  try {
    await d.mux(job)
  } finally {
    off()
    await d.removeFile(temp)
  }
  onProgress(1, 'Done')
}
