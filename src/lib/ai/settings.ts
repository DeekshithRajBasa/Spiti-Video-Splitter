import { useSyncExternalStore } from 'react'
import { desktop } from '../desktop'

export type ClipMode = 'auto' | 'local' | 'ai'
export type ProviderId = 'ollama' | 'lmstudio' | 'local-openai' | 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'groq' | 'custom'

export interface ProviderConfig {
  baseUrl: string
  model: string
}

export interface AiSettings {
  clipMode: ClipMode
  provider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  whisperModel: string
  language: string
  device: 'auto' | 'webgpu' | 'wasm'
  clipCount: number
  minLength: number
  maxLength: number
  /** Turn the transcript into captions automatically. */
  autoCaptions: boolean
  /** Use the clip's hook line as the headline when applying a clip. */
  hookHeadline: boolean
  captionWords: number
}

export const DEFAULT_PROVIDERS: Record<ProviderId, ProviderConfig> = {
  ollama: { baseUrl: 'http://localhost:11434', model: '' },
  lmstudio: { baseUrl: 'http://localhost:1234/v1', model: '' },
  'local-openai': { baseUrl: 'http://localhost:8080/v1', model: '' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: '' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: '' },
  custom: { baseUrl: 'https://', model: '' },
}

const KEY = 'svs.ai.v1'

function load(): AiSettings {
  const base: AiSettings = {
    clipMode: 'auto',
    provider: 'ollama',
    providers: structuredClone(DEFAULT_PROVIDERS),
    whisperModel: 'onnx-community/whisper-base_timestamped',
    language: 'auto',
    device: 'auto',
    clipCount: 5,
    minLength: 20,
    maxLength: 60,
    autoCaptions: true,
    hookHeadline: true,
    captionWords: 4,
  }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<AiSettings>
    return { ...base, ...saved, providers: { ...base.providers, ...saved.providers } }
  } catch {
    return base
  }
}

let settings = load()
const listeners = new Set<() => void>()

export const aiSettings = {
  get: () => settings,
  set(patch: Partial<AiSettings>) {
    settings = { ...settings, ...patch }
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((l) => l())
  },
  setProvider(id: ProviderId, patch: Partial<ProviderConfig>) {
    aiSettings.set({ providers: { ...settings.providers, [id]: { ...settings.providers[id], ...patch } } })
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useAiSettings() {
  return useSyncExternalStore(aiSettings.subscribe, () => settings)
}

/* API keys: OS keychain on desktop (Electron safeStorage); this browser's storage on the web. */
const keyCache: Partial<Record<ProviderId, string>> = {}

export async function getApiKey(id: ProviderId): Promise<string> {
  if (keyCache[id] !== undefined) return keyCache[id]!
  let v = ''
  if (desktop) v = await desktop.secretGet(`apikey.${id}`)
  else {
    try {
      v = localStorage.getItem(`svs.apikey.${id}`) || ''
    } catch {
      /* ignore */
    }
  }
  keyCache[id] = v
  return v
}

export async function setApiKey(id: ProviderId, value: string) {
  keyCache[id] = value
  if (desktop) await desktop.secretSet(`apikey.${id}`, value)
  else {
    try {
      if (value) localStorage.setItem(`svs.apikey.${id}`, value)
      else localStorage.removeItem(`svs.apikey.${id}`)
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l())
}
