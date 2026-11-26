// History of videos you have exported, shown in the Renders panel on the right.
// Desktop: files live on disk, so the list is saved and survives restarts.
// Web: the browser keeps the last few renders in memory for this session (they were
// also downloaded when you exported).
import { useSyncExternalStore } from 'react'
import { uid } from '../defaults'
import { store } from '../store'
import { desktop } from './desktop'
import { canvasSize } from './engine'
import { totalDuration } from './timeline'

export interface RenderItem {
  id: string
  name: string
  title: string
  /** Absolute path on disk (desktop). */
  path: string | null
  url: string
  thumb: string
  duration: number
  width: number
  height: number
  size: number
  ext: string
  createdAt: number
  /** Desktop: the file was moved or deleted since it was rendered. */
  missing?: boolean
}

interface State {
  items: RenderItem[]
  selectedId: string | null
}

const KEY = 'svs.renders.v1'
const MAX_DESKTOP = 100
const MAX_WEB = 8

let state: State = { items: [], selectedId: null }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  emit()
}

export const renders = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useRenders() {
  return useSyncExternalStore(renders.subscribe, renders.get)
}

function persist() {
  if (!desktop) return
  try {
    // The video address is rebuilt on load; the thumbnail is small enough to keep.
    const saved = state.items.filter((i) => i.path).slice(0, MAX_DESKTOP).map((i) => ({ ...i, url: '', missing: undefined }))
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    /* storage unavailable */
  }
}

interface Probe {
  thumb: string
  duration: number
  width: number
  height: number
}

/** Read a video's real length and size, and grab a preview image about a third of the way in. */
function probe(url: string): Promise<Probe> {
  const empty: Probe = { thumb: '', duration: 0, width: 0, height: 0 }
  if (!url) return Promise.resolve(empty)
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    let meta = empty
    const done = (r: Probe) => {
      clearTimeout(timer)
      v.removeAttribute('src')
      v.load()
      resolve(r)
    }
    const timer = setTimeout(() => done(meta), 8000)
    v.onerror = () => done(meta)
    v.onloadeddata = () => {
      meta = { thumb: '', duration: isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight }
      v.currentTime = Math.min(1.5, Math.max(0, (meta.duration || 3) / 3))
    }
    v.onseeked = () => {
      try {
        const h = 240
        const c = document.createElement('canvas')
        c.height = h
        c.width = Math.max(1, Math.round((h * v.videoWidth) / v.videoHeight))
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        done({ ...meta, thumb: c.toDataURL('image/jpeg', 0.7) })
      } catch {
        done(meta)
      }
    }
    v.src = url
  })
}

/**
 * Record a finished export. Pass the file's `path` (desktop) or its `blob` (web).
 * Never throws: the video is already saved, so a problem here must not lose it from the list.
 */
export async function addRender(o: { name: string; ext: string; path?: string | null; blob?: Blob; title?: string; select?: boolean }) {
  try {
    const p = store.get().project
    const [w, h] = canvasSize(p, p.export.resolution)
    let url = ''
    let size = o.blob?.size ?? 0
    if (o.path && desktop) {
      url = await desktop.mediaUrl(o.path).catch(() => '')
      if (!size) size = (await desktop.fileStat(o.path).catch(() => ({ size: 0 }))).size
      if (!url && o.blob) url = URL.createObjectURL(o.blob)
    } else if (o.blob) url = URL.createObjectURL(o.blob)
    else return
    const info = await probe(url)
    const item: RenderItem = {
      id: uid(),
      name: o.name,
      title: o.title || o.name,
      path: o.path ?? null,
      url,
      thumb: info.thumb,
      duration: info.duration || totalDuration(p.segments),
      width: info.width || w,
      height: info.height || h,
      size,
      ext: o.ext,
      createdAt: Date.now(),
      missing: !url,
    }
    // Re-exporting to the same file replaces its old entry.
    let items = [item, ...state.items.filter((i) => !(item.path && i.path === item.path))]
    if (!desktop) {
      for (const old of items.slice(MAX_WEB)) URL.revokeObjectURL(old.url)
      items = items.slice(0, MAX_WEB)
    }
    set({ items, selectedId: o.select === false ? state.selectedId : item.id })
    persist()
  } catch (e) {
    console.warn('Could not add to Renders', e)
  }
}

/** Desktop: add videos you already have (e.g. exports from before the Renders panel existed). */
export async function addExistingRenders() {
  if (!desktop) return 0
  const files = (await desktop.openMediaDialog()).filter((f) => /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name))
  let added = 0
  for (const f of files) {
    const existing = state.items.find((i) => i.path === f.file)
    if (existing) {
      set({ selectedId: existing.id })
      continue
    }
    const info = await probe(f.url)
    const item: RenderItem = {
      id: uid(),
      name: f.name.replace(/\.[^.]+$/, ''),
      title: f.name.replace(/\.[^.]+$/, ''),
      path: f.file,
      url: f.url,
      thumb: info.thumb,
      duration: info.duration,
      width: info.width,
      height: info.height,
      size: f.size,
      ext: (f.name.split('.').pop() || 'mp4').toLowerCase(),
      createdAt: Date.now(),
    }
    set({ items: [item, ...state.items], selectedId: item.id })
    added++
  }
  persist()
  return added
}

export function selectRender(id: string | null) {
  set({ selectedId: id })
}

export function removeRender(id: string) {
  const item = state.items.find((i) => i.id === id)
  if (item && !item.path) URL.revokeObjectURL(item.url)
  const items = state.items.filter((i) => i.id !== id)
  set({ items, selectedId: state.selectedId === id ? (items[0]?.id ?? null) : state.selectedId })
  persist()
}

export function clearRenders() {
  for (const i of state.items) if (!i.path) URL.revokeObjectURL(i.url)
  set({ items: [], selectedId: null })
  persist()
}

export const openRenders = (open = true) => store.ui({ rendersOpen: open })

/** Desktop: restore the saved list and check which files still exist. */
async function restore() {
  if (!desktop) return
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]') as RenderItem[]
    const items: RenderItem[] = []
    for (const r of saved) {
      if (!r.path) continue
      try {
        const st = await desktop.fileStat(r.path)
        items.push({ ...r, url: st.exists ? await desktop.mediaUrl(r.path) : '', size: st.size || r.size, missing: !st.exists })
      } catch {
        items.push({ ...r, url: '', missing: true })
      }
    }
    // Anything rendered while this was loading stays on top.
    const known = new Set(state.items.map((i) => i.path))
    set({ items: [...state.items, ...items.filter((i) => !known.has(i.path))], selectedId: state.selectedId ?? items[0]?.id ?? null })
  } catch {
    /* corrupt or unavailable storage */
  }
}
void restore()
