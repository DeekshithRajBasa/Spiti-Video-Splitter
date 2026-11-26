// One pipeline for every way a link arrives: pasted anywhere, typed into the link box,
// or handed over from the web app through spiti://. Link → video → transcript → clips.
import { store } from '../../store'
import type { MediaItem } from '../../types'
import type { LinkInfo } from '../desktop'
import { canImportPlatformLinks, getLinkInfo, importLink, isDirectMedia, isUrl } from '../links'
import { applyClip, findClips, transcribeRange } from './clips'
import { aiSettings } from './settings'
import { aiStore } from './state'
import { applyCaptions, transcribe } from './whisper'

export interface LinkChoices {
  maxHeight: number
  start?: number
  end?: number
  liveMode: 'now' | 'start'
  /** 0 = record until Stop is pressed. */
  liveMinutes: number
}

export const DEFAULT_CHOICES: LinkChoices = { maxHeight: 1080, liveMode: 'now', liveMinutes: 30 }

const busyStages = ['link', 'audio', 'model', 'transcribe', 'clips', 'export']
export const isBusy = () => busyStages.includes(aiStore.get().job.stage)

/** Run the whole flow. With `url`, download (or record) it first; otherwise use the current video. */
export async function autoClip(opts: { url?: string; info?: LinkInfo | null; choices?: LinkChoices; captionsOnly?: boolean } = {}) {
  if (isBusy()) return
  const s = aiSettings.get()
  const choices = { ...DEFAULT_CHOICES, ...opts.choices }
  aiStore.set({ notice: '' })
  aiStore.job({ stage: 'link', message: 'Starting…', progress: null, error: undefined })
  try {
    let m: MediaItem | null = null
    let title = ''
    if (opts.url) {
      let info = opts.info
      if (info === undefined && !isDirectMedia(opts.url)) info = await getLinkInfo(opts.url).catch(() => null)
      title = info?.title ?? ''
      const live = !!info?.isLive
      aiStore.job({ stage: 'link', message: live ? 'Connecting to live stream…' : 'Starting download…', progress: null })
      m = await importLink(opts.url, {
        maxHeight: choices.maxHeight,
        start: live ? undefined : choices.start,
        end: live ? undefined : choices.end,
        live: live ? choices.liveMode : undefined,
        maxMinutes: live && choices.liveMinutes > 0 ? choices.liveMinutes : undefined,
      })
      if (!m) return // importLink already reported why
      aiStore.set({ pendingUrl: '' })
    } else {
      const p = store.get().project
      m = p.slots[0].sourceId ? store.get().media[p.slots[0].sourceId] : null
    }
    if (!m || m.kind !== 'video') throw new Error('Add a video or paste a link first.')
    title ||= m.name

    // Reuse the transcript when it was made with the same model and covers the range.
    const range = opts.url ? undefined : transcribeRange()
    let t = aiStore.get().transcripts[m.id]
    const covers = t && t.model === s.whisperModel && (!range || (t.range[0] <= range[0] && t.range[1] >= range[1]))
    if (!covers) t = await transcribe(m, range)
    if (opts.captionsOnly) {
      const n = applyCaptions(t!, range)
      aiStore.job({ stage: 'done', message: `Added ${n} captions.`, progress: 1 })
      store.ui({ leftTab: 'captions', mobileTab: 'captions' })
      return
    }
    aiStore.job({ stage: 'clips', message: 'Finding the best moments…', progress: null })
    const found = await findClips(t!, title)
    aiStore.job({ stage: 'done', message: found.length ? `Found ${found.length} clips.` : 'No clips found.', progress: 1 })
    if (found[0]) applyClip(found[0])
  } catch (e) {
    const msg = (e as Error).message
    aiStore.job({ stage: msg === 'Cancelled' ? 'idle' : 'error', message: '', error: msg === 'Cancelled' ? undefined : msg, progress: null })
  }
}

/** spiti://clip?url=… link that opens the desktop app and starts clipping there. */
export const desktopHandoffUrl = (url: string) => `spiti://clip?url=${encodeURIComponent(url.trim())}`

/**
 * A link arrived (pasted anywhere, or from the desktop deep link). Show it in the Auto clip
 * tab and, when auto-start is on and this app can fetch it, start right away.
 */
export function receiveLink(url: string, source: 'paste' | 'deeplink') {
  url = url.trim()
  if (!isUrl(url)) return
  store.ui({ leftTab: 'clips', mobileTab: 'clips' })
  aiStore.set({ pendingUrl: url })
  if (isBusy()) return
  const auto = source === 'deeplink' || aiSettings.get().autoStart
  if (auto && (isDirectMedia(url) || canImportPlatformLinks())) void autoClip({ url })
}

