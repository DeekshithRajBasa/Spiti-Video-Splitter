import type { Segment } from '../types'

export function totalDuration(segs: Segment[]) {
  return segs.reduce((a, s) => a + (s.end - s.start), 0)
}

/** Map output time to a source time on the master video. */
export function outToSource(segs: Segment[], t: number): { index: number; src: number } {
  let acc = 0
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i].end - segs[i].start
    if (t < acc + len || i === segs.length - 1) {
      return { index: i, src: segs[i].start + Math.min(Math.max(0, t - acc), len) }
    }
    acc += len
  }
  return { index: -1, src: t }
}

/** Map a master source time to output time; null when it falls in a cut. */
export function sourceToOut(segs: Segment[], src: number): number | null {
  let acc = 0
  for (const s of segs) {
    if (src >= s.start && src <= s.end) return acc + (src - s.start)
    acc += s.end - s.start
  }
  return null
}

export function segmentOutStart(segs: Segment[], index: number) {
  let acc = 0
  for (let i = 0; i < index; i++) acc += segs[i].end - segs[i].start
  return acc
}

/** Output-time ranges that a source range [a,b] occupies after cuts. */
export function sourceRangeToOut(segs: Segment[], a: number, b: number): [number, number][] {
  const out: [number, number][] = []
  let acc = 0
  for (const s of segs) {
    const lo = Math.max(a, s.start)
    const hi = Math.min(b, s.end)
    if (hi > lo) out.push([acc + lo - s.start, acc + hi - s.start])
    acc += s.end - s.start
  }
  return out
}

export function fmtTime(t: number, frames = false, fps = 30) {
  if (!isFinite(t) || t < 0) t = 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const p = (n: number) => String(n).padStart(2, '0')
  const base = `${p(h)}:${p(m)}:${p(s)}`
  return frames ? `${base}:${p(Math.floor((t % 1) * fps))}` : base
}

export function fmtShort(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
