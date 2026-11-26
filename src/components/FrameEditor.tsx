import { Crosshair, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { canvasSize, engine } from '../lib/engine'
import { cropRect, FRAME_TEMPLATES, layoutRegions } from '../lib/render'
import { store, useMedia, useProject } from '../store'
import type { Project } from '../types'
import { Section, Slider } from './ui'

const COLORS = ['#a855f7', '#06b6d4', '#f59e0b']

function slotAspects(p: Project, srcAspect: number): number[] {
  if (FRAME_TEMPLATES.includes(p.template.id) && !p.tracks.overlay.hidden) return [16 / 9]
  const [W, H] = canvasSize(p, 1080)
  return layoutRegions(p, W, H, srcAspect).map((r) => r.rect.w / r.rect.h)
}

export function FrameEditor() {
  const p = useProject()
  const media = useMedia()
  const [active, setActive] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ slot: number; sx: number; sy: number; cx: number; cy: number } | null>(null)

  const master = p.slots[0].sourceId ? media[p.slots[0].sourceId] : null
  const masterAspect = master && master.height ? master.width / master.height : 16 / 9
  const aspects = slotAspects(p, masterAspect)
  const count = aspects.length
  const slot = Math.min(active, count - 1)
  const srcId = p.slots[slot].sourceId ?? p.slots[0].sourceId
  const src = srcId ? media[srcId] : null
  const sw = src?.width || 1920
  const sh = src?.height || 1080
  // Slots that share this source are drawn together so you can frame host & guest side by side.
  const shown = aspects
    .map((a, i) => ({ a, i }))
    .filter(({ i }) => (p.slots[i].sourceId ?? p.slots[0].sourceId) === srcId)

  useEffect(() => {
    let raf = 0
    const draw = () => {
      const c = canvas.current
      if (c) {
        const ctx = c.getContext('2d')!
        const W = c.width
        const H = c.height
        ctx.fillStyle = '#111'
        ctx.fillRect(0, 0, W, H)
        const el = engine.getSource(srcId)
        try {
          if (el) ctx.drawImage(el, 0, 0, W, H)
        } catch {
          /* not ready */
        }
        const p2 = store.get().project
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fillRect(0, 0, W, H)
        for (const { a, i } of shown) {
          const r = cropRect(sw, sh, a, p2.slots[i].crop)
          const x = (r.x / sw) * W
          const y = (r.y / sh) * H
          const w = (r.w / sw) * W
          const h = (r.h / sh) * H
          ctx.save()
          ctx.beginPath()
          ctx.rect(x, y, w, h)
          ctx.clip()
          try {
            if (el) ctx.drawImage(el, 0, 0, W, H)
          } catch {
            /* ignore */
          }
          ctx.restore()
          ctx.strokeStyle = COLORS[i]
          ctx.lineWidth = i === slot ? 2.5 : 1.5
          ctx.setLineDash(i === slot ? [] : [5, 4])
          ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
          ctx.setLineDash([])
          ctx.fillStyle = COLORS[i]
          ctx.fillRect(x, y, 18, 16)
          ctx.fillStyle = '#fff'
          ctx.font = '600 11px Inter, sans-serif'
          ctx.fillText(String(i + 1), x + 5, y + 12)
          // thirds guide
          if (i === slot) {
            ctx.strokeStyle = 'rgba(255,255,255,0.25)'
            ctx.lineWidth = 1
            for (let k = 1; k < 3; k++) {
              ctx.beginPath()
              ctx.moveTo(x + (w * k) / 3, y)
              ctx.lineTo(x + (w * k) / 3, y + h)
              ctx.moveTo(x, y + (h * k) / 3)
              ctx.lineTo(x + w, y + (h * k) / 3)
              ctx.stroke()
            }
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  })

  const hit = (e: React.PointerEvent) => {
    const c = canvas.current!
    const b = c.getBoundingClientRect()
    const nx = (e.clientX - b.left) / b.width
    const ny = (e.clientY - b.top) / b.height
    // prefer the active slot, then any box under the pointer
    const order = [...shown].sort((a, b2) => (a.i === slot ? -1 : b2.i === slot ? 1 : 0))
    for (const { a, i } of order) {
      const r = cropRect(sw, sh, a, p.slots[i].crop)
      if (nx * sw >= r.x && nx * sw <= r.x + r.w && ny * sh >= r.y && ny * sh <= r.y + r.h) return { i, nx, ny }
    }
    return { i: slot, nx, ny }
  }

  const setCrop = (i: number, patch: Partial<Project['slots'][0]['crop']>, key: string) =>
    store.update((d) => {
      Object.assign(d.slots[i].crop, patch)
    }, key)

  const clampCenter = (i: number, cx: number, cy: number) => {
    const r = cropRect(sw, sh, aspects[i], { ...p.slots[i].crop, cx, cy })
    return { cx: (r.x + r.w / 2) / sw, cy: (r.y + r.h / 2) / sh }
  }

  const crop = p.slots[slot].crop

  return (
    <Section
      title="Framing"
      right={
        count > 1 ? (
          <div className="slot-tabs">
            {aspects.map((_, i) => (
              <button
                type="button"
                key={i}
                className={i === slot ? 'on' : ''}
                style={{ ['--c' as string]: COLORS[i] }}
                onClick={() => setActive(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      {!src ? (
        <p className="muted">Add a video to frame your speakers.</p>
      ) : (
        <>
          <canvas
            ref={canvas}
            className="frame-canvas"
            width={320}
            height={Math.round((320 * sh) / sw)}
            onPointerDown={(e) => {
              const h = hit(e)
              setActive(h.i)
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              drag.current = { slot: h.i, sx: h.nx, sy: h.ny, cx: p.slots[h.i].crop.cx, cy: p.slots[h.i].crop.cy }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d) return
              const b = canvas.current!.getBoundingClientRect()
              const nx = (e.clientX - b.left) / b.width
              const ny = (e.clientY - b.top) / b.height
              setCrop(d.slot, clampCenter(d.slot, d.cx + nx - d.sx, d.cy + ny - d.sy), `crop-${d.slot}`)
            }}
            onPointerUp={() => (drag.current = null)}
            onWheel={(e) => {
              const z = Math.min(4, Math.max(1, crop.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)))
              setCrop(slot, { zoom: z }, `zoom-${slot}`)
            }}
          />
          <p className="hint">Drag a box over a speaker. Scroll to zoom.</p>
          <Slider
            label={`Slot ${slot + 1} zoom`}
            value={crop.zoom}
            min={1}
            max={4}
            onChange={(v) => setCrop(slot, { zoom: v }, `zoom-${slot}`)}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <div className="btn-row">
            <button type="button" className="btn sm" onClick={() => setCrop(slot, { cx: 0.5, cy: 0.5 }, '')}>
              <Crosshair size={13} /> Center
            </button>
            <button type="button" className="btn sm" onClick={() => setCrop(slot, { cx: 0.5, cy: 0.5, zoom: 1 }, '')}>
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </>
      )}
    </Section>
  )
}
