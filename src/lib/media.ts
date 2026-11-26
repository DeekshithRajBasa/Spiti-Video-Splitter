import { uid } from '../defaults'
import { store } from '../store'
import type { MediaItem, MediaKind } from '../types'
import { desktop, type DiskFile } from './desktop'

function kindOf(f: File): MediaKind | null {
  if (f.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)) return 'video'
  if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name)) return 'image'
  if (f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(f.name)) return 'audio'
  return null
}

function loadMeta(url: string, kind: MediaKind): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (kind === 'image') {
      const img = new Image()
      img.onload = () => resolve({ duration: 0, width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error('Could not read image'))
      img.src = url
      return
    }
    const el = document.createElement(kind === 'video' ? 'video' : 'audio')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement
      resolve({ duration: el.duration, width: v.videoWidth || 0, height: v.videoHeight || 0 })
    }
    el.onerror = () => reject(new Error('This browser cannot decode that file'))
    el.src = url
  })
}

async function makeThumbs(url: string, duration: number, count = 12): Promise<string[]> {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = url
  await new Promise<void>((r, j) => {
    v.onloadeddata = () => r()
    v.onerror = () => j(new Error('thumb'))
  })
  const c = document.createElement('canvas')
  const h = 90
  c.height = h
  c.width = Math.round((h * v.videoWidth) / v.videoHeight) || 160
  const ctx = c.getContext('2d')!
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const t = Math.min(duration - 0.1, ((i + 0.5) / count) * duration)
    await new Promise<void>((r) => {
      const done = () => r()
      v.addEventListener('seeked', done, { once: true })
      setTimeout(done, 1500)
      v.currentTime = Math.max(0, t)
    })
    ctx.drawImage(v, 0, 0, c.width, c.height)
    out.push(c.toDataURL('image/jpeg', 0.6))
  }
  v.removeAttribute('src')
  v.load()
  return out
}

async function makeWaveform(file: Blob, bars = 400): Promise<number[]> {
  if (file.size > 150 * 1024 * 1024) return []
  const buf = await file.arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 44100)
  const audio = await ctx.decodeAudioData(buf)
  const data = audio.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / bars))
  const out: number[] = []
  for (let i = 0; i < bars; i++) {
    let peak = 0
    for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) peak = Math.max(peak, Math.abs(data[j]))
    out.push(peak)
  }
  const max = Math.max(0.01, ...out)
  return out.map((v) => v / max)
}

export async function importFile(file: File): Promise<MediaItem | null> {
  const kind = kindOf(file)
  if (!kind) return null
  const url = URL.createObjectURL(file)
  const meta = await loadMeta(url, kind)
  const path = desktop?.pathForFile(file) ?? null
  const item: MediaItem = { id: uid(), name: file.name, kind, url, file, path, thumbs: [], waveform: [], ...meta }
  if (kind === 'image') item.thumbs = [url]
  store.addMedia(item)
  if (kind === 'video') {
    makeThumbs(url, meta.duration)
      .then((thumbs) => store.patchMedia(item.id, { thumbs }))
      .catch(() => {})
  }
  if (kind === 'audio' || (kind === 'video' && file.size < 150 * 1024 * 1024)) {
    makeWaveform(file)
      .then((waveform) => store.patchMedia(item.id, { waveform }))
      .catch(() => {})
  }
  return item
}

/** Import a file the desktop app streams from disk (downloads, very large files). */
export async function importDiskFile(d: DiskFile): Promise<MediaItem | null> {
  const kind = kindOf({ name: d.name, type: '' } as File)
  if (!kind) return null
  const meta = await loadMeta(d.url, kind)
  const item: MediaItem = { id: uid(), name: d.name, kind, url: d.url, path: d.file, thumbs: [], waveform: [], ...meta }
  if (kind === 'image') item.thumbs = [d.url]
  store.addMedia(item)
  if (kind === 'video') makeThumbs(d.url, meta.duration).then((thumbs) => store.patchMedia(item.id, { thumbs })).catch(() => {})
  if (kind === 'audio' && d.size < 150 * 1024 * 1024)
    fetch(d.url)
      .then((r) => r.blob())
      .then((b) => makeWaveform(b as File))
      .then((waveform) => store.patchMedia(item.id, { waveform }))
      .catch(() => {})
  return item
}

export function isSubtitle(f: File) {
  return /\.(srt|vtt|ass|ssa)$/i.test(f.name)
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
