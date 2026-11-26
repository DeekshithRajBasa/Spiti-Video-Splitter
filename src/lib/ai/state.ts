import { useSyncExternalStore } from 'react'

export interface Word {
  text: string
  start: number
  end: number
}

export interface Transcript {
  mediaId: string
  model: string
  language: string
  words: Word[]
  /** Loudness per second (0..1), used by the local clip scorer. */
  loudness: number[]
  range: [number, number]
  createdAt: number
}

export interface ClipSuggestion {
  id: string
  start: number
  end: number
  title: string
  hook: string
  score: number
  reason: string
  source: 'local' | 'ai'
}

export interface JobState {
  stage: 'idle' | 'link' | 'audio' | 'model' | 'transcribe' | 'clips' | 'export' | 'done' | 'error'
  message: string
  progress: number | null
  /** Live recordings and downloads can be stopped. */
  stoppable?: boolean
  error?: string
}

interface AiState {
  job: JobState
  transcripts: Record<string, Transcript>
  clips: ClipSuggestion[]
  clipsFor: string | null
  activeClip: string | null
  notice: string
  /** Link shown in the Auto clip box (pasted anywhere, or handed over by spiti://). */
  pendingUrl: string
}

let state: AiState = {
  job: { stage: 'idle', message: '', progress: null },
  transcripts: {},
  clips: [],
  clipsFor: null,
  activeClip: null,
  notice: '',
  pendingUrl: '',
}
const listeners = new Set<() => void>()

export const aiStore = {
  get: () => state,
  set(patch: Partial<AiState>) {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  },
  job(patch: Partial<JobState>) {
    aiStore.set({ job: { ...state.job, ...patch } })
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useAi<T>(sel: (s: AiState) => T): T {
  return useSyncExternalStore(aiStore.subscribe, () => sel(state))
}
