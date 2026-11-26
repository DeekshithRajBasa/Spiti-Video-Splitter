import { Camera, Download, Film, Loader2, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { addSfx } from '../lib/actions'
import { canvasSize, engine, pickMime } from '../lib/engine'
import { download } from '../lib/media'
import { fmtShort, totalDuration } from '../lib/timeline'
import { FONTS } from '../defaults'
import { store, useMedia, useProject, useUi } from '../store'
import type { BgMode, Corner, Project } from '../types'
import { FrameEditor } from './FrameEditor'
import { ColorInput, Field, Section, Segmented, Slider, Toggle } from './ui'

const pct = (v: number) => `${Math.round(v * 100)}%`
type P = Project

function up(fn: (d: P) => void, key?: string) {
  store.update((d) => void fn(d), key)
}

export function Inspector() {
  const ui = useUi()
  return (
    <div className="panel-body">
      {ui.rightTab === 'frame' && <FrameTab />}
      {ui.rightTab === 'style' && <StyleTab />}
      {ui.rightTab === 'audio' && <AudioTab />}
      {ui.rightTab === 'export' && <ExportTab />}
    </div>
  )
}

function FrameTab() {
  const p = useProject()
  return (
    <>
      <FrameEditor />
      <Section title="Card">
        <Slider label="Padding" value={p.background.padding} min={0} max={15} step={0.5} onChange={(v) => up((d) => (d.background.padding = v), 'pad')} format={(v) => `${v}%`} />
        <Slider label="Corner radius" value={p.background.radius} min={0} max={10} step={0.25} onChange={(v) => up((d) => (d.background.radius = v), 'rad')} format={(v) => `${v}%`} />
        <Slider label="Card shadow" value={p.background.shadow} min={0} max={1} onChange={(v) => up((d) => (d.background.shadow = v), 'shadow')} format={pct} />
        {(p.layout === 'split' || p.layout === 'trio') && (
          <>
            <Slider label="Divider size" value={p.background.dividerSize} min={0} max={20} step={1} onChange={(v) => up((d) => (d.background.dividerSize = v), 'div')} />
            <ColorInput label="Divider colour" value={p.background.dividerColor} onChange={(v) => up((d) => (d.background.dividerColor = v), 'divc')} />
          </>
        )}
      </Section>
      <BackgroundSection />
    </>
  )
}

function BackgroundSection() {
  const p = useProject()
  const media = useMedia()
  const bg = p.background
  const images = Object.values(media).filter((m) => m.kind === 'image')
  return (
    <Section title="Background">
      <Segmented<BgMode>
        value={bg.mode}
        options={[
          { value: 'blur', label: 'Blur' },
          { value: 'color', label: 'Color' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'image', label: 'Image' },
        ]}
        onChange={(v) => up((d) => (d.background.mode = v))}
      />
      {bg.mode === 'color' && <ColorInput label="Colour" value={bg.color} onChange={(v) => up((d) => (d.background.color = v), 'bgc')} />}
      {bg.mode === 'gradient' && (
        <>
          <div className="color-row">
            <ColorInput label="From" value={bg.gradientFrom} onChange={(v) => up((d) => (d.background.gradientFrom = v), 'g1')} />
            <ColorInput label="To" value={bg.gradientTo} onChange={(v) => up((d) => (d.background.gradientTo = v), 'g2')} />
          </div>
          <Slider label="Angle" value={bg.gradientAngle} min={0} max={360} step={1} onChange={(v) => up((d) => (d.background.gradientAngle = v), 'ga')} format={(v) => `${v}°`} />
        </>
      )}
      {bg.mode === 'image' && (
        <Field label="Image">
          <select value={bg.imageId ?? ''} onChange={(e) => up((d) => (d.background.imageId = e.target.value || null))}>
            <option value="">Import an image in Media first</option>
            {images.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(bg.mode === 'blur' || bg.mode === 'image') && (
        <>
          <Slider label="Blur" value={bg.blur} min={0} max={120} step={1} onChange={(v) => up((d) => (d.background.blur = v), 'blur')} />
          <Slider label="Dim" value={bg.dim} min={0} max={0.9} onChange={(v) => up((d) => (d.background.dim = v), 'dim')} format={pct} />
        </>
      )}
    </Section>
  )
}

function StyleTab() {
  const p = useProject()
  const s = p.captionStyle
  const h = p.headline
  return (
    <>
      <Section title="Caption style">
        <div className="two">
          <Field label="Font">
            <select value={s.font} onChange={(e) => up((d) => (d.captionStyle.font = e.target.value))}>
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
          <Field label="Weight">
            <select value={s.weight} onChange={(e) => up((d) => (d.captionStyle.weight = Number(e.target.value)))}>
              {[500, 600, 700, 800, 900].map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </Field>
        </div>
        <Slider label="Size" value={s.size} min={3} max={12} step={0.1} onChange={(v) => up((d) => (d.captionStyle.size = v), 'cs')} format={(v) => v.toFixed(1)} />
        <Slider label="Vertical position" value={s.y} min={0.1} max={0.92} onChange={(v) => up((d) => (d.captionStyle.y = v), 'cy')} format={pct} />
        <div className="two">
          <Slider label="Letters per line" value={s.maxChars} min={8} max={42} step={1} onChange={(v) => up((d) => (d.captionStyle.maxChars = v), 'cm')} />
          <Slider label="Lines" value={s.maxLines} min={1} max={3} step={1} onChange={(v) => up((d) => (d.captionStyle.maxLines = v), 'cl')} />
        </div>
        <div className="color-row">
          <ColorInput label="Text" value={s.color} onChange={(v) => up((d) => (d.captionStyle.color = v), 'cc')} />
          <ColorInput label="Spoken" value={s.activeColor} onChange={(v) => up((d) => (d.captionStyle.activeColor = v), 'ca')} />
          <ColorInput label="Box" value={s.boxColor} onChange={(v) => up((d) => (d.captionStyle.boxColor = v), 'cb')} />
          <ColorInput label="Outline" value={s.strokeColor} onChange={(v) => up((d) => (d.captionStyle.strokeColor = v), 'co')} />
        </div>
        <Slider label="Outline" value={s.strokeWidth} min={0} max={2} onChange={(v) => up((d) => (d.captionStyle.strokeWidth = v), 'sw')} format={(v) => v.toFixed(2)} />
        <Slider label="Shadow / glow" value={s.shadow} min={0} max={1} onChange={(v) => up((d) => (d.captionStyle.shadow = v), 'sh')} format={pct} />
        <Toggle label="UPPERCASE" checked={s.uppercase} onChange={(v) => up((d) => (d.captionStyle.uppercase = v))} />
      </Section>

      <Section title="Headline hook" right={<Toggle label="" checked={h.enabled} onChange={(v) => up((d) => (d.headline.enabled = v))} />}>
        <Field label="Headline">
          <textarea rows={2} value={h.text} onChange={(e) => up((d) => (d.headline.text = e.target.value), 'ht')} />
        </Field>
        <Field label="Subline">
          <input value={h.subline} onChange={(e) => up((d) => (d.headline.subline = e.target.value), 'hs')} />
        </Field>
        <div className="two">
          <Field label="Font">
            <select value={h.font} onChange={(e) => up((d) => (d.headline.font = e.target.value))}>
              {FONTS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
          <div className="color-row">
            <ColorInput label="Text" value={h.color} onChange={(v) => up((d) => (d.headline.color = v), 'hc')} />
            <ColorInput label="Box" value={h.bgColor} onChange={(v) => up((d) => (d.headline.bgColor = v), 'hb')} />
          </div>
        </div>
        <Slider label="Size" value={h.size} min={3} max={10} step={0.1} onChange={(v) => up((d) => (d.headline.size = v), 'hsz')} format={(v) => v.toFixed(1)} />
        <Slider label="Position" value={h.y} min={0.02} max={0.8} onChange={(v) => up((d) => (d.headline.y = v), 'hy')} format={pct} />
        <Toggle label="Box behind headline" checked={h.bgEnabled} onChange={(v) => up((d) => (d.headline.bgEnabled = v))} />
      </Section>

      <BrandSection />
    </>
  )
}

function BrandSection() {
  const p = useProject()
  const media = useMedia()
  const w = p.watermark
  const o = p.outro
  const images = Object.values(media).filter((m) => m.kind === 'image')
  return (
    <>
      <Section title="Watermark" right={<Toggle label="" checked={w.enabled} onChange={(v) => up((d) => (d.watermark.enabled = v))} />}>
        <Field label="Logo">
          <select value={w.imageId ?? ''} onChange={(e) => up((d) => (d.watermark.imageId = e.target.value || null))}>
            <option value="">Text only</option>
            {images.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        {!w.imageId && (
          <Field label="Text">
            <input value={w.text} onChange={(e) => up((d) => (d.watermark.text = e.target.value), 'wt')} />
          </Field>
        )}
        <Segmented<Corner>
          value={w.position}
          options={[
            { value: 'tl', label: '↖' },
            { value: 'tr', label: '↗' },
            { value: 'bl', label: '↙' },
            { value: 'br', label: '↘' },
          ]}
          onChange={(v) => up((d) => (d.watermark.position = v))}
        />
        <Slider label="Size" value={w.size} min={0.06} max={0.4} onChange={(v) => up((d) => (d.watermark.size = v), 'ws')} format={pct} />
        <Slider label="Opacity" value={w.opacity} min={0.1} max={1} onChange={(v) => up((d) => (d.watermark.opacity = v), 'wo')} format={pct} />
      </Section>
      <Section title="Outro card" right={<Toggle label="" checked={o.enabled} onChange={(v) => up((d) => (d.outro.enabled = v))} />}>
        <Field label="Call to action">
          <input value={o.text} onChange={(e) => up((d) => (d.outro.text = e.target.value), 'ot')} />
        </Field>
        <Field label="Handle">
          <input value={o.handle} onChange={(e) => up((d) => (d.outro.handle = e.target.value), 'oh')} />
        </Field>
        <Slider label="Length" value={o.duration} min={1} max={6} step={0.5} onChange={(v) => up((d) => (d.outro.duration = v), 'od')} format={(v) => `${v}s`} />
        <ColorInput label="Button colour" value={o.color} onChange={(v) => up((d) => (d.outro.color = v), 'oc')} />
        <p className="hint">Uses the avatar from the Templates tab.</p>
      </Section>
    </>
  )
}

function AudioTab() {
  const p = useProject()
  const media = useMedia()
  const audio = Object.values(media).filter((m) => m.kind === 'audio')
  const m = p.music
  const d = totalDuration(p.segments)
  return (
    <>
      <Section title="Video audio">
        <Slider label="Voice volume" value={p.sourceVolume} min={0} max={2} onChange={(v) => up((x) => (x.sourceVolume = v), 'sv')} format={pct} />
      </Section>
      <Section title="Music">
        <Field label="Track">
          <select value={m.mediaId ?? ''} onChange={(e) => up((x) => (x.music.mediaId = e.target.value || null))}>
            <option value="">No music</option>
            {audio.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Slider label="Volume" value={m.volume} min={0} max={1} onChange={(v) => up((x) => (x.music.volume = v), 'mv')} format={pct} />
        <Slider label="Peak volume" value={m.peakVolume} min={0} max={1} onChange={(v) => up((x) => (x.music.peakVolume = v), 'mp')} format={pct} />
        <Slider label="Riser length" value={m.riser} min={0} max={15} step={0.5} onChange={(v) => up((x) => (x.music.riser = v), 'mr')} format={(v) => `${v}s`} />
        <Slider label="Start offset in song" value={m.offset} min={0} max={Math.max(1, (m.mediaId && media[m.mediaId]?.duration) || 60)} step={0.5} onChange={(v) => up((x) => (x.music.offset = v), 'mo')} format={fmtShort} />
        <MusicCurve volume={m.volume} peak={m.peakVolume} riser={m.riser} duration={d} />
      </Section>
      <Section
        title={`Sound effects (${p.sfx.length})`}
        right={
          audio.length ? (
            <select
              className="mini-select"
              value=""
              aria-label="Add sound effect at playhead"
              onChange={(e) => {
                const a = media[e.target.value]
                if (a) void addSfx(a)
              }}
            >
              <option value="">+ at playhead</option>
              {audio.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        {p.sfx.map((s) => (
          <div key={s.id} className="sfx-row">
            <button type="button" className="link" onClick={() => engine.seek(s.at)}>
              {fmtShort(s.at)}
            </button>
            <span className="ellipsis">{media[s.mediaId]?.name}</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={s.volume}
              aria-label="Sound effect volume"
              onChange={(e) =>
                up((x) => {
                  const k = x.sfx.find((z) => z.id === s.id)
                  if (k) k.volume = Number(e.target.value)
                }, `sfx-${s.id}`)
              }
            />
            <button type="button" className="icon-btn sm" aria-label="Remove sound effect" onClick={() => up((x) => (x.sfx = x.sfx.filter((z) => z.id !== s.id)))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!p.sfx.length && <p className="muted">Import a whoosh or pop in Media, then drop it at the playhead.</p>}
        {audio.length === 0 && (
          <button type="button" className="btn ghost sm" onClick={() => store.ui({ leftTab: 'media' })}>
            <Plus size={13} /> Import audio
          </button>
        )}
      </Section>
    </>
  )
}

function MusicCurve({ volume, peak, riser, duration }: { volume: number; peak: number; riser: number; duration: number }) {
  const W = 260
  const H = 48
  const d = Math.max(duration, riser + 1, 1)
  const xs = (t: number) => (t / d) * W
  const ys = (v: number) => H - 4 - v * (H - 8)
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * d
    let v = volume
    if (riser > 0 && t > d - riser) {
      const k = (t - (d - riser)) / riser
      v = volume + (peak - volume) * k * k
    }
    pts.push(`${xs(t).toFixed(1)},${ys(v).toFixed(1)}`)
  }
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Music volume over the clip">
      <polyline points={pts.join(' ')} fill="none" strokeWidth="2" />
      <text x="4" y="12">
        {pct(volume)}
      </text>
      <text x={W - 4} y="12" textAnchor="end">
        Peak {pct(peak)}
      </text>
    </svg>
  )
}

function ExportTab() {
  const p = useProject()
  const ui = useUi()
  const e = p.export
  const [w, h] = canvasSize(p, e.resolution)
  const m = pickMime()
  const mime = m.includes('avc1') ? 'MP4 (H.264)' : m.includes('mp4') ? 'MP4' : m ? 'WebM' : 'Not supported in this browser'
  const d = totalDuration(p.segments)
  return (
    <>
      <Section title="Export">
        <Field label="Resolution" group>
          <Segmented<number>
            value={e.resolution}
            options={[
              { value: 720, label: '720p' },
              { value: 1080, label: '1080p' },
              { value: 1440, label: '2K' },
              { value: 2160, label: '4K' },
            ]}
            onChange={(v) => up((x) => (x.export.resolution = v as P['export']['resolution']))}
          />
        </Field>
        <Field label="Frame rate" group>
          <Segmented<number>
            value={e.fps}
            options={[24, 30, 60].map((f) => ({ value: f, label: `${f} fps` }))}
            onChange={(v) => up((x) => (x.export.fps = v as P['export']['fps']))}
          />
        </Field>
        <Slider label="Quality (bitrate at 1080p)" value={e.bitrate} min={4} max={40} step={1} onChange={(v) => up((x) => (x.export.bitrate = v), 'br')} format={(v) => `${v} Mbps`} />
        <dl className="specs">
          <dt>Output</dt>
          <dd>
            {w} × {h}
          </dd>
          <dt>Format</dt>
          <dd>{mime}</dd>
          <dt>Length</dt>
          <dd>{fmtShort(d)}</dd>
        </dl>
        <ExportButton full />
        <button
          type="button"
          className="btn full"
          disabled={!p.slots[0].sourceId}
          onClick={async () => {
            const b = await engine.snapshot()
            if (b) download(b, `${p.name}-frame.png`)
          }}
        >
          <Camera size={14} /> Save this frame as PNG
        </button>
        <p className="hint">
          Rendering runs on your computer in real time and uses your browser's hardware encoder. Keep this tab open until it finishes.
        </p>
      </Section>
      {ui.exporting && <ExportProgress />}
    </>
  )
}

export function ExportButton({ full }: { full?: boolean }) {
  const p = useProject()
  const ui = useUi()
  const [busy, setBusy] = useState(false)
  const disabled = !p.slots[0].sourceId || busy || !!ui.exporting
  return (
    <button
      type="button"
      className={`btn dark ${full ? 'full' : ''}`}
      disabled={disabled}
      onClick={async () => {
        setBusy(true)
        try {
          const r = await engine.export()
          if (r) download(r.blob, `${p.name}.${r.ext}`)
        } catch (err) {
          alert(`Export failed: ${(err as Error).message}`)
          store.ui({ exporting: null })
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 size={15} className="spin" /> : full ? <Film size={15} /> : <Download size={15} />} Export
    </button>
  )
}

export function ExportProgress() {
  const ui = useUi()
  if (!ui.exporting) return null
  const pr = ui.exporting.progress
  return (
    <div className="export-toast" role="status">
      <div className="export-top">
        <Loader2 size={15} className="spin" />
        <span>
          {ui.exporting.status} · {Math.round(pr * 100)}%
        </span>
        <button type="button" className="icon-btn sm" aria-label="Cancel export" onClick={() => engine.cancelExport()}>
          <X size={14} />
        </button>
      </div>
      <div className="bar">
        <i style={{ width: `${pr * 100}%` }} />
      </div>
    </div>
  )
}
