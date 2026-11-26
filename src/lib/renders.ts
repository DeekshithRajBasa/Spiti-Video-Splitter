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

/** A small preview image from the video (about one third in). */
function makeThumb(url: string): Promise<string> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    const done = (r: string) => {
      v.removeAttribute('src')
      v.load()
      resolve(r)
    }
    const timer = setTimeout(() => done(''), 8000)
    v.onerror = () => {
      clearTimeout(timer)
      done('')
    }
    v.onloadeddata = () => {
      v.currentTime = Math.min(1.5, Math.max(0, (v.duration || 3) / 3))
    }
    v.onseeked = () => {
      clearTimeout(timer)
      try {
        const h = 240
        const c = document.createElement('canvas')
        c.height = h
        c.width = Math.max(1, Math.round((h * v.videoWidth) / v.videoHeight))
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
        done(c.toDataURL('image/jpeg', 0.7))
      } catch {
        done('')
      }
    }
    v.src = url
  })
}

/** Record a finished export. Pass the file's `path` (desktop) or its `blob` (web). */
export async function addRender(o: { name: string; ext: string; path?: string | null; blob?: Blob; title?: string; select?: boolean }) {
  const p = store.get().project
  const [width, height] = canvasSize(p, p.export.resolution)
  const duration = totalDuration(p.segments)
  let url = ''
  let size = o.blob?.size ?? 0
  if (o.path && desktop) {
    url = await desktop.mediaUrl(o.path)
    if (!size) size = (await desktop.fileStat(o.path)).size
  } else if (o.blob) url = URL.createObjectURL(o.blob)
  else return
  const item: RenderItem = {
    id: uid(),
    name: o.name,
    title: o.title || o.name,
    path: o.path ?? null,
    url,
    thumb: await makeThumb(url),
    duration,
    width,
    height,
    size,
    ext: o.ext,
    createdAt: Date.now(),
  }
  let items = [item, ...state.items]
  if (!desktop) {
    for (const old of items.slice(MAX_WEB)) URL.revokeObjectURL(old.url)
    items = items.slice(0, MAX_WEB)
  }
  set({ items, selectedId: o.select === false ? state.selectedId : item.id })
  persist()
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
