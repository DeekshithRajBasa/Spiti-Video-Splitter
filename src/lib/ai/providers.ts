// LLM providers for AI clip ranking. Local: Ollama, LM Studio, any OpenAI-compatible
// server (llama.cpp, Jan, vLLM, LocalAI). Cloud: Claude (official SDK), OpenAI, Gemini,
// OpenRouter, Groq, or a custom OpenAI-compatible endpoint.
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { desktop } from '../desktop'
import { aiSettings, getApiKey, type ProviderId } from './settings'

export interface ProviderInfo {
  id: ProviderId
  name: string
  kind: 'local' | 'cloud'
  needsKey: boolean
  keyUrl?: string
  help: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'ollama', name: 'Ollama', kind: 'local', needsKey: false, help: 'Install from ollama.com, then pull a model (see the list below).' },
  { id: 'lmstudio', name: 'LM Studio', kind: 'local', needsKey: false, help: 'In LM Studio, load a model and start the local server (Developer tab).' },
  { id: 'local-openai', name: 'Other local server', kind: 'local', needsKey: false, help: 'Any OpenAI-compatible server: llama.cpp (llama-server), Jan, vLLM, LocalAI, KoboldCpp.' },
  { id: 'anthropic', name: 'Claude (Anthropic)', kind: 'cloud', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys', help: 'Uses the Claude API with your own key.' },
  { id: 'openai', name: 'OpenAI', kind: 'cloud', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', help: 'Uses the OpenAI API with your own key.' },
  { id: 'gemini', name: 'Google Gemini', kind: 'cloud', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey', help: "Uses Gemini's OpenAI-compatible endpoint." },
  { id: 'openrouter', name: 'OpenRouter', kind: 'cloud', needsKey: true, keyUrl: 'https://openrouter.ai/keys', help: 'One key for hundreds of hosted models.' },
  { id: 'groq', name: 'Groq', kind: 'cloud', needsKey: true, keyUrl: 'https://console.groq.com/keys', help: 'Very fast hosted open models.' },
  { id: 'custom', name: 'Custom endpoint', kind: 'cloud', needsKey: false, help: 'Any OpenAI-compatible /chat/completions URL. Key optional.' },
]

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!

/** Local models known to follow instructions and return JSON well. Sizes are the default quantisation. */
export const RECOMMENDED_LOCAL: { tag: string; name: string; size: string; ram: string; note: string }[] = [
  { tag: 'qwen3:4b', name: 'Qwen 3 4B', size: '2.6 GB', ram: '8 GB', note: 'Best small pick: fast, good at JSON.' },
  { tag: 'qwen3:8b', name: 'Qwen 3 8B', size: '5.2 GB', ram: '16 GB', note: 'Recommended balance of quality and speed.' },
  { tag: 'qwen3:14b', name: 'Qwen 3 14B', size: '9.3 GB', ram: '24 GB', note: 'Noticeably better judgement on long podcasts.' },
  { tag: 'gemma3:4b', name: 'Gemma 3 4B', size: '3.3 GB', ram: '8 GB', note: 'Good multilingual small model.' },
  { tag: 'gemma3:12b', name: 'Gemma 3 12B', size: '8.1 GB', ram: '16 GB', note: 'Strong multilingual, 128K context.' },
  { tag: 'llama3.1:8b', name: 'Llama 3.1 8B', size: '4.9 GB', ram: '16 GB', note: 'Reliable all-rounder, 128K context.' },
  { tag: 'llama3.2:3b', name: 'Llama 3.2 3B', size: '2.0 GB', ram: '8 GB', note: 'Runs on almost anything.' },
  { tag: 'phi4-mini', name: 'Phi-4 Mini 3.8B', size: '2.5 GB', ram: '8 GB', note: 'Compact, good reasoning for its size.' },
  { tag: 'mistral-nemo', name: 'Mistral Nemo 12B', size: '7.1 GB', ram: '16 GB', note: 'Good with long transcripts.' },
]

export interface ModelEntry {
  id: string
  label: string
  detail?: string
}

/* ---------- transport ---------- */
// The desktop app makes requests from the main process (no CORS); the browser uses fetch.

async function http(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}) {
  if (desktop) return desktop.request({ url, ...init })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 600_000)
  try {
    const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: ctrl.signal })
    return { status: r.status, ok: r.ok, text: await r.text() }
  } catch (e) {
    return { status: 0, ok: false, text: String((e as Error).message || e) }
  } finally {
    clearTimeout(t)
  }
}

function connectionHelp(id: ProviderId, base: string) {
  if (providerInfo(id).kind !== 'local') return `Couldn't reach ${base}. Check your internet connection.`
  const web = !desktop
  if (id === 'ollama')
    return web
      ? `Couldn't reach Ollama at ${base}. Make sure it's running, and allow this website: set OLLAMA_ORIGINS=${location.origin} and restart Ollama.`
      : `Couldn't reach Ollama at ${base}. Is it running? (Install from ollama.com, then open it.)`
  if (id === 'lmstudio') return `Couldn't reach LM Studio at ${base}. Start the server in LM Studio's Developer tab${web ? ' and turn on "Enable CORS"' : ''}.`
  return `Couldn't reach ${base}. Is the server running${web ? ' with CORS enabled' : ''}?`
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

/* ---------- model lists ---------- */

export async function listModels(id: ProviderId): Promise<ModelEntry[]> {
  const cfg = aiSettings.get().providers[id]
  const base = trimSlash(cfg.baseUrl)
  const key = await getApiKey(id)
  if (id === 'anthropic') {
    if (!key) throw new Error('Add your Anthropic API key first.')
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
    const out: ModelEntry[] = []
    for await (const m of client.models.list()) out.push({ id: m.id, label: m.display_name, detail: m.max_input_tokens ? `${Math.round(m.max_input_tokens / 1000)}K context` : undefined })
    return out
  }
  if (id === 'ollama') {
    const r = await http(`${base}/api/tags`, { timeoutMs: 8000 })
    if (!r.ok) throw new Error(r.status ? `Ollama replied ${r.status}` : connectionHelp(id, base))
    const j = JSON.parse(r.text) as { models: { name: string; size: number; details?: { parameter_size?: string; quantization_level?: string } }[] }
    return j.models.map((m) => ({
      id: m.name,
      label: m.name,
      detail: [m.details?.parameter_size, m.details?.quantization_level, `${(m.size / 1e9).toFixed(1)} GB`].filter(Boolean).join(' · '),
    }))
  }
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`
  else if (providerInfo(id).needsKey) throw new Error(`Add your ${providerInfo(id).name} API key first.`)
  const r = await http(`${base}/models`, { headers, timeoutMs: 15000 })
  if (!r.ok) throw new Error(r.status === 401 ? 'The API key was rejected.' : r.status ? `${providerInfo(id).name} replied ${r.status}: ${r.text.slice(0, 160)}` : connectionHelp(id, base))
  const j = JSON.parse(r.text) as { data?: { id: string; name?: string; context_length?: number }[] }
  return (j.data ?? [])
    .map((m) => ({ id: m.id.replace(/^models\//, ''), label: m.name || m.id.replace(/^models\//, ''), detail: m.context_length ? `${Math.round(m.context_length / 1000)}K context` : undefined }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Is the current provider usable right now (for Auto mode)? */
export async function providerReady(id: ProviderId): Promise<{ ok: boolean; reason?: string }> {
  const cfg = aiSettings.get().providers[id]
  const info = providerInfo(id)
  if (info.needsKey && !(await getApiKey(id))) return { ok: false, reason: `No ${info.name} API key` }
  if (!cfg.model && id !== 'anthropic') {
    if (info.kind === 'local') {
      try {
        const models = await listModels(id)
        if (!models.length) return { ok: false, reason: `${info.name} has no models installed` }
        aiSettings.setProvider(id, { model: models[0].id })
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: (e as Error).message }
      }
    }
    return { ok: false, reason: `Pick a ${info.name} model` }
  }
  if (info.kind === 'local') {
    try {
      await listModels(id)
    } catch (e) {
      return { ok: false, reason: (e as Error).message }
    }
  }
  return { ok: true }
}

/* ---------- structured clip ranking ---------- */

export const ClipPick = z.object({
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  hook: z.string(),
  score: z.number().int(),
  reason: z.string(),
})
export const ClipPicks = z.object({ clips: z.array(ClipPick) })
export type ClipPicksT = z.infer<typeof ClipPicks>

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clips'],
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start_line', 'end_line', 'title', 'hook', 'score', 'reason'],
        properties: {
          start_line: { type: 'integer' },
          end_line: { type: 'integer' },
          title: { type: 'string' },
          hook: { type: 'string' },
          score: { type: 'integer' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

function parseLoose(text: string): ClipPicksT {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  const a = cleaned.indexOf('{')
  const b = cleaned.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('The model did not return JSON.')
  const raw = JSON.parse(cleaned.slice(a, b + 1)) as { clips?: unknown }
  const clips = Array.isArray(raw.clips) ? raw.clips : []
  return {
    clips: clips
      .map((c) => ClipPick.safeParse({ ...(c as object), score: Math.round(Number((c as { score?: unknown }).score) || 0) }))
      .filter((r) => r.success)
      .map((r) => r.data!),
  }
}

/** Ask the configured provider to pick clips. Returns validated picks. */
export async function rankWithProvider(system: string, user: string): Promise<ClipPicksT> {
  const s = aiSettings.get()
  const id = s.provider
  const cfg = s.providers[id]
  const base = trimSlash(cfg.baseUrl)
  const key = await getApiKey(id)

  if (id === 'anthropic') {
    if (!key) throw new Error('Add your Anthropic API key in Settings → AI.')
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
    const res = await client.beta.messages.parse({
      model: cfg.model || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: betaZodOutputFormat(ClipPicks), effort: 'medium' },
    })
    if (res.stop_reason === 'refusal') throw new Error('Claude declined to rank this transcript.')
    if (!res.parsed_output) throw new Error('Claude returned an unexpected response.')
    return res.parsed_output
  }

  if (id === 'ollama') {
    if (!cfg.model) throw new Error('Pick an Ollama model in Settings → AI.')
    const r = await http(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        format: JSON_SCHEMA,
        think: false,
        options: { temperature: 0.2, num_ctx: 16384 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!r.ok) throw new Error(r.status ? `Ollama: ${r.text.slice(0, 200)}` : connectionHelp(id, base))
    return parseLoose((JSON.parse(r.text) as { message: { content: string } }).message.content)
  }

  // OpenAI-compatible chat completions.
  if (!cfg.model) throw new Error(`Pick a ${providerInfo(id).name} model in Settings → AI.`)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers.Authorization = `Bearer ${key}`
  if (id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/'
    headers['X-Title'] = 'Spiti Video Splitter'
  }
  const formats: (Record<string, unknown> | null)[] = [
    { type: 'json_schema', json_schema: { name: 'clips', strict: true, schema: JSON_SCHEMA } },
    { type: 'json_object' },
    null,
  ]
  let lastErr = ''
  for (const response_format of formats) {
    const body: Record<string, unknown> = {
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }
    if (response_format) body.response_format = response_format
    const r = await http(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) })
    if (r.ok) {
      const j = JSON.parse(r.text) as { choices: { message: { content: string } }[] }
      return parseLoose(j.choices[0]?.message?.content ?? '')
    }
    if (!r.status) throw new Error(connectionHelp(id, base))
    if (r.status === 401 || r.status === 403) throw new Error('The API key was rejected.')
    lastErr = `${providerInfo(id).name} replied ${r.status}: ${r.text.slice(0, 200)}`
    // Only retry with a simpler format when the server rejected the format itself.
    if (r.status !== 400 && r.status !== 422) break
  }
  throw new Error(lastErr)
}
