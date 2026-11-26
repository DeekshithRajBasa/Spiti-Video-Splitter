import type { Crop, MediaItem, Project, TemplateId } from '../types'
import { cueWords, wrapWords, type Word } from './captions'

export type Drawable = HTMLVideoElement | HTMLImageElement | ImageBitmap

export interface RenderInput {
  project: Project
  media: Record<string, MediaItem>
  getSource: (id: string | null) => Drawable | null
  outTime: number
  srcTime: number
  duration: number
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const FRAME_TEMPLATES: TemplateId[] = ['x-light', 'x-dark', 'code', 'quote']

/* ---------------- helpers ---------------- */

function srcSize(s: Drawable): [number, number] {
  if (s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight]
  if (s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight]
  return [s.width, s.height]
}

function ready(s: Drawable | null): s is Drawable {
  if (!s) return false
  if (s instanceof HTMLVideoElement) return s.readyState >= 2 && s.videoWidth > 0
  if (s instanceof HTMLImageElement) return s.complete && s.naturalWidth > 0
  return s.width > 0
}

/** Source-space rect for a crop at the given output aspect. */
export function cropRect(sw: number, sh: number, aspect: number, crop: Crop) {
  let w: number
  let h: number
  if (sw / sh > aspect) {
    h = sh
    w = sh * aspect
  } else {
    w = sw
    h = sw / aspect
  }
  w /= crop.zoom
  h /= crop.zoom
  const x = Math.min(Math.max(0, crop.cx * sw - w / 2), sw - w)
  const y = Math.min(Math.max(0, crop.cy * sh - h / 2), sh - h)
  return { x, y, w, h }
}

export function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawCover(ctx: CanvasRenderingContext2D, s: Drawable, r: Rect, crop: Crop) {
  const [sw, sh] = srcSize(s)
  const c = cropRect(sw, sh, r.w / r.h, crop)
  ctx.drawImage(s, c.x, c.y, c.w, c.h, r.x, r.y, r.w, r.h)
}

const easeOutBack = (p: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    let line = ''
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line)
        line = w
      } else line = test
    }
    out.push(line)
  }
  return out
}

let blurCanvas: HTMLCanvasElement | null = null
const supportsFilter = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d')
    return !!c && 'filter' in c
  } catch {
    return false
  }
})()

function drawBlurred(ctx: CanvasRenderingContext2D, s: Drawable, W: number, H: number, blur: number, dim: number) {
  if (!blurCanvas) blurCanvas = document.createElement('canvas')
  const scale = supportsFilter ? 8 : Math.max(8, blur / 2)
  const bw = Math.max(4, Math.round(W / scale))
  const bh = Math.max(4, Math.round(H / scale))
  if (blurCanvas.width !== bw || blurCanvas.height !== bh) {
    blurCanvas.width = bw
    blurCanvas.height = bh
  }
  const b = blurCanvas.getContext('2d')!
  const rad = (blur / 1080) * W
  if (supportsFilter) b.filter = `blur(${Math.max(0.5, rad / scale)}px)`
  // Draw a little larger so the blur doesn't pull in transparent edges.
  const m = Math.max(2, rad / scale) * 2
  drawCover(b, s, { x: -m, y: -m, w: bw + 2 * m, h: bh + 2 * m }, { cx: 0.5, cy: 0.5, zoom: 1 })
  if (supportsFilter) b.filter = 'none'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(blurCanvas, 0, 0, W, H)
  if (dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${dim})`
    ctx.fillRect(0, 0, W, H)
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const bg = inp.project.background
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  if (bg.mode === 'color') {
    ctx.fillStyle = bg.color
    ctx.fillRect(0, 0, W, H)
  } else if (bg.mode === 'gradient') {
    const a = (bg.gradientAngle * Math.PI) / 180
    const dx = (Math.cos(a) * W) / 2
    const dy = (Math.sin(a) * H) / 2
    const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy)
    g.addColorStop(0, bg.gradientFrom)
    g.addColorStop(1, bg.gradientTo)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  } else {
    const id = bg.mode === 'image' ? bg.imageId : inp.project.slots[0].sourceId
    const s = inp.getSource(id)
    if (ready(s)) drawBlurred(ctx, s, W, H, bg.blur, bg.dim)
    else {
      ctx.fillStyle = bg.color
      ctx.fillRect(0, 0, W, H)
    }
  }
}

/* ---------------- layout ---------------- */

interface Region {
  slot: number
  rect: Rect
  circle?: boolean
  radius: number
}

export function layoutRegions(p: Project, W: number, H: number, sourceAspect: number): Region[] {
  const pad = (p.background.padding / 100) * W
  const c: Rect = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 }
  const r = (p.background.radius / 100) * W
  const gap = (p.background.dividerSize / 1000) * H
  switch (p.layout) {
    case 'centered': {
      const h = Math.min(c.h, c.w / sourceAspect)
      return [{ slot: 0, rect: { x: c.x, y: c.y + (c.h - h) / 2, w: c.w, h }, radius: r }]
    }
    case 'split': {
      let topH = c.h * p.splitRatio
      if (p.splitMode === 'wide-top') topH = Math.min(c.h * 0.7, (c.w * 9) / 16)
      if (p.splitMode === 'wide-bottom') topH = c.h - Math.min(c.h * 0.7, (c.w * 9) / 16)
      return [
        { slot: 0, rect: { x: c.x, y: c.y, w: c.w, h: topH - gap / 2 }, radius: r },
        { slot: 1, rect: { x: c.x, y: c.y + topH + gap / 2, w: c.w, h: c.h - topH - gap / 2 }, radius: r },
      ]
    }
    case 'trio': {
      const topH = c.h * p.splitRatio
      const bw = (c.w - gap) / 2
      const by = c.y + topH + gap / 2
      const bh = c.h - topH - gap / 2
      return [
        { slot: 0, rect: { x: c.x, y: c.y, w: c.w, h: topH - gap / 2 }, radius: r },
        { slot: 1, rect: { x: c.x, y: by, w: bw, h: bh }, radius: r },
        { slot: 2, rect: { x: c.x + bw + gap, y: by, w: bw, h: bh }, radius: r },
      ]
    }
    case 'pip': {
      const w = W * p.pipSize
      const h = p.pipShape === 'circle' ? w : (w * 3) / 4
      const m = W * 0.05
      const x = p.pipCorner.endsWith('l') ? c.x + m : c.x + c.w - m - w
      const y = p.pipCorner.startsWith('t') ? c.y + m + H * 0.06 : c.y + c.h - m - h - H * 0.12
      return [
        { slot: 0, rect: c, radius: r },
        {
          slot: 1,
          rect: { x, y, w, h },
          circle: p.pipShape === 'circle',
          radius: p.pipShape === 'rounded' ? w * 0.1 : 0,
        },
      ]
    }
    default:
      return [{ slot: 0, rect: c, radius: r }]
  }
}

function drawRegion(ctx: CanvasRenderingContext2D, s: Drawable | null, reg: Region, crop: Crop, shadow: number, W: number) {
  const { x, y, w, h } = reg.rect
  ctx.save()
  if (shadow > 0 && (reg.radius > 0 || reg.circle || reg.slot > 0)) {
    ctx.shadowColor = `rgba(0,0,0,${0.6 * shadow})`
    ctx.shadowBlur = W * 0.04 * shadow
    ctx.shadowOffsetY = W * 0.01 * shadow
    ctx.fillStyle = '#000'
    if (reg.circle) {
      ctx.beginPath()
      ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2)
    } else rrPath(ctx, x, y, w, h, reg.radius)
    ctx.fill()
    ctx.shadowColor = 'transparent'
  }
  if (reg.circle) {
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2)
  } else rrPath(ctx, x, y, w, h, reg.radius)
  ctx.clip()
  if (ready(s)) drawCover(ctx, s, reg.rect, crop)
  else {
    ctx.fillStyle = '#1c1c22'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = `600 ${W * 0.03}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(reg.slot === 0 ? 'Add a video' : `Slot ${reg.slot + 1}: pick a source`, x + w / 2, y + h / 2)
  }
  ctx.restore()
  if (reg.circle && reg.slot > 0) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = W * 0.006
    ctx.beginPath()
    ctx.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}

/* ---------------- templates ---------------- */

function drawAvatar(ctx: CanvasRenderingContext2D, inp: RenderInput, x: number, y: number, d: number) {
  const t = inp.project.template
  const img = inp.getSource(t.avatarId)
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2)
  ctx.clip()
  if (ready(img)) drawCover(ctx, img, { x, y, w: d, h: d }, { cx: 0.5, cy: 0.5, zoom: 1 })
  else {
    const g = ctx.createLinearGradient(x, y, x + d, y + d)
    g.addColorStop(0, t.accent)
    g.addColorStop(1, '#7c3aed')
    ctx.fillStyle = g
    ctx.fillRect(x, y, d, d)
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${d * 0.45}px Inter, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((t.name.trim()[0] ?? '?').toUpperCase(), x + d / 2, y + d / 2 + d * 0.03)
  }
  ctx.restore()
}

function drawVerified(ctx: CanvasRenderingContext2D, x: number, y: number, d: number) {
  ctx.save()
  ctx.fillStyle = '#1d9bf0'
  ctx.beginPath()
  const n = 8
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 ? d * 0.42 : d * 0.5
    ctx.lineTo(x + d / 2 + Math.cos(a) * rr, y + d / 2 + Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = d * 0.12
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x + d * 0.3, y + d * 0.52)
  ctx.lineTo(x + d * 0.45, y + d * 0.66)
  ctx.lineTo(x + d * 0.72, y + d * 0.36)
  ctx.stroke()
  ctx.restore()
}

/** Frame templates wrap a 16:9 clip in a card. */
function drawFrameTemplate(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const p = inp.project
  const t = p.template
  const dark = t.id === 'x-dark' || t.id === 'code'
  const cw = W * 0.9
  const pad = W * 0.045
  const innerW = cw - pad * 2
  const clipH = (innerW * 9) / 16
  const fs = W * 0.042
  ctx.font = `500 ${fs}px Inter, sans-serif`
  const mono = t.id === 'code'
  if (mono) ctx.font = `500 ${fs * 0.9}px "Roboto Mono", monospace`
  if (t.id === 'quote') ctx.font = `italic 600 ${fs * 1.15}px "Playfair Display", serif`
  const lines = wrapText(ctx, t.text, innerW)
  const lh = fs * 1.38 * (t.id === 'quote' ? 1.15 : 1)
  const headerH = t.id === 'code' ? W * 0.07 : t.id === 'quote' ? W * 0.1 : W * 0.13
  const cardH = pad + headerH + lines.length * lh + pad * 0.8 + clipH + pad
  const x = (W - cw) / 2
  const y = (H - cardH) / 2

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = W * 0.05
  ctx.shadowOffsetY = W * 0.012
  ctx.fillStyle = t.id === 'code' ? '#0f1117' : dark ? '#000000' : '#ffffff'
  rrPath(ctx, x, y, cw, cardH, W * 0.04)
  ctx.fill()
  ctx.restore()

  let cy = y + pad
  const txtColor = dark ? '#e7e9ea' : '#0f1419'
  if (t.id === 'code') {
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.arc(x + pad + i * W * 0.035 + W * 0.01, cy + W * 0.012, W * 0.011, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.fillStyle = '#6b7280'
    ctx.font = `500 ${fs * 0.7}px "Roboto Mono", monospace`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(t.handle.replace('@', '') + '.ts', x + cw - pad, cy + W * 0.012)
    cy += headerH
  } else if (t.id === 'quote') {
    ctx.fillStyle = t.accent
    ctx.font = `900 ${W * 0.16}px "Playfair Display", serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('“', x + pad - W * 0.01, cy - W * 0.03)
    cy += headerH
  } else {
    const d = W * 0.1
    drawAvatar(ctx, inp, x + pad, cy, d)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = txtColor
    ctx.font = `700 ${fs}px Inter, sans-serif`
    ctx.fillText(t.name, x + pad + d + W * 0.025, cy + d * 0.45)
    const nw = ctx.measureText(t.name).width
    if (t.verified) drawVerified(ctx, x + pad + d + W * 0.035 + nw, cy + d * 0.45 - fs * 0.85, fs)
    ctx.fillStyle = dark ? '#71767b' : '#536471'
    ctx.font = `400 ${fs * 0.88}px Inter, sans-serif`
    ctx.fillText(t.handle, x + pad + d + W * 0.025, cy + d * 0.92)
    cy += headerH
  }

  // Code template types its text out.
  let typed = lines
  if (mono) {
    const total = lines.join('\n').length
    const n = Math.floor(clamp01(inp.outTime / 2.5) * total)
    let left = n
    typed = lines.map((l) => {
      const s = l.slice(0, Math.max(0, left))
      left -= l.length + 1
      return s
    })
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  typed.forEach((l, i) => {
    ctx.fillStyle = mono ? (i % 2 ? '#7dd3fc' : '#c4b5fd') : txtColor
    if (mono) ctx.font = `500 ${fs * 0.9}px "Roboto Mono", monospace`
    else if (t.id === 'quote') ctx.font = `italic 600 ${fs * 1.15}px "Playfair Display", serif`
    else ctx.font = `500 ${fs}px Inter, sans-serif`
    ctx.fillText(l, x + pad, cy + i * lh)
  })
  if (mono && Math.floor(inp.outTime * 2) % 2 === 0) {
    const li = Math.max(0, typed.findIndex((l, i) => l.length < lines[i].length))
    const ll = typed[li] ?? ''
    ctx.fillStyle = '#e5e7eb'
    ctx.fillRect(x + pad + ctx.measureText(ll).width + 2, cy + li * lh, fs * 0.5, fs)
  }
  cy += lines.length * lh + pad * 0.8

  const reg: Region = { slot: 0, rect: { x: x + pad, y: cy, w: innerW, h: clipH }, radius: W * 0.025 }
  drawRegion(ctx, inp.getSource(p.slots[0].sourceId), reg, p.slots[0].crop, 0, W)
}

function drawStickerTemplate(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const t = inp.project.template
  const fs = W * 0.05
  ctx.save()
  switch (t.id) {
    case 'tiktok-hook': {
      ctx.font = `800 ${fs}px Montserrat, sans-serif`
      const lines = wrapText(ctx, t.text, W * 0.76)
      const lh = fs * 1.32
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + W * 0.08
      const bh = lines.length * lh + W * 0.05
      const x = (W - bw) / 2
      const y = H * 0.12
      const pop = easeOutBack(clamp01(inp.outTime / 0.35))
      ctx.translate(W / 2, y + bh / 2)
      ctx.scale(pop, pop)
      ctx.translate(-W / 2, -(y + bh / 2))
      ctx.fillStyle = '#ffffff'
      rrPath(ctx, x, y, bw, bh, W * 0.025)
      ctx.fill()
      ctx.fillStyle = '#111'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y + W * 0.025 + i * lh + fs * 0.08))
      break
    }
    case 'breaking-news': {
      const barH = H * 0.07
      const y = H * 0.76
      const lab = 'BREAKING'
      ctx.font = `900 ${barH * 0.42}px Montserrat, sans-serif`
      const lw = ctx.measureText(lab).width + W * 0.06
      const slide = 1 - Math.pow(1 - clamp01(inp.outTime / 0.5), 3)
      const ox = (1 - slide) * -W
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(ox, y, W, barH)
      ctx.fillStyle = t.accent
      ctx.fillRect(ox, y, lw, barH)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(lab, ox + lw / 2, y + barH / 2)
      ctx.fillStyle = '#111'
      ctx.textAlign = 'left'
      ctx.font = `800 ${barH * 0.36}px Montserrat, sans-serif`
      const head = wrapText(ctx, t.text.toUpperCase(), W - lw - W * 0.06)
      ctx.fillText(head[0] + (head.length > 1 ? '…' : ''), ox + lw + W * 0.03, y + barH / 2)
      // ticker
      const ty = y + barH
      const th = barH * 0.55
      ctx.fillStyle = '#111827'
      ctx.fillRect(0, ty, W, th)
      ctx.beginPath()
      ctx.rect(0, ty, W, th)
      ctx.clip()
      ctx.fillStyle = '#f9fafb'
      ctx.font = `600 ${th * 0.5}px Inter, sans-serif`
      const tick = `${t.ticker}   `
      const tw = ctx.measureText(tick).width
      let tx = -((inp.outTime * W * 0.18) % tw)
      while (tx < W) {
        ctx.fillText(tick, tx, ty + th / 2)
        tx += tw
      }
      break
    }
    case 'poll': {
      const opts = t.options.split('\n').filter(Boolean).slice(0, 4)
      const x = W * 0.08
      const w = W * 0.84
      ctx.font = `700 ${fs * 0.85}px Inter, sans-serif`
      const q = wrapText(ctx, t.text, w - W * 0.08)
      const qh = q.length * fs * 1.15
      const oh = fs * 1.35
      const h = W * 0.06 + qh + opts.length * (oh + W * 0.02) + W * 0.03
      const y = H * 0.08
      ctx.shadowColor = 'rgba(0,0,0,0.3)'
      ctx.shadowBlur = W * 0.04
      ctx.fillStyle = '#fff'
      rrPath(ctx, x, y, w, h, W * 0.035)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = '#111'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      q.forEach((l, i) => ctx.fillText(l, W / 2, y + W * 0.04 + i * fs * 1.15))
      const pcts = opts.map((_, i) => [62, 27, 11, 5][i] ?? 5)
      opts.forEach((o, i) => {
        const oy = y + W * 0.06 + qh + i * (oh + W * 0.02)
        const ox = x + W * 0.04
        const ow = w - W * 0.08
        ctx.fillStyle = '#f1f5f9'
        rrPath(ctx, ox, oy, ow, oh, oh / 2)
        ctx.fill()
        const fill = clamp01((inp.outTime - 0.3 - i * 0.15) / 0.8) * (pcts[i] / 100)
        ctx.fillStyle = i === 0 ? t.accent : '#cbd5e1'
        rrPath(ctx, ox, oy, Math.max(oh, ow * fill), oh, oh / 2)
        ctx.fill()
        ctx.fillStyle = '#0f172a'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        ctx.font = `600 ${fs * 0.7}px Inter, sans-serif`
        ctx.fillText(o, ox + W * 0.035, oy + oh / 2)
        ctx.textAlign = 'right'
        ctx.fillText(`${Math.round(fill * 100)}%`, ox + ow - W * 0.035, oy + oh / 2)
      })
      break
    }
    case 'comment': {
      const x = W * 0.08
      const w = W * 0.84
      const y = H * 0.1
      ctx.font = `600 ${fs * 0.8}px Inter, sans-serif`
      const lines = wrapText(ctx, t.text, w - W * 0.2)
      const lh = fs * 1.05
      const h = Math.max(W * 0.16, W * 0.1 + lines.length * lh)
      ctx.shadowColor = 'rgba(0,0,0,0.3)'
      ctx.shadowBlur = W * 0.04
      ctx.fillStyle = '#fff'
      rrPath(ctx, x, y, w, h, W * 0.03)
      ctx.fill()
      // tail
      ctx.beginPath()
      ctx.moveTo(x + W * 0.08, y + h - 1)
      ctx.lineTo(x + W * 0.06, y + h + W * 0.04)
      ctx.lineTo(x + W * 0.14, y + h - 1)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      drawAvatar(ctx, inp, x + W * 0.03, y + W * 0.03, W * 0.1)
      ctx.fillStyle = '#6b7280'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.font = `500 ${fs * 0.6}px Inter, sans-serif`
      ctx.fillText(`Reply to ${t.handle}'s comment`, x + W * 0.16, y + W * 0.035)
      ctx.fillStyle = '#111'
      ctx.font = `600 ${fs * 0.8}px Inter, sans-serif`
      lines.forEach((l, i) => ctx.fillText(l, x + W * 0.16, y + W * 0.075 + i * lh))
      break
    }
    case 'podcast': {
      const y = H * 0.7
      const slide = 1 - Math.pow(1 - clamp01((inp.outTime - 0.2) / 0.6), 3)
      const x = W * 0.06 - (1 - slide) * W * 0.8
      ctx.font = `800 ${fs * 0.9}px Montserrat, sans-serif`
      const nw = ctx.measureText(t.name).width
      ctx.font = `500 ${fs * 0.6}px Inter, sans-serif`
      const hw = ctx.measureText(t.handle).width
      const w = Math.max(nw, hw) + W * 0.1
      const h = fs * 2.2
      ctx.fillStyle = 'rgba(10,10,14,0.85)'
      rrPath(ctx, x, y, w, h, W * 0.02)
      ctx.fill()
      ctx.fillStyle = t.accent
      ctx.fillRect(x, y, W * 0.018, h)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.font = `800 ${fs * 0.9}px Montserrat, sans-serif`
      ctx.fillText(t.name, x + W * 0.05, y + fs * 0.3)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `500 ${fs * 0.6}px Inter, sans-serif`
      ctx.fillText(t.handle, x + W * 0.05, y + fs * 1.35)
      break
    }
    case 'headline-bar': {
      ctx.font = `900 ${fs}px Montserrat, sans-serif`
      const lines = wrapText(ctx, t.text.toUpperCase(), W * 0.86)
      const lh = fs * 1.2
      const h = lines.length * lh + W * 0.07
      ctx.fillStyle = t.accent
      ctx.fillRect(0, 0, W, h)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      lines.forEach((l, i) => ctx.fillText(l, W / 2, W * 0.035 + i * lh))
      break
    }
  }
  ctx.restore()
}

/* ---------------- captions ---------------- */

function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const p = inp.project
  const st = p.captionStyle
  const t = inp.srcTime
  const cue = p.cues.find((c) => t >= c.start && t < c.end)
  if (!cue) return
  const words = cueWords(cue)
  if (!words.length) return
  const label = (w: Word) => (st.uppercase ? w.text.toUpperCase() : w.text)
  const lines = wrapWords(
    words.map((w) => ({ ...w, text: label(w) })),
    st.maxChars,
  )
  let active = words.findIndex((w) => t >= w.start && t < w.end)
  if (active < 0) active = words.length - 1
  // find the page holding the active word
  const perPage = Math.max(1, st.maxLines)
  let idx = 0
  let pageStart = 0
  let page: typeof lines = []
  for (let i = 0; i < lines.length; i += perPage) {
    const chunk = lines.slice(i, i + perPage)
    const n = chunk.reduce((a, l) => a + l.length, 0)
    if (active < idx + n || i + perPage >= lines.length) {
      page = chunk
      pageStart = idx
      break
    }
    idx += n
  }

  const fs = (st.size / 100) * W
  const lh = fs * 1.18
  const fontFor = (w: Word) => `${w.style === 'italic' ? 'italic ' : ''}${st.weight} ${fs}px "${st.font}", sans-serif`
  const space = (() => {
    ctx.font = fontFor(words[0])
    // Extra room so a popped (scaled-up) word never touches its neighbours.
    return ctx.measureText(' ').width + fs * 0.16
  })()
  const baseY = st.y * H - ((page.length - 1) * lh) / 2

  ctx.save()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  let wi = pageStart
  const pageFirstStart = page[0]?.[0]?.start ?? cue.start
  page.forEach((line, li) => {
    const widths = line.map((w) => {
      ctx.font = fontFor(w)
      return ctx.measureText(w.text).width
    })
    const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1)
    let x = W / 2 - total / 2
    const y = baseY + li * lh
    line.forEach((w, k) => {
      const i = wi++
      const isActive = i === active
      const started = t >= w.start
      const ww = widths[k]
      let show = true
      let scale = 1
      let alpha = 1
      let color = w.style === 'bold' ? st.activeColor : st.color
      let box = w.style === 'box'
      const pop = clamp01((t - w.start) / 0.14)
      switch (st.animation) {
        case 'pop-in':
          show = isActive
          scale = 0.55 + 0.45 * easeOutBack(pop)
          if (isActive) color = st.activeColor
          break
        case 'pop-in-line':
          if (isActive) {
            color = st.activeColor
            scale = 1 + 0.14 * (pop < 1 ? easeOutBack(pop) : 1)
          }
          break
        case 'one-by-one':
          show = started
          if (isActive) color = st.activeColor
          break
        case 'build-up':
          show = started
          scale = started ? 0.6 + 0.4 * easeOutBack(pop) : 1
          if (isActive) color = st.activeColor
          break
        case 'highlight':
          if (isActive) {
            box = true
            color = '#ffffff'
          }
          break
        case 'full-line':
          alpha = clamp01((t - pageFirstStart) / 0.2)
          break
      }
      if (show) {
        ctx.save()
        ctx.globalAlpha = alpha
        const cx = x + ww / 2
        ctx.translate(cx, y)
        ctx.scale(scale, scale)
        ctx.font = fontFor(w)
        if (box) {
          ctx.fillStyle = st.boxColor
          rrPath(ctx, -ww / 2 - fs * 0.16, -fs * 0.62, ww + fs * 0.32, fs * 1.2, fs * 0.2)
          ctx.fill()
        }
        if (st.shadow > 0) {
          ctx.shadowColor = `rgba(0,0,0,${0.8 * st.shadow})`
          ctx.shadowBlur = fs * 0.35 * st.shadow
          ctx.shadowOffsetY = fs * 0.06
        }
        if (st.strokeWidth > 0 && !box) {
          ctx.strokeStyle = st.strokeColor
          ctx.lineWidth = fs * 0.16 * st.strokeWidth
          ctx.strokeText(w.text, -ww / 2, 0)
          ctx.shadowColor = 'transparent'
        }
        ctx.fillStyle = color
        ctx.fillText(w.text, -ww / 2, 0)
        ctx.restore()
      }
      x += ww + space
    })
  })
  ctx.restore()
}

function drawHeadline(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const h = inp.project.headline
  if (!h.enabled || !h.text.trim()) return
  const fs = (h.size / 100) * W
  ctx.save()
  ctx.font = `900 ${fs}px "${h.font}", sans-serif`
  const lines = wrapText(ctx, h.text, W * 0.84)
  const lh = fs * 1.15
  const sfs = fs * 0.55
  ctx.font = `600 ${sfs}px Inter, sans-serif`
  const sub = h.subline.trim() ? wrapText(ctx, h.subline, W * 0.84) : []
  const total = lines.length * lh + (sub.length ? sub.length * sfs * 1.3 + fs * 0.25 : 0)
  const y0 = h.y * H
  if (h.bgEnabled) {
    ctx.font = `900 ${fs}px "${h.font}", sans-serif`
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + W * 0.07
    ctx.fillStyle = h.bgColor
    rrPath(ctx, (W - bw) / 2, y0 - W * 0.025, bw, total + W * 0.05, W * 0.025)
    ctx.fill()
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = `900 ${fs}px "${h.font}", sans-serif`
  if (!h.bgEnabled) {
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = fs * 0.3
  }
  ctx.fillStyle = h.color
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh))
  ctx.font = `600 ${sfs}px Inter, sans-serif`
  ctx.globalAlpha = 0.85
  sub.forEach((l, i) => ctx.fillText(l, W / 2, y0 + lines.length * lh + fs * 0.25 + i * sfs * 1.3))
  ctx.restore()
}

function drawOutro(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const o = inp.project.outro
  if (!o.enabled || inp.duration <= 0) return
  const start = Math.max(0, inp.duration - o.duration)
  if (inp.outTime < start) return
  const p = clamp01((inp.outTime - start) / 0.45)
  ctx.save()
  ctx.fillStyle = `rgba(0,0,0,${0.35 * p})`
  ctx.fillRect(0, 0, W, H)
  const fs = W * 0.055
  ctx.font = `800 ${fs}px Montserrat, sans-serif`
  const tw = ctx.measureText(o.text).width
  ctx.font = `600 ${fs * 0.6}px Inter, sans-serif`
  const hw = ctx.measureText(o.handle).width
  const d = fs * 2
  const w = d + Math.max(tw, hw) + W * 0.1 + fs * 1.5
  const h = d + W * 0.05
  const x = (W - w) / 2
  const y = H * 0.42 + (1 - easeOutBack(p)) * H * 0.3
  ctx.globalAlpha = p
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = W * 0.05
  ctx.fillStyle = '#ffffff'
  rrPath(ctx, x, y, w, h, h / 2)
  ctx.fill()
  ctx.shadowColor = 'transparent'
  drawAvatar(ctx, inp, x + W * 0.025, y + W * 0.025, d)
  ctx.fillStyle = '#111'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `800 ${fs}px Montserrat, sans-serif`
  ctx.fillText(o.text, x + d + W * 0.06, y + h * 0.5)
  ctx.fillStyle = '#6b7280'
  ctx.font = `600 ${fs * 0.6}px Inter, sans-serif`
  ctx.fillText(o.handle, x + d + W * 0.06, y + h * 0.5 + fs * 0.85)
  // follow button pulse
  const bx = x + w - W * 0.025
  ctx.fillStyle = o.color
  const pulse = 1 + 0.08 * Math.sin(inp.outTime * 8)
  ctx.beginPath()
  ctx.arc(bx - fs * 0.6, y + h / 2, fs * 0.55 * pulse, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = fs * 0.12
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(bx - fs * 0.85, y + h / 2)
  ctx.lineTo(bx - fs * 0.35, y + h / 2)
  ctx.moveTo(bx - fs * 0.6, y + h / 2 - fs * 0.25)
  ctx.lineTo(bx - fs * 0.6, y + h / 2 + fs * 0.25)
  ctx.stroke()
  ctx.restore()
}

function drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const wm = inp.project.watermark
  if (!wm.enabled) return
  ctx.save()
  ctx.globalAlpha = wm.opacity
  const m = W * 0.04
  const img = inp.getSource(wm.imageId)
  const left = wm.position.endsWith('l')
  const top = wm.position.startsWith('t')
  if (ready(img)) {
    const [iw, ih] = srcSize(img)
    const w = W * wm.size
    const h = (w * ih) / iw
    ctx.drawImage(img, left ? m : W - m - w, top ? m + H * 0.03 : H - m - h - H * 0.08, w, h)
  } else if (wm.text.trim()) {
    const fs = W * wm.size * 0.22
    ctx.font = `700 ${fs}px Inter, sans-serif`
    ctx.textAlign = left ? 'left' : 'right'
    ctx.textBaseline = top ? 'top' : 'bottom'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = fs * 0.4
    ctx.fillStyle = '#fff'
    ctx.fillText(wm.text, left ? m : W - m, top ? m + H * 0.03 : H - m - H * 0.08)
  }
  ctx.restore()
}

/* ---------------- main ---------------- */

export function renderFrame(ctx: CanvasRenderingContext2D, W: number, H: number, inp: RenderInput) {
  const p = inp.project
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  drawBackground(ctx, W, H, inp)

  const showOverlay = !p.tracks.overlay.hidden
  const tpl = p.template.id
  if (showOverlay && FRAME_TEMPLATES.includes(tpl)) {
    drawFrameTemplate(ctx, W, H, inp)
  } else {
    const master = inp.getSource(p.slots[0].sourceId)
    let aspect = 16 / 9
    if (ready(master)) {
      const [sw, sh] = srcSize(master)
      aspect = sw / sh
    }
    const regions = layoutRegions(p, W, H, aspect)
    for (const reg of regions) {
      const slot = p.slots[reg.slot]
      // Split/trio slots without their own source reuse the master video.
      const id = slot.sourceId ?? (reg.slot > 0 ? p.slots[0].sourceId : null)
      drawRegion(ctx, inp.getSource(id), reg, slot.crop, p.background.shadow, W)
    }
    if (p.background.dividerSize > 0 && (p.layout === 'split' || p.layout === 'trio') && p.background.padding === 0) {
      ctx.fillStyle = p.background.dividerColor
      const r0 = regions[0].rect
      const g = (p.background.dividerSize / 1000) * H
      ctx.fillRect(0, r0.y + r0.h, W, g)
      if (p.layout === 'trio') ctx.fillRect(regions[1].rect.x + regions[1].rect.w, regions[1].rect.y, g, regions[1].rect.h)
    }
    if (showOverlay && tpl !== 'none') drawStickerTemplate(ctx, W, H, inp)
  }

  drawHeadline(ctx, W, H, inp)
  if (p.captionsEnabled && !p.tracks.captions.hidden) drawCaptions(ctx, W, H, inp)
  drawWatermark(ctx, W, H, inp)
  if (showOverlay) drawOutro(ctx, W, H, inp)
  ctx.restore()
}
