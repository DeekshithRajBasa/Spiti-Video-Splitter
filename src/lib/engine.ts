import { CANVAS_RATIOS } from '../defaults'
import { store } from '../store'
import type { MediaItem, Project } from '../types'
import { renderFrame, type Drawable } from './render'
import { cancelFastExport } from './fastExport'
import { outToSource, totalDuration } from './timeline'

type El = HTMLVideoElement | HTMLImageElement | HTMLAudioElement

export function canvasSize(p: Project, longSide: number): [number, number] {
  const [a, b] = CANVAS_RATIOS[p.canvas]
  // Resolution refers to the short side (1080 → 1080×1920), like social presets.
  const short = longSide
  let w: number
  let h: number
  if (a <= b) {
    w = short
    h = Math.round((short * b) / a)
  } else {
    h = short
    w = Math.round((short * a) / b)
  }
  return [w - (w % 2), h - (h % 2)]
}

interface ExportJob {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  recorder: MediaRecorder
  chunks: Blob[]
  cancelled: boolean
  resolve: (b: Blob | null) => void
  mime: string
}

class Engine {
  els = new Map<string, El>()
  outTime = 0
  srcTime = 0
  playing = false
  private segIndex = 0
  private listeners = new Set<() => void>()
  private preview: HTMLCanvasElement | null = null
  private raf = 0
  private actx: AudioContext | null = null
  private monitor: GainNode | null = null
  private bus: GainNode | null = null
  private recDest: MediaStreamAudioDestinationNode | null = null
  private gains = new Map<string, GainNode>()
  private buffers = new Map<string, AudioBuffer>()
  private lastTickOut = 0
  private job: ExportJob | null = null
  private dirty = true

  constructor() {
    const loop = () => {
      this.tick()
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
    store.subscribe(() => {
      this.syncElements()
      this.dirty = true
    })
  }

  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  setPreview(c: HTMLCanvasElement | null) {
    this.preview = c
    this.dirty = true
  }

  get project() {
    return store.get().project
  }
  get duration() {
    return totalDuration(this.project.segments)
  }
  masterId() {
    return this.project.slots[0].sourceId
  }
  master(): HTMLVideoElement | null {
    const id = this.masterId()
    const el = id ? this.els.get(id) : undefined
    return el instanceof HTMLVideoElement ? el : null
  }

  /** Create/destroy elements to match the media library. */
  private syncElements() {
    const media = store.get().media
    for (const m of Object.values(media)) {
      if (this.els.has(m.id)) continue
      let el: El
      if (m.kind === 'image') {
        const img = new Image()
        img.src = m.url
        img.onload = () => (this.dirty = true)
        el = img
      } else {
        const v = m.kind === 'video' ? document.createElement('video') : document.createElement('audio')
        v.src = m.url
        v.preload = 'auto'
        if (v instanceof HTMLVideoElement) v.playsInline = true
        v.crossOrigin = 'anonymous'
        v.addEventListener('seeked', () => (this.dirty = true))
        v.addEventListener('loadeddata', () => (this.dirty = true))
        el = v
      }
      this.els.set(m.id, el)
    }
    for (const [id, el] of this.els) {
      if (!media[id]) {
        if (!(el instanceof HTMLImageElement)) el.pause()
        this.els.delete(id)
      }
    }
  }

  getSource = (id: string | null): Drawable | null => {
    if (!id) return null
    const el = this.els.get(id)
    if (!el || el instanceof HTMLAudioElement) return null
    return el
  }

  /* ---------- audio graph ---------- */

  private ensureAudio() {
    if (this.actx) {
      if (this.actx.state === 'suspended') void this.actx.resume()
      return
    }
    const Ctx = window.AudioContext
    this.actx = new Ctx()
    this.bus = this.actx.createGain()
    this.monitor = this.actx.createGain()
    this.recDest = this.actx.createMediaStreamDestination()
    this.bus.connect(this.monitor)
    this.monitor.connect(this.actx.destination)
    this.bus.connect(this.recDest)
  }

  private gainFor(id: string): GainNode | null {
    if (!this.actx || !this.bus) return null
    let g = this.gains.get(id)
    if (g) return g
    const el = this.els.get(id)
    if (!el || el instanceof HTMLImageElement) return null
    const src = this.actx.createMediaElementSource(el)
    el.volume = 1
    el.muted = false
    g = this.actx.createGain()
    src.connect(g)
    g.connect(this.bus)
    this.gains.set(id, g)
    return g
  }

  async loadBuffer(m: MediaItem) {
    if (this.buffers.has(m.id)) return
    try {
      const data = await m.file.arrayBuffer()
      const ctx = this.actx ?? new OfflineAudioContext(1, 1, 44100)
      const buf = await ctx.decodeAudioData(data)
      this.buffers.set(m.id, buf)
    } catch {
      /* undecodable */
    }
  }

  private musicVolume(t: number) {
    const m = this.project.music
    const d = this.duration
    if (this.project.tracks.music.muted) return 0
    if (m.riser > 0 && t > d - m.riser) {
      const p = Math.min(1, (t - (d - m.riser)) / m.riser)
      return m.volume + (m.peakVolume - m.volume) * p * p
    }
    return m.volume
  }

  private applyAudio() {
    const p = this.project
    const mid = this.masterId()
    if (mid) {
      const g = this.gainFor(mid)
      const v = p.tracks.video.muted ? 0 : p.sourceVolume
      if (g) g.gain.value = v
      else {
        const el = this.master()
        if (el) el.volume = Math.min(1, v)
      }
    }
    // Secondary cameras stay silent so the voice isn't doubled.
    for (const s of p.slots.slice(1)) {
      if (s.sourceId && s.sourceId !== mid) {
        const el = this.els.get(s.sourceId)
        if (el instanceof HTMLVideoElement) el.muted = true
      }
    }
    if (p.music.mediaId) {
      const g = this.gainFor(p.music.mediaId)
      const v = this.musicVolume(this.outTime)
      if (g) g.gain.value = v
      else {
        const el = this.els.get(p.music.mediaId)
        if (el instanceof HTMLAudioElement) el.volume = Math.min(1, v)
      }
    }
  }

  private fireSfx(from: number, to: number) {
    const p = this.project
    if (!this.actx || !this.bus || p.tracks.sfx.muted) return
    for (const s of p.sfx) {
      if (s.at > from && s.at <= to) {
        const buf = this.buffers.get(s.mediaId)
        if (!buf) continue
        const src = this.actx.createBufferSource()
        src.buffer = buf
        const g = this.actx.createGain()
        g.gain.value = s.volume
        src.connect(g)
        g.connect(this.bus)
        src.start()
      }
    }
  }

  /* ---------- transport ---------- */

  private syncSecondary(force: boolean) {
    const p = this.project
    const mid = this.masterId()
    for (const s of p.slots.slice(1)) {
      if (!s.sourceId || s.sourceId === mid) continue
      const el = this.els.get(s.sourceId)
      if (!(el instanceof HTMLVideoElement)) continue
      const target = Math.min(this.srcTime, Math.max(0, (el.duration || 0) - 0.05))
      if (force || Math.abs(el.currentTime - target) > 0.25) el.currentTime = target
      if (this.playing && el.paused && this.srcTime < (el.duration || 0)) void el.play().catch(() => {})
      if (!this.playing && !el.paused) el.pause()
    }
    const music = p.music.mediaId ? this.els.get(p.music.mediaId) : null
    if (music instanceof HTMLAudioElement) {
      const target = this.outTime + p.music.offset
      const inRange = target >= 0 && target < (music.duration || Infinity)
      if (force || Math.abs(music.currentTime - target) > 0.3) {
        if (inRange) music.currentTime = Math.max(0, target)
      }
      if (this.playing && music.paused && inRange) void music.play().catch(() => {})
      if ((!this.playing || !inRange) && !music.paused) music.pause()
    }
  }

  seek(out: number) {
    const segs = this.project.segments
    const d = this.duration
    out = Math.max(0, Math.min(out, d))
    this.outTime = out
    this.lastTickOut = out
    const { index, src } = outToSource(segs, out)
    this.segIndex = Math.max(0, index)
    this.srcTime = src
    const m = this.master()
    if (m) m.currentTime = src
    this.syncSecondary(true)
    this.dirty = true
    this.emit()
  }

  play() {
    const m = this.master()
    if (!m || this.duration <= 0) return
    this.ensureAudio()
    if (this.outTime >= this.duration - 0.05) this.seek(0)
    this.playing = true
    this.applyAudio()
    void m.play().catch(() => {
      this.playing = false
      this.emit()
    })
    this.syncSecondary(true)
    this.emit()
  }

  pause() {
    this.playing = false
    this.master()?.pause()
    this.syncSecondary(false)
    this.emit()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  step(frames: number) {
    this.pause()
    this.seek(this.outTime + frames / this.project.export.fps)
  }

  private tick() {
    const p = this.project
    const segs = p.segments
    const m = this.master()
    if (this.playing && m && segs.length) {
      let seg = segs[this.segIndex]
      if (!seg) {
        this.segIndex = 0
        seg = segs[0]
      }
      const ct = m.currentTime
      if (ct >= seg.end - 0.01 || m.ended) {
        if (this.segIndex < segs.length - 1) {
          this.segIndex++
          m.currentTime = segs[this.segIndex].start
          this.srcTime = segs[this.segIndex].start
        } else {
          this.outTime = this.duration
          this.srcTime = seg.end
          this.pause()
          if (this.job) this.finishExport()
        }
      } else if (ct < seg.start - 0.25) {
        m.currentTime = seg.start
      } else {
        this.srcTime = Math.max(seg.start, ct)
      }
      let acc = 0
      for (let i = 0; i < this.segIndex; i++) acc += segs[i].end - segs[i].start
      const out = acc + (this.srcTime - seg.start)
      if (this.playing) {
        this.fireSfx(this.lastTickOut, out)
        this.lastTickOut = out
        this.outTime = out
      }
      this.syncSecondary(false)
      this.applyAudio()
      this.dirty = true
      this.emit()
    }

    if (this.job && !this.job.cancelled) {
      const d = this.duration
      renderFrame(this.job.ctx, this.job.canvas.width, this.job.canvas.height, this.input())
      store.ui({ exporting: { progress: d ? this.outTime / d : 0, status: 'Rendering' } })
    }

    if (this.preview && (this.dirty || this.playing)) {
      const c = this.preview
      const ctx = c.getContext('2d')
      if (ctx) renderFrame(ctx, c.width, c.height, this.input())
      // Keep re-rendering while fonts/frames load.
      this.dirty = !this.playing && performance.now() < (this.warmUntil ?? 0)
    }
  }
  private warmUntil = performance.now() + 3000
  invalidate() {
    this.dirty = true
    this.warmUntil = performance.now() + 600
  }

  input() {
    const s = store.get()
    return {
      project: s.project,
      media: s.media,
      getSource: this.getSource,
      outTime: this.outTime,
      srcTime: this.srcTime,
      duration: this.duration,
    }
  }

  /** Capture the current frame at full export resolution. */
  snapshot(): Promise<Blob | null> {
    const [w, h] = canvasSize(this.project, this.project.export.resolution)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    renderFrame(c.getContext('2d')!, w, h, this.input())
    return new Promise((r) => c.toBlob(r, 'image/png'))
  }

  /* ---------- export ---------- */

  static pickMime(): string {
    const types = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ]
    return types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? ''
  }

  async export(): Promise<{ blob: Blob; ext: string } | null> {
    const p = this.project
    if (!this.master() || this.duration <= 0) return null
    this.pause()
    this.ensureAudio()
    // Route every audible element through the graph before recording.
    const mid = this.masterId()
    if (mid) this.gainFor(mid)
    if (p.music.mediaId) this.gainFor(p.music.mediaId)
    for (const s of p.sfx) {
      const m = store.get().media[s.mediaId]
      if (m) await this.loadBuffer(m)
    }
    const [w, h] = canvasSize(p, p.export.resolution)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    const mime = Engine.pickMime()
    const stream = canvas.captureStream(p.export.fps)
    this.recDest?.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    const recorder = new MediaRecorder(stream, {
      mimeType: mime || undefined,
      videoBitsPerSecond: p.export.bitrate * 1_000_000 * (p.export.resolution / 1080) ** 2,
      audioBitsPerSecond: 192_000,
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

    this.seek(0)
    const m = this.master()!
    await new Promise<void>((r) => {
      if (m.readyState >= 2 && !m.seeking) r()
      else m.addEventListener('seeked', () => r(), { once: true })
    })
    if (this.monitor) this.monitor.gain.value = 0
    renderFrame(ctx, w, h, this.input())
    const blob = await new Promise<Blob | null>((resolve) => {
      this.job = { canvas, ctx, recorder, chunks, cancelled: false, resolve, mime }
      recorder.onstop = () => {
        const job = this.job
        this.job = null
        if (this.monitor) this.monitor.gain.value = 1
        if (!job || job.cancelled) resolve(null)
        else resolve(new Blob(chunks, { type: mime || 'video/webm' }))
      }
      recorder.start(500)
      this.play()
    })
    store.ui({ exporting: null })
    if (!blob) return null
    return { blob, ext: mime.includes('mp4') ? 'mp4' : 'webm' }
  }

  private finishExport() {
    const job = this.job
    if (!job) return
    store.ui({ exporting: { progress: 1, status: 'Finalizing' } })
    // Let the last frames flush.
    setTimeout(() => job.recorder.state !== 'inactive' && job.recorder.stop(), 250)
  }

  cancelExport() {
    cancelFastExport()
    if (!this.job) return
    this.job.cancelled = true
    this.pause()
    if (this.job.recorder.state !== 'inactive') this.job.recorder.stop()
    store.ui({ exporting: null })
  }

  destroy() {
    cancelAnimationFrame(this.raf)
  }
}

export const engine = new Engine()

export const pickMime = () => Engine.pickMime()
