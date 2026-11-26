import { Captions, CircleStop, Download, ExternalLink, Link2, Loader2, MonitorDown, Play, Radio, Server, Settings2, Sparkles, Wand2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { autoClip, desktopHandoffUrl, receiveLink } from '../lib/ai/autoclip'
import { applyClip } from '../lib/ai/clips'
import { providerInfo } from '../lib/ai/providers'
import { aiSettings, useAiSettings, type ClipMode } from '../lib/ai/settings'
import { aiStore, useAi, type ClipSuggestion } from '../lib/ai/state'
import { cancelTranscription, modelInfo } from '../lib/ai/whisper'
import { desktop, type LinkInfo } from '../lib/desktop'
import { engine } from '../lib/engine'
import { exportClipsBatch, runExport } from '../lib/exportFlow'
import { canImportPlatformLinks, fmtElapsed, getLinkInfo, isDirectMedia, isUrl, stopLink } from '../lib/links'
import { fmtShort } from '../lib/timeline'
import { useMedia, useProject } from '../store'
import { Field, Section, Segmented, Slider, Toggle } from './ui'

function parseTime(s: string): number | undefined {
  if (!s.trim()) return undefined
  const parts = s.trim().split(':').map(Number)
  if (parts.some((n) => !isFinite(n))) return undefined
  return parts.reduce((a, n) => a * 60 + n, 0)
}

export function ClipsPanel({ onOpenSettings }: { onOpenSettings: (tab?: 'ai' | 'speech' | 'app') => void }) {
  const p = useProject()
  const media = useMedia()
  const s = useAiSettings()
  const job = useAi((x) => x.job)
  const clips = useAi((x) => x.clips)
  const clipsFor = useAi((x) => x.clipsFor)
  const active = useAi((x) => x.activeClip)
  const notice = useAi((x) => x.notice)
  const transcripts = useAi((x) => x.transcripts)
  const url = useAi((x) => x.pendingUrl)
  const setUrl = (v: string) => aiStore.set({ pendingUrl: v })
  const [info, setInfo] = useState<LinkInfo | null>(null)
  const [infoErr, setInfoErr] = useState('')
  const [quality, setQuality] = useState(1080)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [liveMode, setLiveMode] = useState<'now' | 'start'>('now')
  const [liveMinutes, setLiveMinutes] = useState(30)
  const [batch, setBatch] = useState<string>('')
  const lookup = useRef(0)

  const masterId = p.slots[0].sourceId
  const master = masterId ? media[masterId] : null
  const tr = masterId ? transcripts[masterId] : undefined
  const busy = !['idle', 'done', 'error'].includes(job.stage)
  const ai = s.clipMode !== 'local'
  const prov = providerInfo(s.provider)
  const provModel = s.providers[s.provider].model

  const platformLink = isUrl(url) && !isDirectMedia(url)
  const canFetch = isUrl(url) && (isDirectMedia(url) || canImportPlatformLinks())
  const needsHandoff = !desktop && platformLink && !canImportPlatformLinks()

  // Look up a pasted link to show what it is and whether it's live.
  useEffect(() => {
    setInfo(null)
    setInfoErr('')
    if (!isUrl(url) || !platformLink || !canImportPlatformLinks()) return
    const n = ++lookup.current
    const t = setTimeout(() => {
      getLinkInfo(url)
        .then((i) => n === lookup.current && setInfo(i))
        .catch((e) => n === lookup.current && setInfoErr((e as Error).message))
    }, 400)
    return () => clearTimeout(t)
  }, [url])

  const run = (opts: { fromLink: boolean; captionsOnly?: boolean }) =>
    autoClip({
      url: opts.fromLink ? url : undefined,
      info: opts.fromLink && info ? info : undefined,
      captionsOnly: opts.captionsOnly,
      choices: { maxHeight: quality, start: parseTime(from), end: parseTime(to), liveMode, liveMinutes },
    })

  const cancel = () => {
    if (job.stage === 'link') stopLink()
    else if (['audio', 'model', 'transcribe'].includes(job.stage)) cancelTranscription()
  }

  const shown = clipsFor === masterId ? clips : []

  return (
    <div className="panel-body">
      <Section title="Paste a link">
        <label className="link-input">
          <Link2 size={15} />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text').trim()
              if (!isUrl(text)) return
              e.preventDefault()
              receiveLink(text, 'paste')
            }}
            onKeyDown={(e) => e.key === 'Enter' && canFetch && !busy && void run({ fromLink: true })}
            placeholder={canImportPlatformLinks() ? 'Paste a YouTube, Twitch, Kick, X, TikTok… or live link' : 'Paste a video link'}
            aria-label="Video link"
            inputMode="url"
          />
          {url && (
            <button type="button" className="icon-btn sm ghost" aria-label="Clear link" onClick={() => setUrl('')}>
              <X size={13} />
            </button>
          )}
        </label>
        {!url && <p className="hint">Paste a link anywhere in the app (Ctrl/⌘+V) and clipping starts by itself.</p>}
        {needsHandoff && (
          <div className="handoff">
            <p>
              Browsers can't download from YouTube, Twitch and similar sites. Pick one:
            </p>
            <a className="btn primary full" href={desktopHandoffUrl(url)}>
              <MonitorDown size={15} /> Clip it in the desktop app
            </a>
            <button type="button" className="btn full" onClick={() => onOpenSettings('app')}>
              <Server size={14} /> Use a link server
            </button>
            <a className="link small" href="https://github.com/DeekshithRajBasa/Spiti-Video-Splitter/releases/latest" target="_blank" rel="noreferrer">
              Get the desktop app <ExternalLink size={11} />
            </a>
          </div>
        )}
        {platformLink && canImportPlatformLinks() && !info && !infoErr && !busy && (
          <p className="hint">
            <Loader2 size={12} className="spin" /> Looking up the link…
          </p>
        )}
        {infoErr && <p className="error-text">{infoErr}</p>}
        {info && (
          <div className="link-card">
            {info.thumbnail && <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />}
            <div>
              <strong>{info.title}</strong>
              <span>
                {info.isLive ? (
                  <em className="live-badge">
                    <Radio size={11} /> LIVE
                  </em>
                ) : (
                  info.duration > 0 && fmtElapsed(info.duration)
                )}{' '}
                · {info.site}
                {info.uploader && ` · ${info.uploader}`}
              </span>
            </div>
          </div>
        )}
        {platformLink && canImportPlatformLinks() && (
          <>
            <Field label="Quality" group>
              <Segmented<number>
                value={quality}
                small
                options={[480, 720, 1080, 1440, 2160].map((v) => ({ value: v, label: v === 2160 ? '4K' : `${v}p` }))}
                onChange={setQuality}
              />
            </Field>
            {info?.isLive ? (
              <>
                <Field label="Record" group>
                  <Segmented<'now' | 'start'>
                    value={liveMode}
                    small
                    options={[
                      { value: 'now', label: 'From now' },
                      { value: 'start', label: 'From the start', title: 'YouTube only: download the stream from its beginning' },
                    ]}
                    onChange={setLiveMode}
                  />
                </Field>
                <Slider
                  label="Stop recording after"
                  value={liveMinutes}
                  min={0}
                  max={240}
                  step={5}
                  onChange={setLiveMinutes}
                  format={(v) => (v ? `${v} min` : 'when I press Stop')}
                />
              </>
            ) : (
              <div className="two">
                <Field label="From" hint="optional">
                  <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0:00" inputMode="numeric" />
                </Field>
                <Field label="To" hint="optional">
                  <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="end" inputMode="numeric" />
                </Field>
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        title="Clip finder"
        right={
          <button type="button" className="btn ghost sm" onClick={() => onOpenSettings()}>
            <Settings2 size={13} /> Models
          </button>
        }
      >
        <Segmented<ClipMode>
          value={s.clipMode}
          options={[
            { value: 'auto', label: 'Auto', title: 'AI when it is set up, Local otherwise' },
            { value: 'local', label: 'Local', title: 'Offline scoring, no AI model' },
            { value: 'ai', label: 'AI', title: 'Always use the AI model' },
          ]}
          onChange={(v) => aiSettings.set({ clipMode: v })}
        />
        <p className="hint">
          {s.clipMode === 'local'
            ? 'Scores hooks, questions, energy, pace and payoff. Works offline, nothing leaves your device.'
            : `${s.clipMode === 'auto' ? 'Uses' : 'Always uses'} ${prov.name}${provModel ? ` · ${provModel}` : ''} (${prov.kind === 'local' ? 'on your computer' : 'cloud, sends the transcript text'})${s.clipMode === 'auto' ? ', and falls back to Local if it isn’t available' : ''}.`}{' '}
          Speech: {modelInfo(s.whisperModel).name}.
        </p>
        <div className="two">
          <Slider label="Clips" value={s.clipCount} min={1} max={15} step={1} onChange={(v) => aiSettings.set({ clipCount: v })} />
          <Slider label="Length" value={s.maxLength} min={15} max={180} step={5} onChange={(v) => aiSettings.set({ maxLength: v, minLength: Math.min(s.minLength, v - 5) })} format={(v) => `${s.minLength}–${v}s`} />
        </div>
        <Slider label="Shortest clip" value={s.minLength} min={5} max={120} step={5} onChange={(v) => aiSettings.set({ minLength: v, maxLength: Math.max(s.maxLength, v + 5) })} format={(v) => `${v}s`} />
        <Toggle label="Add word-by-word captions" checked={s.autoCaptions} onChange={(v) => aiSettings.set({ autoCaptions: v })} />
        <Toggle label="Hook as headline" checked={s.hookHeadline} onChange={(v) => aiSettings.set({ hookHeadline: v })} />
        <Toggle label="Start as soon as I paste a link" checked={s.autoStart} onChange={(v) => aiSettings.set({ autoStart: v })} />

        {canFetch ? (
          <button type="button" className="btn primary full" disabled={busy} onClick={() => void run({ fromLink: true })}>
            {info?.isLive ? <Radio size={15} /> : <Sparkles size={15} />}
            {info?.isLive ? 'Record & auto clip' : 'Download & auto clip'}
          </button>
        ) : needsHandoff ? null : (
          <button type="button" className="btn primary full" disabled={busy || !master} onClick={() => void run({ fromLink: false })}>
            <Sparkles size={15} /> Auto clip {master ? 'this video' : ''}
          </button>
        )}
        <button type="button" className="btn full" disabled={busy || !master} onClick={() => void run({ fromLink: false, captionsOnly: true })}>
          <Captions size={14} /> Auto captions only
        </button>
        {tr && (
          <p className="hint">
            Transcript ready: {tr.words.length.toLocaleString()} words, {fmtShort(tr.range[1] - tr.range[0])}. Set In/Out to transcribe only part of a long video.
          </p>
        )}
      </Section>

      {(job.stage !== 'idle' || job.error) && (
        <div className={`job ${job.stage}`} role="status">
          <div className="job-top">
            {busy ? <Loader2 size={14} className="spin" /> : job.stage === 'error' ? <X size={14} /> : <Wand2 size={14} />}
            <span>{job.error || job.message}</span>
            {busy && (job.stoppable || ['audio', 'model', 'transcribe'].includes(job.stage)) && (
              <button type="button" className="btn sm" onClick={cancel}>
                <CircleStop size={13} /> {job.stage === 'link' && job.message.startsWith('Recording') ? 'Stop & clip' : 'Cancel'}
              </button>
            )}
            {!busy && (
              <button type="button" className="icon-btn sm ghost" aria-label="Dismiss" onClick={() => aiStore.job({ stage: 'idle', message: '', error: undefined })}>
                <X size={13} />
              </button>
            )}
          </div>
          {busy && (
            <div className={`bar ${job.progress == null ? 'indeterminate' : ''}`}>
              <i style={{ width: `${(job.progress ?? 0.3) * 100}%` }} />
            </div>
          )}
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}

      {shown.length > 0 && (
        <Section
          title={`Clips (${shown.length})`}
          right={
            <button
              type="button"
              className="btn sm"
              disabled={busy || !!batch}
              onClick={async () => {
                await exportClipsBatch(shown, (i, n) => setBatch(`${i + 1}/${n}`))
                setBatch('')
              }}
            >
              <Download size={13} /> {batch ? `Exporting ${batch}` : 'Export all'}
            </button>
          }
        >
          <div className="clip-list">
            {shown.map((c, i) => (
              <ClipCard key={c.id} c={c} n={i + 1} active={active === c.id} />
            ))}
          </div>
        </Section>
      )}
      {ai && !s.providers[s.provider].model && s.provider !== 'anthropic' && (
        <p className="hint">
          Tip: open <b>Models</b> to pick an AI model{prov.kind === 'local' ? ` installed in ${prov.name}` : ''}.
        </p>
      )}
    </div>
  )
}

function ClipCard({ c, n, active }: { c: ClipSuggestion; n: number; active: boolean }) {
  return (
    <div className={`clip-card ${active ? 'on' : ''}`}>
      <div className="clip-head">
        <span className={`score s${Math.floor(c.score / 25)}`}>{c.score}</span>
        <div>
          <strong>
            {n}. {c.title}
          </strong>
          <span>
            {fmtShort(c.start)}–{fmtShort(c.end)} · {Math.round(c.end - c.start)}s · {c.source === 'ai' ? 'AI' : 'Local'}
          </span>
        </div>
      </div>
      {c.hook && c.hook !== c.title && <p className="clip-hook">“{c.hook}”</p>}
      <p className="clip-reason">{c.reason}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            applyClip(c)
            setTimeout(() => engine.play(), 150)
          }}
        >
          <Play size={13} /> Preview
        </button>
        <button type="button" className="btn sm" onClick={() => applyClip(c)}>
          <Wand2 size={13} /> Edit
        </button>
        <button
          type="button"
          className="btn sm dark-sm"
          onClick={() => {
            applyClip(c)
            setTimeout(() => void runExport(), 150)
          }}
        >
          <Download size={13} /> Export
        </button>
      </div>
    </div>
  )
}
