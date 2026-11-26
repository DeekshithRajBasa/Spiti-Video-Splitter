// Paste-a-link import. Desktop: yt-dlp handles YouTube, Twitch, Kick, X, Instagram,
// TikTok, Facebook, Vimeo and 1,000+ other sites, including live streams. Browser: a
// self-hosted link server (server/) does the same; without one, only direct media links
// work (and only from servers that allow cross-origin downloads).
import { setMaster } from './actions'
import { aiSettings } from './ai/settings'
import { aiStore } from './ai/state'
import { desktop, type LinkInfo } from './desktop'
import { importDiskFile, importFile } from './media'
import type { MediaItem } from '../types'

export interface LinkOptions {
  maxHeight: number
  /** Only download part of a long VOD (seconds). */
  start?: number
  end?: number
  /** Live: record from now, or from the beginning of the stream (YouTube). */
  live?: 'now' | 'start'
  maxMinutes?: number
}

export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())
const DIRECT = /\.(mp4|webm|mov|m4v|mkv|mp3|m4a|wav|ogg)(\?|#|$)/i
export const isDirectMedia = (url: string) => DIRECT.test(url.trim())

/** Can this app fetch YouTube/Twitch-style links? Desktop always; web with a link server. */
export const canImportPlatformLinks = () => !!desktop || !!serverBase()

let currentJob: number | null = null
let serverJob: string | null = null

/* ---------- link server (web) ---------- */

const serverBase = () => aiSettings.get().linkServer.trim().replace(/\/+$/, '')

async function server(path: string, init: RequestInit = {}) {
  const token = aiSettings.get().linkToken.trim()
  const headers: Record<string, string> = { ...(init.body ? { 'Content-Type': 'application/json' } : {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(`${serverBase()}${path}`, { ...init, headers })
  } catch {
    throw new Error(`Couldn't reach the link server at ${serverBase()}. Is it running, and is this site in its ALLOWED_ORIGINS?`)
  }
  if (res.status === 401) throw new Error('The link server rejected the access token (Settings → App).')
  return res
}

async function serverJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await server(path, init)
  const j = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(j.error || `Link server replied ${res.status}`)
  return j
}

export async function testLinkServer(): Promise<string> {
  const j = await serverJson<{ ok: boolean; ytdlp: string }>('/health')
  return `Connected · yt-dlp ${j.ytdlp}`
}

/** Title, length and whether the link is live. */
export async function getLinkInfo(url: string): Promise<LinkInfo | null> {
  if (desktop) {
    await desktop.linkEnsure()
    return desktop.linkInfo(url.trim())
  }
  if (serverBase() && !isDirectMedia(url)) return serverJson<LinkInfo>('/api/info', { method: 'POST', body: JSON.stringify({ url: url.trim() }) })
  return null
}

interface ServerJob {
  id: string
  status: 'queued' | 'downloading' | 'recording' | 'processing' | 'done' | 'error'
  percent: number | null
  speed?: string
  eta?: string
  downloaded?: string
  elapsed?: number
  error?: string
  name?: string
  size?: number
}

async function importViaServer(url: string, opts: LinkOptions): Promise<MediaItem | null> {
  aiStore.job({ stage: 'link', message: 'Sending link to the link server…', progress: null, error: undefined, stoppable: false })
  try {
    const { id } = await serverJson<{ id: string }>('/api/jobs', { method: 'POST', body: JSON.stringify({ url, ...opts }) })
    serverJob = id
    let job: ServerJob
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000))
      job = await serverJson<ServerJob>(`/api/jobs/${id}`)
      if (job.status === 'done' || job.status === 'error') break
      if (job.status === 'recording')
        aiStore.job({ message: `Recording live on the link server · ${fmtElapsed(job.elapsed ?? 0)}${job.downloaded ? ` · ${job.downloaded}` : ''}`, progress: opts.maxMinutes ? Math.min(1, (job.elapsed ?? 0) / (opts.maxMinutes * 60)) : null, stoppable: true })
      else if (job.status === 'downloading')
        aiStore.job({ message: `Link server downloading${job.percent != null ? ` ${job.percent.toFixed(0)}%` : ''}${job.speed ? ` · ${job.speed}` : ''}`, progress: job.percent != null ? job.percent / 100 : null, stoppable: true })
      else aiStore.job({ message: job.status === 'queued' ? 'Waiting for the link server…' : 'Link server finishing the file…', progress: null, stoppable: job.status === 'queued' })
    }
    if (job.status === 'error') throw new Error(job.error || 'The link server could not download this link.')
    // Fetch the finished file into the browser.
    const res = await server(`/api/jobs/${id}/file`)
    if (!res.ok || !res.body) throw new Error(`Link server replied ${res.status}`)
    const total = job.size || Number(res.headers.get('content-length')) || 0
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
      aiStore.job({ message: `Loading video · ${(got / 1048576).toFixed(0)}${total ? ` / ${(total / 1048576).toFixed(0)}` : ''} MB`, progress: total ? got / total : null, stoppable: false })
    }
    void server(`/api/jobs/${id}`, { method: 'DELETE' }).catch(() => {})
    const file = new File(chunks as BlobPart[], job.name || 'video.mp4', { type: 'video/mp4' })
    const m = await importFile(file)
    if (m?.kind === 'video') setMaster(m)
    aiStore.job({ stage: 'idle', message: '', progress: null })
    return m
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'Cancelled') aiStore.job({ stage: 'idle', message: '', error: undefined, stoppable: false })
    else aiStore.job({ stage: 'error', message: '', error: friendly(msg), stoppable: false })
    return null
  } finally {
    serverJob = null
  }
}

/** Download (or record) a link and make it the main video. */
export async function importLink(url: string, opts: LinkOptions): Promise<MediaItem | null> {
  url = url.trim()
  if (!desktop) return !isDirectMedia(url) && serverBase() ? importViaServer(url, opts) : importDirect(url)
  aiStore.job({ stage: 'link', message: 'Preparing downloader…', progress: null, error: undefined, stoppable: false })
  const off = desktop.onLinkProgress((p) => {
    if (p.status === 'installing') aiStore.job({ message: 'Installing the downloader (first time only)…', progress: (p.percent ?? 0) / 100 })
    else if (p.status === 'recording')
      aiStore.job({
        message: `Recording live · ${fmtElapsed(p.elapsed ?? 0)}${p.downloaded ? ` · ${p.downloaded}` : ''}`,
        progress: opts.maxMinutes ? Math.min(1, (p.elapsed ?? 0) / (opts.maxMinutes * 60)) : null,
        stoppable: true,
      })
    else if (p.status === 'downloading')
      aiStore.job({
        message: `Downloading${p.percent != null ? ` ${p.percent.toFixed(0)}%` : ''}${p.speed ? ` · ${p.speed}` : ''}${p.eta && p.eta !== 'NA' ? ` · ${p.eta} left` : ''}`,
        progress: p.percent != null ? p.percent / 100 : null,
        stoppable: true,
      })
    else if (p.status === 'processing') aiStore.job({ message: 'Finishing file…', progress: null, stoppable: false })
  })
  try {
    await desktop.linkEnsure()
    const id = await desktop.linkDownload({ url, ...opts })
    currentJob = id
    aiStore.job({ message: opts.live ? 'Connecting to live stream…' : 'Starting download…', stoppable: true })
    const file = await desktop.linkWait(id)
    aiStore.job({ message: 'Importing…', progress: null, stoppable: false })
    const m = await importDiskFile(file)
    if (m?.kind === 'video') setMaster(m)
    aiStore.job({ stage: 'idle', message: '', progress: null })
    return m
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'Cancelled') aiStore.job({ stage: 'idle', message: '', error: undefined, stoppable: false })
    else aiStore.job({ stage: 'error', message: '', error: friendly(msg), stoppable: false })
    return null
  } finally {
    currentJob = null
    off()
  }
}

export function stopLink() {
  if (currentJob != null) void desktop?.linkStop(currentJob)
  if (serverJob) void server(`/api/jobs/${serverJob}/stop`, { method: 'POST' }).catch(() => {})
}

async function importDirect(url: string): Promise<MediaItem | null> {
  if (!DIRECT.test(url)) {
    aiStore.job({
      stage: 'error',
      error:
        'Browsers block downloading from YouTube, Twitch and similar sites. Open the link in the desktop app, or set up a link server in Settings → App.',
    })
    return null
  }
  aiStore.job({ stage: 'link', message: 'Downloading…', progress: null, error: undefined })
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Server replied ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
      aiStore.job({ message: `Downloading ${(got / 1048576).toFixed(0)} MB`, progress: total ? got / total : null })
    }
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'video.mp4')
    const file = new File(chunks as BlobPart[], name, { type: res.headers.get('content-type') || '' })
    const m = await importFile(file)
    if (m?.kind === 'video') setMaster(m)
    aiStore.job({ stage: 'idle', message: '', progress: null })
    return m
  } catch (e) {
    const msg = (e as Error).message
    aiStore.job({
      stage: 'error',
      error: /fetch|network|cors/i.test(msg)
        ? "That server doesn't allow downloads from other websites. Download the file and drop it in, or use the desktop app."
        : msg,
    })
    return null
  }
}

function friendly(msg: string) {
  if (/Unsupported URL/i.test(msg)) return "That site isn't supported, or the link isn't a video page."
  if (/Sign in to confirm you.re not a bot/i.test(msg))
    return "YouTube blocked the download as a bot. This usually happens on cloud servers: run the link server at home, or use the desktop app."
  if (/Private video|members-only/i.test(msg)) return `This video needs a signed-in account to watch: ${msg}`
  if (/is not live|will begin|Premieres in/i.test(msg)) return "That stream hasn't started yet."
  if (/HTTP Error 403/i.test(msg)) return 'The site refused the download (403). Try again, or try a lower quality.'
  return msg
}

export function fmtElapsed(s: number) {
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const ss = String(Math.floor(s % 60)).padStart(2, '0')
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
