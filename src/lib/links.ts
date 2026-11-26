// Paste-a-link import. Desktop: yt-dlp handles YouTube, Twitch, Kick, X, Instagram,
// TikTok, Facebook, Vimeo and 1,000+ other sites, including live streams. Browser:
// only direct media links (and only from servers that allow cross-origin downloads).
import { setMaster } from './actions'
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

let currentJob: number | null = null

export async function getLinkInfo(url: string): Promise<LinkInfo | null> {
  if (!desktop) return null
  aiStore.job({ stage: 'link', message: 'Looking up link…', progress: null, error: undefined })
  try {
    await desktop.linkEnsure()
    return await desktop.linkInfo(url.trim())
  } finally {
    aiStore.job({ stage: 'idle', message: '' })
  }
}

/** Download (or record) a link and make it the main video. */
export async function importLink(url: string, opts: LinkOptions): Promise<MediaItem | null> {
  url = url.trim()
  if (!desktop) return importDirect(url)
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
}

async function importDirect(url: string): Promise<MediaItem | null> {
  if (!DIRECT.test(url)) {
    aiStore.job({
      stage: 'error',
      error:
        'Links from YouTube, Twitch and other sites need the desktop app (browsers block downloading from them). In the browser you can paste a direct link to a video file.',
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
  if (/Private video|members-only|Sign in to confirm/i.test(msg)) return `This video needs a signed-in account to watch: ${msg}`
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
