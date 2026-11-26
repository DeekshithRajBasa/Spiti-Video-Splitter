import { Crop, Maximize2, Pause, Play, SkipBack, SkipForward, Upload } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { importFiles } from '../lib/actions'
import { CANVAS_RATIOS } from '../defaults'
import { engine } from '../lib/engine'
import { fmtTime, totalDuration } from '../lib/timeline'
import { store, useProject, useUi } from '../store'
import { useTransport } from './hooks'
import { IconButton } from './ui'

export function Preview() {
  const p = useProject()
  const ui = useUi()
  const t = useTransport()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 300, h: 500 })
  const [a, b] = CANVAS_RATIOS[p.canvas]
  const fileRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const scale = Math.min(r.width / a, r.height / b)
      setBox({ w: Math.max(40, Math.floor(a * scale)), h: Math.max(40, Math.floor(b * scale)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [a, b])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let w = Math.round(box.w * dpr)
    let h = Math.round(box.h * dpr)
    const cap = 1600 / Math.max(w, h)
    if (cap < 1) {
      w = Math.round(w * cap)
      h = Math.round(h * cap)
    }
    c.width = w
    c.height = h
    engine.setPreview(c)
    engine.invalidate()
    return () => engine.setPreview(null)
  }, [box])

  useEffect(() => {
    // Fonts arrive after first paint; redraw when they do.
    document.fonts?.ready.then(() => engine.invalidate())
  }, [])

  const dur = totalDuration(p.segments)
  const empty = !p.slots[0].sourceId

  return (
    <div className="preview card">
      <div className="stage" ref={wrap}>
        <canvas
          ref={canvas}
          style={{ width: box.w, height: box.h }}
          className="stage-canvas"
          onClick={() => !empty && engine.toggle()}
        />
        {empty && (
          <div className="empty-stage" style={{ width: box.w, height: box.h }}>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="video/*,.mkv,.mov"
              onChange={(e) => e.target.files && void importFiles(e.target.files)}
            />
            <button type="button" className="drop-cta" onClick={() => fileRef.current?.click()}>
              <Upload size={22} />
              <strong>Drop a widescreen video</strong>
              <span>MP4, MOV, WebM, MKV. Nothing is uploaded.</span>
            </button>
          </div>
        )}
      </div>
      <div className="transport">
        <div className="timecode">
          <span>{fmtTime(t.outTime, true, p.export.fps)}</span>
          <i>/</i>
          <b>{fmtTime(dur, true, p.export.fps)}</b>
        </div>
        <div className="transport-mid">
          <IconButton title="Previous frame (←)" onClick={() => engine.step(-1)}>
            <SkipBack size={15} />
          </IconButton>
          <button type="button" className="play" aria-label={t.playing ? 'Pause' : 'Play'} onClick={() => engine.toggle()} disabled={empty}>
            {t.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <IconButton title="Next frame (→)" onClick={() => engine.step(1)}>
            <SkipForward size={15} />
          </IconButton>
        </div>
        <div className="transport-right">
          <IconButton title="Frame speakers" active={ui.rightTab === 'frame'} onClick={() => store.ui({ rightTab: 'frame' })}>
            <Crop size={15} />
          </IconButton>
          <IconButton title="Full screen preview" onClick={() => canvas.current?.requestFullscreen?.()}>
            <Maximize2 size={15} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}
