import { Check, Copy, Cpu, ExternalLink, KeyRound, Loader2, RefreshCw, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listModels, PROVIDERS, providerInfo, RECOMMENDED_LOCAL, type ModelEntry } from '../lib/ai/providers'
import { aiSettings, DEFAULT_PROVIDERS, getApiKey, setApiKey, useAiSettings } from '../lib/ai/settings'
import { cachedModels, deleteCachedModel, detectGpu, LANGUAGES, WHISPER_MODELS } from '../lib/ai/whisper'
import { desktop } from '../lib/desktop'
import { store, useUi } from '../store'
import { Field, Section, Segmented } from './ui'

type Tab = 'speech' | 'ai' | 'app'

export function SettingsModal({ onClose, initial = 'ai' }: { onClose: () => void; initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial)
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Settings</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <Segmented<Tab>
          value={tab}
          options={[
            { value: 'ai', label: 'Clip AI' },
            { value: 'speech', label: 'Speech to text' },
            { value: 'app', label: 'App' },
          ]}
          onChange={setTab}
        />
        <div className="modal-body">
          {tab === 'speech' && <SpeechSettings />}
          {tab === 'ai' && <AiSettingsView />}
          {tab === 'app' && <AppSettings />}
        </div>
      </div>
    </div>
  )
}

function SpeechSettings() {
  const s = useAiSettings()
  const [gpu, setGpu] = useState<{ webgpu: boolean; f16: boolean; name: string } | null>(null)
  const [cached, setCached] = useState<Set<string>>(new Set())
  const refresh = () => void cachedModels().then(setCached)
  useEffect(() => {
    void detectGpu().then(setGpu)
    refresh()
  }, [])
  const threads = typeof SharedArrayBuffer !== 'undefined' ? Math.min(8, navigator.hardwareConcurrency || 4) : 1
  return (
    <>
      <div className="device-card">
        {gpu?.webgpu ? <Zap size={16} /> : <Cpu size={16} />}
        <div>
          <strong>{gpu == null ? 'Checking this device…' : gpu.webgpu ? `WebGPU available${gpu.name ? ` · ${gpu.name}` : ''}` : 'No WebGPU: runs on the CPU'}</strong>
          <span>
            Models run on your device. They download once from Hugging Face and are cached. CPU mode uses {threads} thread{threads > 1 ? 's' : ''}.
          </span>
        </div>
      </div>
      <Section title="Speech model">
        <div className="model-list">
          {WHISPER_MODELS.map((m) => {
            const disabled = !!m.gpuOnly && gpu != null && !gpu.webgpu
            const size = gpu?.webgpu ? m.sizeGpu : m.sizeWasm
            return (
              <label key={m.id} className={`model-row ${s.whisperModel === m.id ? 'on' : ''} ${disabled ? 'disabled' : ''}`}>
                <input type="radio" name="whisper" checked={s.whisperModel === m.id} disabled={disabled} onChange={() => aiSettings.set({ whisperModel: m.id })} />
                <div className="model-main">
                  <strong>
                    {m.name}
                    {cached.has(m.id) && (
                      <em className="tag ok">
                        <Check size={10} /> downloaded
                      </em>
                    )}
                    {disabled && <em className="tag">needs WebGPU</em>}
                  </strong>
                  <span>{m.note}</span>
                </div>
                <div className="model-meta">
                  <span>{size >= 1000 ? `${(size / 1000).toFixed(1)} GB` : `${size} MB`}</span>
                  <Meter label="Speed" v={m.speed} />
                  <Meter label="Accuracy" v={m.quality} />
                </div>
                {cached.has(m.id) && (
                  <button
                    type="button"
                    className="icon-btn sm ghost"
                    aria-label={`Delete ${m.name} download`}
                    onClick={(e) => {
                      e.preventDefault()
                      void deleteCachedModel(m.id).then(refresh)
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </label>
            )
          })}
        </div>
      </Section>
      <div className="two">
        <Field label="Language">
          <select value={s.language} onChange={(e) => aiSettings.set({ language: e.target.value })}>
            {LANGUAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Run on">
          <select value={s.device} onChange={(e) => aiSettings.set({ device: e.target.value as typeof s.device })}>
            <option value="auto">Auto (GPU if available)</option>
            <option value="webgpu">GPU (WebGPU)</option>
            <option value="wasm">CPU</option>
          </select>
        </Field>
      </div>
      <Field label="Words per caption">
        <Segmented<number> value={s.captionWords} small options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => aiSettings.set({ captionWords: v })} />
      </Field>
    </>
  )
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <span className="meter" title={`${label}: ${v}/5`}>
      {label}
      <i>
        {[1, 2, 3, 4, 5].map((k) => (
          <b key={k} className={k <= v ? 'on' : ''} />
        ))}
      </i>
    </span>
  )
}

function AiSettingsView() {
  const s = useAiSettings()
  const id = s.provider
  const info = providerInfo(id)
  const cfg = s.providers[id]
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState<ModelEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const kind = info.kind

  useEffect(() => {
    setModels(null)
    setErr('')
    setKey('')
    void getApiKey(id).then((k) => setHasKey(!!k))
  }, [id])

  const load = async () => {
    setLoading(true)
    setErr('')
    try {
      const list = await listModels(id)
      setModels(list)
      if (!cfg.model && list[0]) aiSettings.setProvider(id, { model: list[0].id })
    } catch (e) {
      setErr((e as Error).message)
      setModels(null)
    } finally {
      setLoading(false)
    }
  }

  // Local servers: list installed models straight away.
  useEffect(() => {
    if (kind === 'local') void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const installed = new Set((models ?? []).map((m) => m.id.replace(/:latest$/, '')))
  const copy = (t: string) => {
    void navigator.clipboard?.writeText(t)
    setCopied(t)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <>
      <Field label="Default mode" group>
        <Segmented
          value={s.clipMode}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'local', label: 'Local only' },
            { value: 'ai', label: 'AI only' },
          ]}
          onChange={(v) => aiSettings.set({ clipMode: v })}
        />
      </Field>
      <p className="hint">Auto uses the AI model below when it's reachable and falls back to offline Local scoring when it isn't.</p>

      <Section title="AI model">
        <Field label="Where it runs" group>
          <Segmented<'local' | 'cloud'>
            value={kind}
            options={[
              { value: 'local', label: 'On this computer' },
              { value: 'cloud', label: 'Cloud' },
            ]}
            onChange={(v) => aiSettings.set({ provider: v === 'local' ? 'ollama' : 'anthropic' })}
          />
        </Field>
        <div className="provider-grid">
          {PROVIDERS.filter((p) => p.kind === kind).map((p) => (
            <button type="button" key={p.id} className={`provider ${p.id === id ? 'on' : ''}`} onClick={() => aiSettings.set({ provider: p.id })}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="hint">{info.help}</p>
        <Field label="Server URL">
          <div className="input-row">
            <input value={cfg.baseUrl} onChange={(e) => aiSettings.setProvider(id, { baseUrl: e.target.value })} spellCheck={false} />
            {cfg.baseUrl !== DEFAULT_PROVIDERS[id].baseUrl && id !== 'custom' && (
              <button type="button" className="btn sm" onClick={() => aiSettings.setProvider(id, { baseUrl: DEFAULT_PROVIDERS[id].baseUrl })}>
                Reset
              </button>
            )}
          </div>
        </Field>
        {(kind === 'cloud' || id === 'local-openai') && (
          <Field label={`API key${info.needsKey ? '' : ' (optional)'}`} hint={desktop ? 'stored in your OS keychain' : 'stored in this browser only'}>
            <div className="input-row">
              <input type="password" value={key} placeholder={hasKey ? '•••••••• saved' : 'Paste your key'} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
              <button
                type="button"
                className="btn sm"
                disabled={!key}
                onClick={async () => {
                  await setApiKey(id, key.trim())
                  setKey('')
                  setHasKey(true)
                  void load()
                }}
              >
                <KeyRound size={13} /> Save
              </button>
              {hasKey && (
                <button
                  type="button"
                  className="icon-btn sm"
                  aria-label="Remove saved key"
                  onClick={async () => {
                    await setApiKey(id, '')
                    setHasKey(false)
                    setModels(null)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            {info.keyUrl && (
              <a className="link small" href={info.keyUrl} target="_blank" rel="noreferrer">
                Get a key <ExternalLink size={11} />
              </a>
            )}
          </Field>
        )}
        <Field label="Model">
          <div className="input-row">
            {models && models.length > 0 ? (
              <select value={cfg.model} onChange={(e) => aiSettings.setProvider(id, { model: e.target.value })}>
                {!models.some((m) => m.id === cfg.model) && cfg.model && <option value={cfg.model}>{cfg.model}</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.detail ? ` — ${m.detail}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input value={cfg.model} onChange={(e) => aiSettings.setProvider(id, { model: e.target.value })} placeholder={kind === 'local' ? 'e.g. qwen3:8b' : 'Model id'} spellCheck={false} />
            )}
            <button type="button" className="btn sm" onClick={() => void load()} disabled={loading} title="Refresh the model list">
              {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {kind === 'local' ? 'Detect' : 'List'}
            </button>
          </div>
        </Field>
        {err && <p className="error-text">{err}</p>}
        {models && !err && (
          <p className="ok-text">
            <Check size={13} /> Connected · {models.length} model{models.length === 1 ? '' : 's'} available
          </p>
        )}
        {kind === 'cloud' && <p className="hint">Cloud AI receives only the transcript text, never your video. You pay the provider for usage with your own key.</p>}
      </Section>

      {kind === 'local' && (
        <Section title={id === 'ollama' ? 'Recommended local models' : 'Models that work well'}>
          <p className="hint">
            Any instruction-following model works. These return reliable JSON and handle long transcripts.{' '}
            {id === 'ollama' ? 'Copy the command into a terminal to install one.' : `Search for them in ${info.name}.`}
          </p>
          <div className="rec-list">
            {RECOMMENDED_LOCAL.map((m) => {
              const have = [...installed].some((x) => x === m.tag || x.startsWith(`${m.tag}-`) || (!m.tag.includes(':') && x.startsWith(`${m.tag}:`)))
              const cmd = `ollama pull ${m.tag}`
              return (
                <div key={m.tag} className="rec-row">
                  <div>
                    <strong>
                      {m.name}
                      {have && (
                        <em className="tag ok">
                          <Check size={10} /> installed
                        </em>
                      )}
                    </strong>
                    <span>
                      {m.size} · needs {m.ram} RAM · {m.note}
                    </span>
                  </div>
                  {have ? (
                    <button type="button" className="btn sm" onClick={() => aiSettings.setProvider(id, { model: models?.find((x) => x.id.startsWith(m.tag))?.id ?? m.tag })}>
                      Use
                    </button>
                  ) : id === 'ollama' ? (
                    <button type="button" className="btn sm" onClick={() => copy(cmd)} title={cmd}>
                      {copied === cmd ? <Check size={13} /> : <Copy size={13} />} {copied === cmd ? 'Copied' : 'Copy install'}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </>
  )
}

function AppSettings() {
  const ui = useUi()
  return (
    <>
      <Field label="Theme" group>
        <Segmented
          value={ui.theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) => store.ui({ theme: v })}
        />
      </Field>
      <p className="hint">
        {desktop
          ? 'Links are downloaded with yt-dlp, which installs itself on first use and updates daily. Files are saved to Videos → Spiti Downloads.'
          : 'You are using the web version. Get the desktop app for YouTube/Twitch links, live-stream recording and fast GPU export.'}
      </p>
    </>
  )
}
