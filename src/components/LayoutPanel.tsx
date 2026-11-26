import { ArrowUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { store, useMedia, useProject } from '../store'
import type { CanvasRatio, LayoutId, PipCorner, PipShape, SplitMode } from '../types'
import { Field, Section, Segmented, Slider } from './ui'

const LAYOUTS: { id: LayoutId; label: string; svg: ReactNode }[] = [
  { id: 'solo', label: 'Solo', svg: <rect x="2" y="2" width="20" height="36" rx="2" /> },
  {
    id: 'split',
    label: 'Split',
    svg: (
      <>
        <rect x="2" y="2" width="20" height="17" rx="2" />
        <rect x="2" y="21" width="20" height="17" rx="2" />
      </>
    ),
  },
  {
    id: 'pip',
    label: 'PiP',
    svg: (
      <>
        <rect x="2" y="2" width="20" height="36" rx="2" opacity=".45" />
        <rect x="11" y="25" width="9" height="9" rx="4.5" />
      </>
    ),
  },
  {
    id: 'trio',
    label: 'Trio',
    svg: (
      <>
        <rect x="2" y="2" width="20" height="17" rx="2" />
        <rect x="2" y="21" width="9" height="17" rx="2" />
        <rect x="13" y="21" width="9" height="17" rx="2" />
      </>
    ),
  },
  {
    id: 'centered',
    label: 'Centered',
    svg: (
      <>
        <rect x="2" y="2" width="20" height="36" rx="2" opacity=".3" />
        <rect x="2" y="14" width="20" height="12" rx="1" />
      </>
    ),
  },
]

const RATIOS: CanvasRatio[] = ['9:16', '4:5', '1:1', '3:4', '16:9']

export function LayoutPanel() {
  const p = useProject()
  const media = useMedia()
  const visual = Object.values(media).filter((m) => m.kind !== 'audio')
  const slotsUsed = p.layout === 'trio' ? 3 : p.layout === 'split' || p.layout === 'pip' ? 2 : 1

  const swap = () =>
    store.update((d) => {
      const [a, b] = d.slots
      const crop = a.crop
      a.crop = b.crop
      b.crop = crop
      // Swapping two different cameras: the new main video keeps the cuts, clamped to its length.
      const bm = b.sourceId ? media[b.sourceId] : null
      if (bm?.kind === 'video' && b.sourceId !== a.sourceId) {
        b.sourceId = a.sourceId
        a.sourceId = bm.id
        d.segments = d.segments
          .map((s) => ({ ...s, end: Math.min(s.end, bm.duration) }))
          .filter((s) => s.end - s.start > 0.05)
      }
    })

  return (
    <div className="panel-body">
      <Section title="Canvas">
        <Segmented
          value={p.canvas}
          options={RATIOS.map((r) => ({ value: r, label: r }))}
          onChange={(v) =>
            store.update((d) => {
              d.canvas = v
            })
          }
        />
      </Section>
      <Section title="Layout">
        <div className="layout-grid">
          {LAYOUTS.map((l) => (
            <button
              type="button"
              key={l.id}
              className={`layout-card ${p.layout === l.id ? 'on' : ''}`}
              onClick={() =>
                store.update((d) => {
                  d.layout = l.id
                  if (l.id === 'trio' && d.splitRatio > 0.6) d.splitRatio = 0.5
                })
              }
            >
              <svg viewBox="0 0 24 40" width="24" height="40" aria-hidden>
                {l.svg}
              </svg>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {p.layout === 'split' && (
        <Section title="Split">
          <Segmented<SplitMode>
            value={p.splitMode}
            options={[
              { value: 'even', label: 'Even' },
              { value: 'wide-top', label: '16:9 top' },
              { value: 'wide-bottom', label: '16:9 bottom' },
            ]}
            onChange={(v) =>
              store.update((d) => {
                d.splitMode = v
              })
            }
          />
          {p.splitMode === 'even' && (
            <Slider
              label="Divider position"
              value={p.splitRatio}
              min={0.25}
              max={0.75}
              onChange={(v) => store.update((d) => void (d.splitRatio = v), 'split')}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
        </Section>
      )}
      {p.layout === 'trio' && (
        <Section title="Trio">
          <Slider
            label="Top height"
            value={p.splitRatio}
            min={0.3}
            max={0.7}
            onChange={(v) => store.update((d) => void (d.splitRatio = v), 'split')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Section>
      )}
      {p.layout === 'pip' && (
        <Section title="Picture in picture">
          <Field label="Shape" group>
            <Segmented<PipShape>
              value={p.pipShape}
              options={[
                { value: 'rect', label: 'Square' },
                { value: 'rounded', label: 'Rounded' },
                { value: 'circle', label: 'Circle' },
              ]}
              onChange={(v) => store.update((d) => void (d.pipShape = v))}
            />
          </Field>
          <Field label="Corner" group>
            <Segmented<PipCorner>
              value={p.pipCorner}
              options={[
                { value: 'tl', label: '↖' },
                { value: 'tr', label: '↗' },
                { value: 'bl', label: '↙' },
                { value: 'br', label: '↘' },
              ]}
              onChange={(v) => store.update((d) => void (d.pipCorner = v))}
            />
          </Field>
          <Slider
            label="Size"
            value={p.pipSize}
            min={0.18}
            max={0.6}
            onChange={(v) => store.update((d) => void (d.pipSize = v), 'pip')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Section>
      )}

      {slotsUsed > 1 && (
        <Section
          title="Sources"
          right={
            <button type="button" className="btn ghost sm" onClick={swap} title="Swap slot 1 and 2">
              <ArrowUpDown size={13} /> Swap
            </button>
          }
        >
          {p.slots.slice(1, slotsUsed).map((s, i) => (
            <Field key={i} label={`Slot ${i + 2}`}>
              <select
                value={s.sourceId ?? ''}
                onChange={(e) => store.update((d) => void (d.slots[i + 1].sourceId = e.target.value || null))}
              >
                <option value="">Same as main video</option>
                {visual.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.kind === 'image' ? '🖼 ' : '🎬 '}
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <p className="hint">Frame each slot in the Frame tab on the right. Use the same video twice to split a host and guest.</p>
        </Section>
      )}
    </div>
  )
}
