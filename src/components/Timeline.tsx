import {
  Bookmark,
  Captions,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  MousePointer2,
  Music2,
  Redo2,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  Maximize,
  Type,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  addCueAtPlayhead,
  deleteSelection,
  rippleDeleteInOut,
  setInPoint,
  setOutPoint,
  splitAtPlayhead,
  trimToInOut,
  useMedia as applyMedia,
} from '../lib/actions'
import { engine } from '../lib/engine'
import { fmtShort, segmentOutStart, sourceRangeToOut, totalDuration } from '../lib/timeline'
import { store, useMedia, useProject, useUi } from '../store'
import type { TrackFlags } from '../types'
import { useTransport } from './hooks'
import { TEMPLATES } from './TemplatesPanel'
import { IconButton } from './ui'

const GUTTER = 132
const LEAD = 16
type DragState =
  | { type: 'scrub' }
  | { type: 'cue-move'; id: string; x0: number; start: number; end: number }
  | { type: 'cue-end'; id: string; x0: number; end: number; start: number }
  | { type: 'seg-start'; id: string; x0: number; start: number; end: number }
  | { type: 'seg-end'; id: string; x0: number; end: number; start: number; max: number }
  | { type: 'sfx'; id: string; x0: number; at: number }
  | { type: 'music'; x0: number; offset: number }

function pickStep(zoom: number) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
  return steps.find((s) => s * zoom >= 90) ?? 3600
}

export function Timeline() {
  const p = useProject()
  const ui = useUi()
  const media = useMedia()
  const t = useTransport()
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 800 })
  const drag = useRef<DragState | null>(null)
  const dur = totalDuration(p.segments)
  const zoom = ui.zoom
  const contentW = Math.max(view.width, dur * zoom + LEAD * 2 + 120)
  const xOf = (time: number) => LEAD + time * zoom
  const masterId = p.slots[0].sourceId
  const master = masterId ? media[masterId] : null

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setView({ left: el.scrollLeft, width: el.clientWidth }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const el = scroller.current
    const d = totalDuration(store.get().project.segments)
    if (!el || d <= 0) return
    store.ui({ zoom: Math.max(0.02, (el.clientWidth - LEAD * 2 - 40) / d) })
  }, [])

  // Fit when a new main video arrives.
  useEffect(() => {
    if (masterId) setTimeout(fit, 30)
  }, [masterId, fit])

  // Follow the playhead while playing.
  useEffect(() => {
    const el = scroller.current
    if (!el || !t.playing) return
    const x = xOf(t.outTime)
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = x - 80
  })

  const timeAt = (clientX: number) => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, (clientX - r.left + el.scrollLeft - LEAD) / zoom)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.type === 'scrub') {
      engine.seek(timeAt(e.clientX))
      return
    }
    const dt = (e.clientX - d.x0) / zoom
    if (d.type === 'cue-move') {
      store.update((x) => {
        const c = x.cues.find((k) => k.id === d.id)
        if (!c) return
        const nd = Math.max(-d.start, dt)
        c.start = d.start + nd
        c.end = d.end + nd
      }, `drag-${d.id}`)
    } else if (d.type === 'cue-end') {
      store.update((x) => {
        const c = x.cues.find((k) => k.id === d.id)
        if (c) c.end = Math.max(c.start + 0.15, d.end + dt)
      }, `drag-${d.id}`)
    } else if (d.type === 'seg-start') {
      store.update((x) => {
        const s = x.segments.find((k) => k.id === d.id)
        if (s) s.start = Math.min(d.end - 0.1, Math.max(0, d.start + dt))
      }, `drag-${d.id}`)
    } else if (d.type === 'seg-end') {
      store.update((x) => {
        const s = x.segments.find((k) => k.id === d.id)
        if (s) s.end = Math.max(d.start + 0.1, Math.min(d.max, d.end + dt))
      }, `drag-${d.id}`)
    } else if (d.type === 'sfx') {
      store.update((x) => {
        const s = x.sfx.find((k) => k.id === d.id)
        if (s) s.at = Math.max(0, d.at + dt)
      }, `drag-${d.id}`)
    } else if (d.type === 'music') {
      store.update((x) => {
        x.music.offset = Math.max(0, d.offset - dt)
      }, 'drag-music')
    }
  }

  const start = (e: React.PointerEvent, s: DragState) => {
    e.stopPropagation()
    drag.current = s
    scroller.current?.setPointerCapture(e.pointerId)
  }

  const flag = <K extends keyof TrackFlags>(k: K, f: keyof TrackFlags[K]) =>
    store.update((d) => {
      const tr = d.tracks[k] as Record<string, boolean>
      tr[f as string] = !tr[f as string]
    })

  const step = pickStep(zoom)
  const minor = step / 5
  const visStart = Math.max(0, (view.left - LEAD) / zoom - step)
  const visEnd = (view.left + view.width) / zoom + step
  const ticks: number[] = []
  for (let s = Math.floor(visStart / minor) * minor; s <= Math.min(visEnd, dur + step); s += minor) ticks.push(Number(s.toFixed(3)))

  const sel = ui.selection
  const tplName = TEMPLATES.find((x) => x.id === p.template.id)?.label
  const music = p.music.mediaId ? media[p.music.mediaId] : null
  const musicLen = music ? Math.max(0, Math.min(dur, music.duration - p.music.offset)) : 0

  return (
    <div className="timeline card">
      <div className="tl-toolbar">
        <div className="tl-group">
          <IconButton title="Select" active>
            <MousePointer2 size={15} />
          </IconButton>
        </div>
        <div className="tl-group">
          <IconButton title="Undo (Ctrl+Z)" onClick={() => store.undo()} disabled={!store.canUndo()}>
            <Undo2 size={15} />
          </IconButton>
          <IconButton title="Redo (Ctrl+Shift+Z)" onClick={() => store.redo()} disabled={!store.canRedo()}>
            <Redo2 size={15} />
          </IconButton>
          <IconButton title="Split at playhead (S)" onClick={splitAtPlayhead} disabled={!master}>
            <SquareSplitHorizontal size={15} />
          </IconButton>
          <IconButton title="Delete selected (Del)" onClick={deleteSelection} disabled={!sel}>
            <Trash2 size={15} />
          </IconButton>
          <IconButton title="Add caption at playhead (T)" onClick={() => addCueAtPlayhead()} disabled={!master}>
            <Type size={15} />
          </IconButton>
        </div>
        <div className="tl-group inout">
          <button type="button" className={`chip ${ui.inPoint != null ? 'on' : ''}`} onClick={setInPoint} title="Set In point (I)">
            I {ui.inPoint != null && fmtShort(ui.inPoint)}
          </button>
          <button type="button" className={`chip ${ui.outPoint != null ? 'on' : ''}`} onClick={setOutPoint} title="Set Out point (O)">
            O {ui.outPoint != null && fmtShort(ui.outPoint)}
          </button>
          <IconButton title="Keep only In → Out" onClick={trimToInOut} disabled={ui.inPoint == null && ui.outPoint == null}>
            <Bookmark size={15} />
          </IconButton>
          <IconButton title="Cut out In → Out (ripple)" onClick={rippleDeleteInOut} disabled={ui.inPoint == null || ui.outPoint == null}>
            <Scissors size={15} />
          </IconButton>
        </div>
        <div className="tl-spacer" />
        <div className="tl-group">
          <IconButton title="Zoom out (-)" onClick={() => store.ui({ zoom: Math.max(0.02, zoom / 1.4) })}>
            <ZoomOut size={15} />
          </IconButton>
          <input
            className="zoom"
            type="range"
            min={-4}
            max={6}
            step={0.01}
            aria-label="Timeline zoom"
            value={Math.log2(zoom)}
            style={{ ['--p' as string]: `${((Math.log2(zoom) + 4) / 10) * 100}%` }}
            onChange={(e) => store.ui({ zoom: Math.pow(2, Number(e.target.value)) })}
          />
          <IconButton title="Zoom in (+)" onClick={() => store.ui({ zoom: Math.min(64, zoom * 1.4) })}>
            <ZoomIn size={15} />
          </IconButton>
          <IconButton title="Fit to window" onClick={fit}>
            <Maximize size={15} />
          </IconButton>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-gutter" style={{ width: GUTTER }}>
          <div className="tl-ruler-spacer" />
          <TrackHead
            h="overlay"
            locked={p.tracks.overlay.locked}
            hidden={p.tracks.overlay.hidden}
            onLock={() => flag('overlay', 'locked')}
            onEye={() => flag('overlay', 'hidden')}
          />
          <TrackHead h="captions" locked={p.tracks.captions.locked} hidden={p.tracks.captions.hidden} onLock={() => flag('captions', 'locked')} onEye={() => flag('captions', 'hidden')} />
          <TrackHead h="video" locked={p.tracks.video.locked} muted={p.tracks.video.muted} onLock={() => flag('video', 'locked')} onMute={() => flag('video', 'muted')} />
          <TrackHead h="sfx" locked={p.tracks.sfx.locked} muted={p.tracks.sfx.muted} onLock={() => flag('sfx', 'locked')} onMute={() => flag('sfx', 'muted')} />
          <TrackHead h="music" locked={p.tracks.music.locked} muted={p.tracks.music.muted} onLock={() => flag('music', 'locked')} onMute={() => flag('music', 'muted')} />
        </div>

        <div
          className="tl-scroll"
          ref={scroller}
          onScroll={(e) => setView({ left: e.currentTarget.scrollLeft, width: e.currentTarget.clientWidth })}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              store.ui({ zoom: Math.min(64, Math.max(0.02, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) })
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('application/x-svs-media')
            const m = id ? store.get().media[id] : null
            if (m) {
              e.preventDefault()
              e.stopPropagation()
              engine.seek(timeAt(e.clientX))
              void applyMedia(m)
            }
          }}
        >
          <div className="tl-content" style={{ width: contentW }}>
            <div
              className="tl-ruler"
              onPointerDown={(e) => {
                drag.current = { type: 'scrub' }
                scroller.current?.setPointerCapture(e.pointerId)
                engine.seek(timeAt(e.clientX))
              }}
            >
              {ticks.map((s) => {
                const major = Math.abs(s / step - Math.round(s / step)) < 1e-6
                return (
                  <span key={s} className={major ? 'major' : 'minor'} style={{ left: xOf(s) }}>
                    {major && <em>{fmtShort(s)}</em>}
                  </span>
                )
              })}
              {(ui.inPoint != null || ui.outPoint != null) && (
                <div
                  className="inout-range"
                  style={{ left: xOf(ui.inPoint ?? 0), width: Math.max(2, ((ui.outPoint ?? dur) - (ui.inPoint ?? 0)) * zoom) }}
                />
              )}
            </div>

            {/* overlay track */}
            <div className="lane lane-overlay" onPointerDown={() => store.ui({ selection: null })}>
              {p.template.id !== 'none' && dur > 0 && (
                <div
                  className={`clip clip-overlay ${sel?.kind === 'overlay' ? 'selected' : ''}`}
                  style={{ left: xOf(0), width: dur * zoom }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    store.ui({ selection: { kind: 'overlay' }, leftTab: 'templates' })
                  }}
                >
                  <SquareSplitHorizontal size={13} /> <span>{tplName}</span>
                </div>
              )}
              {p.outro.enabled && dur > 0 && (
                <div className="clip clip-outro" style={{ left: xOf(Math.max(0, dur - p.outro.duration)), width: Math.min(dur, p.outro.duration) * zoom }}>
                  <span>Outro</span>
                </div>
              )}
            </div>

            {/* captions */}
            <div className="lane lane-captions">
              {p.cues.flatMap((c) =>
                sourceRangeToOut(p.segments, c.start, c.end).map(([a, b], i) => {
                  const x = xOf(a)
                  if (x > view.left + view.width + 50 || x + (b - a) * zoom < view.left - 50) return null
                  return (
                    <div
                      key={`${c.id}-${i}`}
                      className={`clip clip-caption ${sel?.kind === 'cue' && sel.id === c.id ? 'selected' : ''}`}
                      style={{ left: x, width: Math.max(4, (b - a) * zoom - 2) }}
                      title={c.text}
                      onPointerDown={(e) => {
                        if (p.tracks.captions.locked) return
                        store.ui({ selection: { kind: 'cue', id: c.id }, leftTab: 'captions' })
                        start(e, { type: 'cue-move', id: c.id, x0: e.clientX, start: c.start, end: c.end })
                      }}
                      onDoubleClick={() => engine.seek(a + 0.01)}
                    >
                      <Captions size={12} />
                      <span>{c.text.replace(/[*_[\]]/g, '')}</span>
                      <i
                        className="handle right"
                        onPointerDown={(e) => !p.tracks.captions.locked && start(e, { type: 'cue-end', id: c.id, x0: e.clientX, end: c.end, start: c.start })}
                      />
                    </div>
                  )
                }),
              )}
            </div>

            {/* video */}
            <div className="lane lane-video">
              {master &&
                p.segments.map((s, i) => {
                  const a = segmentOutStart(p.segments, i)
                  const len = s.end - s.start
                  const x = xOf(a)
                  const w = len * zoom
                  const tileW = 84
                  const tiles: { left: number; src: string }[] = []
                  if (master.thumbs.length) {
                    const first = Math.max(0, Math.floor((view.left - x) / tileW))
                    const last = Math.min(Math.ceil(w / tileW), Math.ceil((view.left + view.width - x) / tileW) + 1)
                    for (let k = first; k < last; k++) {
                      const st = s.start + ((k + 0.5) * tileW) / zoom
                      const idx = Math.min(master.thumbs.length - 1, Math.floor((st / master.duration) * master.thumbs.length))
                      tiles.push({ left: k * tileW, src: master.thumbs[Math.max(0, idx)] })
                    }
                  }
                  return (
                    <div
                      key={s.id}
                      className={`clip clip-video ${sel?.kind === 'segment' && sel.id === s.id ? 'selected' : ''}`}
                      style={{ left: x, width: Math.max(6, w - 2) }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        store.ui({ selection: { kind: 'segment', id: s.id } })
                      }}
                    >
                      <div className="tiles">
                        {tiles.map((tl) => (
                          <img key={tl.left} src={tl.src} alt="" style={{ left: tl.left, width: tileW }} draggable={false} />
                        ))}
                      </div>
                      <span className="seg-label">{fmtShort(len)}</span>
                      {!p.tracks.video.locked && (
                        <>
                          <i className="handle left" onPointerDown={(e) => start(e, { type: 'seg-start', id: s.id, x0: e.clientX, start: s.start, end: s.end })} />
                          <i
                            className="handle right"
                            onPointerDown={(e) => start(e, { type: 'seg-end', id: s.id, x0: e.clientX, end: s.end, start: s.start, max: master.duration })}
                          />
                        </>
                      )}
                    </div>
                  )
                })}
            </div>

            {/* sfx */}
            <div className="lane lane-sfx">
              {p.sfx.map((s) => {
                const m = media[s.mediaId]
                const len = Math.max(0.3, m?.duration ?? 1)
                return (
                  <div
                    key={s.id}
                    className={`clip clip-sfx ${sel?.kind === 'sfx' && sel.id === s.id ? 'selected' : ''}`}
                    style={{ left: xOf(s.at), width: Math.max(18, len * zoom) }}
                    title={m?.name}
                    onPointerDown={(e) => {
                      store.ui({ selection: { kind: 'sfx', id: s.id }, rightTab: 'audio' })
                      if (!p.tracks.sfx.locked) start(e, { type: 'sfx', id: s.id, x0: e.clientX, at: s.at })
                    }}
                  >
                    <Volume2 size={12} />
                    <span>{m?.name ?? 'sfx'}</span>
                  </div>
                )
              })}
            </div>

            {/* music */}
            <div className="lane lane-music">
              {music && dur > 0 && (
                <div
                  className={`clip clip-music ${sel?.kind === 'music' ? 'selected' : ''}`}
                  style={{ left: xOf(0), width: Math.max(20, musicLen * zoom) }}
                  onPointerDown={(e) => {
                    store.ui({ selection: { kind: 'music' }, rightTab: 'audio' })
                    if (!p.tracks.music.locked) start(e, { type: 'music', x0: e.clientX, offset: p.music.offset })
                  }}
                  title="Drag to slide the song"
                >
                  <Music2 size={13} />
                  <span>{music.name}</span>
                  <Waveform data={music.waveform} from={p.music.offset / music.duration} to={(p.music.offset + musicLen) / music.duration} />
                </div>
              )}
            </div>

            <div className="playhead" style={{ left: xOf(t.outTime) }}>
              <i />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const LABELS = {
  overlay: 'Overlay',
  captions: 'Captions',
  video: 'Video',
  sfx: 'Sound FX',
  music: 'Music',
}

function TrackHead(props: {
  h: keyof typeof LABELS
  locked: boolean
  hidden?: boolean
  muted?: boolean
  onLock: () => void
  onEye?: () => void
  onMute?: () => void
}) {
  return (
    <div className={`track-head th-${props.h}`}>
      <IconButton title={props.locked ? 'Unlock track' : 'Lock track'} onClick={props.onLock} active={props.locked}>
        {props.locked ? <Lock size={13} /> : <LockOpen size={13} />}
      </IconButton>
      {props.onEye ? (
        <IconButton title={props.hidden ? 'Show track' : 'Hide track'} onClick={props.onEye} active={props.hidden}>
          {props.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </IconButton>
      ) : (
        <IconButton title={props.muted ? 'Unmute track' : 'Mute track'} onClick={props.onMute} active={props.muted}>
          {props.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </IconButton>
      )}
      <span>{LABELS[props.h]}</span>
    </div>
  )
}

function Waveform({ data, from, to }: { data: number[]; from: number; to: number }) {
  if (!data.length) return null
  const a = Math.floor(from * data.length)
  const b = Math.max(a + 1, Math.ceil(to * data.length))
  const slice = data.slice(a, b)
  const n = slice.length
  return (
    <svg className="wave" viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" aria-hidden>
      {slice.map((v, i) => (
        <rect key={i} x={i + 0.15} width={0.7} y={10 - Math.max(0.6, v * 9)} height={Math.max(1.2, v * 18)} />
      ))}
    </svg>
  )
}
