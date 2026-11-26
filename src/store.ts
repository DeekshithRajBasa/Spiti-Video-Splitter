import { useSyncExternalStore } from 'react'
import { createProject } from './defaults'
import type { MediaItem, Project } from './types'

export type Selection =
  | { kind: 'segment'; id: string }
  | { kind: 'cue'; id: string }
  | { kind: 'sfx'; id: string }
  | { kind: 'music' }
  | { kind: 'overlay' }
  | null

export interface UiState {
  playing: boolean
  zoom: number // px per second
  selection: Selection
  leftTab: 'clips' | 'media' | 'captions' | 'layout' | 'templates'
  mobileTab: string
  rightTab: 'frame' | 'style' | 'audio' | 'export'
  theme: 'light' | 'dark'
  framing: boolean
  inPoint: number | null
  outPoint: number | null
  lastSaved: number
  exporting: null | { progress: number; status: string }
  lastExport: string | null
  /** The Renders panel (exported videos) is open. */
  rendersOpen: boolean
}

interface State {
  project: Project
  media: Record<string, MediaItem>
  ui: UiState
}

const SAVE_KEY = 'svs.project.v1'

function loadProject(): Project {
  const base = createProject()
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<Project>
    // Media files can't survive a reload, so strip media references.
    const p: Project = { ...base, ...saved, tracks: { ...base.tracks, ...saved.tracks } } as Project
    p.slots = base.slots.map((s, i) => ({ sourceId: null, crop: saved.slots?.[i]?.crop ?? s.crop }))
    p.segments = []
    p.music = { ...base.music, ...saved.music, mediaId: null }
    p.sfx = []
    p.background = { ...base.background, ...saved.background, imageId: null }
    p.template = { ...base.template, ...saved.template, avatarId: null }
    p.watermark = { ...base.watermark, ...saved.watermark, imageId: null }
    p.captionStyle = { ...base.captionStyle, ...saved.captionStyle }
    p.headline = { ...base.headline, ...saved.headline }
    p.outro = { ...base.outro, ...saved.outro }
    p.export = { ...base.export, ...saved.export }
    return p
  } catch {
    return base
  }
}

function initialTheme(): 'light' | 'dark' {
  try {
    const t = localStorage.getItem('svs.theme')
    if (t === 'light' || t === 'dark') return t
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let state: State = {
  project: loadProject(),
  media: {},
  ui: {
    playing: false,
    zoom: 40,
    selection: null,
    leftTab: 'clips',
    mobileTab: 'clips',
    rightTab: 'frame',
    theme: initialTheme(),
    framing: false,
    inPoint: null,
    outPoint: null,
    lastSaved: Date.now(),
    exporting: null,
    lastExport: null,
    rendersOpen: false,
  },
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const past: Project[] = []
const future: Project[] = []
let lastKey = ''
let lastKeyAt = 0
let saveTimer = 0

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state.project))
    } catch {
      /* storage may be unavailable */
    }
    state = { ...state, ui: { ...state.ui, lastSaved: Date.now() } }
    emit()
  }, 800)
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  /**
   * Mutate the project. Changes with the same `key` within 600ms are merged
   * into one undo step (slider drags, typing).
   */
  update(fn: (p: Project) => Project | void, key = '') {
    const prev = state.project
    const draft = structuredClone(prev)
    const next = fn(draft) ?? draft
    const now = Date.now()
    if (!(key && key === lastKey && now - lastKeyAt < 600)) {
      past.push(prev)
      if (past.length > 200) past.shift()
    }
    lastKey = key
    lastKeyAt = now
    future.length = 0
    state = { ...state, project: next }
    emit()
    scheduleSave()
  },
  undo() {
    const p = past.pop()
    if (!p) return
    future.push(state.project)
    state = { ...state, project: p }
    lastKey = ''
    emit()
    scheduleSave()
  },
  redo() {
    const p = future.pop()
    if (!p) return
    past.push(state.project)
    state = { ...state, project: p }
    lastKey = ''
    emit()
    scheduleSave()
  },
  canUndo: () => past.length > 0,
  canRedo: () => future.length > 0,
  ui(patch: Partial<UiState>) {
    state = { ...state, ui: { ...state.ui, ...patch } }
    if (patch.theme) {
      try {
        localStorage.setItem('svs.theme', patch.theme)
      } catch {
        /* ignore */
      }
    }
    emit()
  },
  addMedia(m: MediaItem) {
    state = { ...state, media: { ...state.media, [m.id]: m } }
    emit()
  },
  patchMedia(id: string, patch: Partial<MediaItem>) {
    const m = state.media[id]
    if (!m) return
    state = { ...state, media: { ...state.media, [id]: { ...m, ...patch } } }
    emit()
  },
  removeMedia(id: string) {
    const media = { ...state.media }
    const m = media[id]
    if (m) URL.revokeObjectURL(m.url)
    delete media[id]
    state = { ...state, media }
    emit()
  },
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(state))
}

export const useProject = () => useStore((s) => s.project)
export const useUi = () => useStore((s) => s.ui)
export const useMedia = () => useStore((s) => s.media)
