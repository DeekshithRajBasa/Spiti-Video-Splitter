import { Copy, Download, ExternalLink, FolderOpen, MonitorPlay, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { desktop, desktopInfo } from '../lib/desktop'
import { addExistingRenders, clearRenders, removeRender, selectRender, useRenders, type RenderItem } from '../lib/renders'
import { fmtShort } from '../lib/timeline'
import { store, useUi } from '../store'

const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function ago(t: number, now: number) {
  const s = Math.round((now - t) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(t).toLocaleDateString()
}

/** Button that shows the Renders panel, with a count of what's been exported. */
export function RendersButton({ compact }: { compact?: boolean }) {
  const ui = useUi()
  const { items } = useRenders()
  return (
    <button
      type="button"
      className={`btn outline renders-btn ${ui.rendersOpen ? 'on' : ''}`}
      aria-pressed={ui.rendersOpen}
      title="Videos you've rendered"
      onClick={() => store.ui({ rendersOpen: !ui.rendersOpen })}
    >
      <MonitorPlay size={15} />
      {!compact && <span>Renders</span>}
      {items.length > 0 && <b className="count">{items.length}</b>}
    </button>
  )
}

export function RendersDrawer() {
  const ui = useUi()
  const { items, selectedId } = useRenders()
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null

  useEffect(() => {
    if (!ui.rendersOpen) return
    setNow(Date.now())
    const i = setInterval(() => setNow(Date.now()), 15_000)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && store.ui({ rendersOpen: false })
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(i)
      window.removeEventListener('keydown', onKey)
    }
  }, [ui.rendersOpen])

  // Stop playback when the panel closes or the selection changes.
  useEffect(() => () => video.current?.pause(), [selected?.id, ui.rendersOpen])

  if (!ui.rendersOpen) return null
  const win = desktopInfo?.platform === 'win32'

  return (
    <>
      <aside className="renders" role="complementary" aria-label="Rendered videos">
        <header className="renders-head">
          <MonitorPlay size={17} />
          <h3>Renders</h3>
          <span className="muted">{items.length ? `${items.length} video${items.length > 1 ? 's' : ''}` : ''}</span>
          <div className="topbar-spacer" />
          {desktop && (
            <button type="button" className="btn ghost sm" title="Add videos you already exported" onClick={() => void addExistingRenders()}>
              <Plus size={13} /> Add
            </button>
          )}
          {items.length > 0 && (
            <button
              type="button"
              className="btn ghost sm"
              title="Clear this list (your video files are not deleted)"
              onClick={() => confirm(desktop ? 'Clear the list? The video files stay on your computer.' : 'Clear the list? Videos you already downloaded stay in your Downloads.') && clearRenders()}
            >
              Clear
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Close renders" onClick={() => store.ui({ rendersOpen: false })}>
            <X size={16} />
          </button>
        </header>

        {!selected ? (
          <div className="renders-empty">
            <MonitorPlay size={30} />
            <strong>Nothing rendered yet</strong>
            <span>Every video you export shows up here, ready to play, open or share.</span>
            {desktop && (
              <>
                <span>Exported something before? Add it to the list.</span>
                <button type="button" className="btn sm" onClick={() => void addExistingRenders()}>
                  <Plus size={13} /> Add videos…
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <section className="renders-player">
              <div className="player-frame" style={{ aspectRatio: `${selected.width} / ${selected.height}` }}>
                {selected.missing ? (
                  <div className="renders-missing">This file was moved or deleted.</div>
                ) : (
                  <video ref={video} key={selected.id} src={selected.url} poster={selected.thumb || undefined} controls autoPlay playsInline />
                )}
              </div>
              <div className="player-info">
                <strong title={selected.title}>{selected.title}</strong>
                <span>
                  {selected.width}×{selected.height} · {fmtShort(selected.duration)} · {fmtBytes(selected.size)} · {selected.ext.toUpperCase()} · {ago(selected.createdAt, now)}
                </span>
                {selected.path && <span className="path" title={selected.path}>{selected.path}</span>}
              </div>
              <div className="btn-row">
                {desktop && selected.path ? (
                  <>
                    <button type="button" className="btn sm" disabled={selected.missing} onClick={() => void desktop!.reveal(selected.path!)}>
                      <FolderOpen size={13} /> Show in {desktopInfo?.platform === 'darwin' ? 'Finder' : win ? 'Explorer' : 'folder'}
                    </button>
                    <button type="button" className="btn sm" disabled={selected.missing} onClick={() => void desktop!.openVideo(selected.path!)}>
                      <ExternalLink size={13} /> Open
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(selected.path!)
                        setCopied(selected.id)
                        setTimeout(() => setCopied(''), 1500)
                      }}
                    >
                      <Copy size={13} /> {copied === selected.id ? 'Copied' : 'Copy path'}
                    </button>
                  </>
                ) : (
                  <a className="btn sm" href={selected.url} download={`${selected.name}.${selected.ext}`}>
                    <Download size={13} /> Download again
                  </a>
                )}
                <button type="button" className="btn sm" onClick={() => removeRender(selected.id)}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </section>

            <section className="renders-list" aria-label="All renders">
              {items.map((r) => (
                <RenderRow key={r.id} r={r} now={now} on={r.id === selected.id} />
              ))}
              {!desktop && <p className="hint">The web version keeps your last {items.length >= 8 ? 8 : 'few'} renders until you close this tab. Each one was also downloaded when you exported it.</p>}
            </section>
          </>
        )}
      </aside>
    </>
  )
}

function RenderRow({ r, now, on }: { r: RenderItem; now: number; on: boolean }) {
  return (
    <button type="button" className={`render-row ${on ? 'on' : ''} ${r.missing ? 'missing' : ''}`} onClick={() => selectRender(r.id)} aria-current={on}>
      <span className="render-thumb" style={{ aspectRatio: `${r.width} / ${r.height}` }}>
        {r.thumb ? <img src={r.thumb} alt="" /> : <MonitorPlay size={18} />}
        <em>{fmtShort(r.duration)}</em>
      </span>
      <span className="render-meta">
        <strong>{r.title}</strong>
        <span>
          {r.missing ? 'File missing' : `${fmtBytes(r.size)} · ${r.width}×${r.height}`} · {ago(r.createdAt, now)}
        </span>
      </span>
    </button>
  )
}
