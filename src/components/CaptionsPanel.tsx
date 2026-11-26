import { Download, FileUp, Plus, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addCueAtPlayhead } from '../lib/actions'
import { parseSubtitles, textToCues, toSrt } from '../lib/captions'
import { engine } from '../lib/engine'
import { download } from '../lib/media'
import { fmtShort, sourceToOut } from '../lib/timeline'
import { store, useProject, useUi } from '../store'
import type { CaptionAnim } from '../types'
import { Section, Slider, Toggle } from './ui'

export const ANIMS: { id: CaptionAnim; label: string; desc: string }[] = [
  { id: 'pop-in', label: 'Pop-In', desc: 'One word at a time, popping' },
  { id: 'pop-in-line', label: 'Pop-In Line', desc: 'Full line, spoken word pops' },
  { id: 'one-by-one', label: 'One-by-One', desc: 'Words appear as spoken' },
  { id: 'build-up', label: 'Build Up', desc: 'Words stack in with a bounce' },
  { id: 'highlight', label: 'Highlight', desc: 'Box behind the spoken word' },
  { id: 'full-line', label: 'Full Line', desc: 'Static line, fades in' },
]

export function CaptionsPanel() {
  const p = useProject()
  const ui = useUi()
  const file = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [wps, setWps] = useState(2.6)
  const selected = ui.selection?.kind === 'cue' ? ui.selection.id : null
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selected) return
    listRef.current?.querySelector(`[data-cue="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div className="panel-body">
      <input
        ref={file}
        type="file"
        hidden
        accept=".srt,.vtt,.ass,.ssa"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const cues = parseSubtitles(await f.text())
          store.update((d) => {
            d.cues = cues
            d.captionsEnabled = true
          })
          e.target.value = ''
        }}
      />
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => file.current?.click()}>
          <FileUp size={14} /> Import .srt / .ass
        </button>
        <button
          type="button"
          className="btn"
          disabled={!p.cues.length}
          onClick={() => download(new Blob([toSrt(p.cues)], { type: 'text/plain' }), `${p.name}.srt`)}
        >
          <Download size={14} /> .srt
        </button>
      </div>
      <Toggle
        label="Show captions"
        checked={p.captionsEnabled}
        onChange={(v) =>
          store.update((d) => {
            d.captionsEnabled = v
          })
        }
      />

      <Section title="Animation">
        <div className="anim-grid">
          {ANIMS.map((a) => (
            <button
              type="button"
              key={a.id}
              className={`anim-card ${p.captionStyle.animation === a.id ? 'on' : ''}`}
              onClick={() =>
                store.update((d) => {
                  d.captionStyle.animation = a.id
                })
              }
              title={a.desc}
            >
              <span className={`anim-demo demo-${a.id}`}>
                <b>YOU</b> <i>CAN</i> <b>WIN</b>
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Type captions">
        <textarea
          rows={3}
          placeholder="Paste or type a transcript. It will be timed from the playhead."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Slider label="Speaking speed" value={wps} min={1.2} max={4.5} step={0.1} onChange={setWps} format={(v) => `${v.toFixed(1)} words/s`} />
        <button
          type="button"
          className="btn primary full"
          disabled={!draft.trim()}
          onClick={() => {
            const cues = textToCues(draft, engine.srcTime, wps)
            store.update((d) => {
              d.cues = [...d.cues, ...cues].sort((a, b) => a.start - b.start)
              d.captionsEnabled = true
            })
            setDraft('')
          }}
        >
          <Wand2 size={14} /> Add timed captions
        </button>
        <p className="hint">
          Style one word: <code>*word*</code> accent, <code>_word_</code> italic, <code>[word]</code> box.
        </p>
      </Section>

      <Section
        title={`Captions (${p.cues.length})`}
        right={
          <div className="btn-row tight">
            <button type="button" className="btn ghost sm" onClick={() => addCueAtPlayhead()} title="Add at playhead">
              <Plus size={13} />
            </button>
            {p.cues.length > 0 && (
              <button
                type="button"
                className="btn ghost sm"
                title="Remove all"
                onClick={() =>
                  confirm('Remove all captions?') &&
                  store.update((d) => {
                    d.cues = []
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        }
      >
        <div className="cue-list" ref={listRef}>
          {p.cues.map((c) => {
            const out = sourceToOut(p.segments, c.start)
            return (
              <div
                key={c.id}
                data-cue={c.id}
                className={`cue ${selected === c.id ? 'on' : ''} ${out == null ? 'cut' : ''}`}
                onClick={() => {
                  store.ui({ selection: { kind: 'cue', id: c.id } })
                  if (out != null) engine.seek(out + 0.01)
                }}
              >
                <div className="cue-time">
                  <span>{fmtShort(c.start)}</span>
                  <input
                    type="number"
                    step={0.1}
                    value={Number((c.end - c.start).toFixed(2))}
                    title="Duration (s)"
                    aria-label="Caption duration in seconds"
                    onChange={(e) =>
                      store.update((d) => {
                        const x = d.cues.find((k) => k.id === c.id)
                        if (x) x.end = x.start + Math.max(0.1, Number(e.target.value))
                      }, `cue-dur-${c.id}`)
                    }
                  />
                  <span>s</span>
                </div>
                <textarea
                  rows={1}
                  value={c.text}
                  aria-label="Caption text"
                  onChange={(e) =>
                    store.update((d) => {
                      const x = d.cues.find((k) => k.id === c.id)
                      if (x) x.text = e.target.value
                    }, `cue-text-${c.id}`)
                  }
                />
              </div>
            )
          })}
          {!p.cues.length && <p className="muted">No captions yet. Import a subtitle file or type them above.</p>}
        </div>
      </Section>
    </div>
  )
}
