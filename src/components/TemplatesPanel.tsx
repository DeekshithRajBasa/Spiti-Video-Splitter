import { store, useMedia, useProject } from '../store'
import type { TemplateId } from '../types'
import { ColorInput, Field, Section, Toggle } from './ui'

export const TEMPLATES: { id: TemplateId; label: string; kind: string }[] = [
  { id: 'none', label: 'None', kind: '' },
  { id: 'x-light', label: 'X Light', kind: 'Frame' },
  { id: 'x-dark', label: 'X Dark', kind: 'Frame' },
  { id: 'tiktok-hook', label: 'TikTok Hook', kind: 'Sticker' },
  { id: 'breaking-news', label: 'Breaking News', kind: 'Sticker' },
  { id: 'poll', label: 'Poll', kind: 'Sticker' },
  { id: 'comment', label: 'Comment Reply', kind: 'Sticker' },
  { id: 'code', label: 'Code Card', kind: 'Frame' },
  { id: 'quote', label: 'Quote', kind: 'Frame' },
  { id: 'podcast', label: 'Podcast Name', kind: 'Sticker' },
  { id: 'headline-bar', label: 'Headline Bar', kind: 'Sticker' },
]

export function TemplatesPanel() {
  const p = useProject()
  const media = useMedia()
  const t = p.template
  const images = Object.values(media).filter((m) => m.kind === 'image')
  const set = (fn: (d: typeof t) => void, key?: string) => store.update((d) => void fn(d.template), key)
  const usesProfile = ['x-light', 'x-dark', 'comment', 'podcast', 'code'].includes(t.id)

  return (
    <div className="panel-body">
      <div className="tpl-grid">
        {TEMPLATES.map((x) => (
          <button
            type="button"
            key={x.id}
            className={`tpl-card tpl-${x.id} ${t.id === x.id ? 'on' : ''}`}
            onClick={() => set((d) => void (d.id = x.id))}
          >
            <span className="tpl-art" aria-hidden>
              <i />
              <b />
              <u />
            </span>
            <span className="tpl-label">
              {x.label}
              {x.kind && <em>{x.kind}</em>}
            </span>
          </button>
        ))}
      </div>
      {t.id !== 'none' && (
        <Section title="Template content">
          <Field label={t.id === 'poll' ? 'Question' : t.id === 'code' ? 'Code' : 'Hook text'}>
            <textarea rows={3} value={t.text} onChange={(e) => set((d) => void (d.text = e.target.value), 'tpl-text')} />
          </Field>
          {(usesProfile || t.id === 'podcast') && (
            <>
              <Field label="Name">
                <input value={t.name} onChange={(e) => set((d) => void (d.name = e.target.value), 'tpl-name')} />
              </Field>
              <Field label="Handle">
                <input value={t.handle} onChange={(e) => set((d) => void (d.handle = e.target.value), 'tpl-handle')} />
              </Field>
              <Field label="Avatar">
                <select value={t.avatarId ?? ''} onChange={(e) => set((d) => void (d.avatarId = e.target.value || null))}>
                  <option value="">Initial letter</option>
                  {images.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {(t.id === 'x-light' || t.id === 'x-dark') && (
            <Toggle label="Verified badge" checked={t.verified} onChange={(v) => set((d) => void (d.verified = v))} />
          )}
          {t.id === 'breaking-news' && (
            <Field label="Ticker">
              <input value={t.ticker} onChange={(e) => set((d) => void (d.ticker = e.target.value), 'tpl-ticker')} />
            </Field>
          )}
          {t.id === 'poll' && (
            <Field label="Options" hint="one per line">
              <textarea rows={3} value={t.options} onChange={(e) => set((d) => void (d.options = e.target.value), 'tpl-opts')} />
            </Field>
          )}
          <ColorInput label="Accent colour" value={t.accent} onChange={(v) => set((d) => void (d.accent = v), 'tpl-accent')} />
          <p className="hint">Frame templates wrap your clip in a card at 16:9. Stickers sit on top of your layout.</p>
        </Section>
      )}
    </div>
  )
}
