import { uid } from '../defaults'
import type { Cue } from '../types'

function parseTs(s: string): number {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?/)
  if (!m) return 0
  const h = Number(m[1] ?? 0)
  const mi = Number(m[2])
  const se = Number(m[3])
  const frac = m[4] ? Number(`0.${m[4]}`) : 0
  return h * 3600 + mi * 60 + se + frac
}

const stripTags = (t: string) =>
  t
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Parse .srt, .vtt or .ass/.ssa text into cues. */
export function parseSubtitles(text: string): Cue[] {
  text = text.replace(/\r/g, '')
  if (/\[Events\]/i.test(text)) {
    const cues: Cue[] = []
    let fmt: string[] = []
    for (const line of text.split('\n')) {
      if (/^Format:/i.test(line)) fmt = line.slice(7).split(',').map((s) => s.trim().toLowerCase())
      if (/^Dialogue:/i.test(line) && fmt.length) {
        const parts = line.slice(9).split(',')
        const textIdx = fmt.indexOf('text')
        const get = (k: string) => parts[fmt.indexOf(k)] ?? ''
        const body = parts.slice(textIdx).join(',')
        const t = stripTags(body)
        if (t) cues.push({ id: uid(), start: parseTs(get('start')), end: parseTs(get('end')), text: t })
      }
    }
    return cues.sort((a, b) => a.start - b.start)
  }
  const cues: Cue[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const ti = lines.findIndex((l) => l.includes('-->'))
    if (ti < 0) continue
    const [a, b] = lines[ti].split('-->')
    const body = stripTags(lines.slice(ti + 1).join(' '))
    if (body) cues.push({ id: uid(), start: parseTs(a), end: parseTs(b.split(' ').filter(Boolean)[0] ?? b), text: body })
  }
  return cues.sort((a, b) => a.start - b.start)
}

const pad = (n: number, l = 2) => String(n).padStart(l, '0')
export function toSrt(cues: Cue[]) {
  const ts = (t: number) =>
    `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(Math.floor(t % 60))},${pad(Math.round((t % 1) * 1000), 3)}`
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n')
}

/** Turn plain typed text into timed cues of ~N words starting at `start`. */
export function textToCues(text: string, start: number, wordsPerSecond = 2.6, wordsPerCue = 4): Cue[] {
  const words = text.split(/\s+/).filter(Boolean)
  const cues: Cue[] = []
  let t = start
  for (let i = 0; i < words.length; i += wordsPerCue) {
    const chunk = words.slice(i, i + wordsPerCue)
    const d = chunk.length / wordsPerSecond
    cues.push({ id: uid(), start: t, end: t + d, text: chunk.join(' ') })
    t += d
  }
  return cues
}

export type WordStyle = 'normal' | 'bold' | 'italic' | 'box'

export interface Word {
  text: string
  style: WordStyle
  start: number
  end: number
}

/**
 * Split a cue into timed words. Markup: *word* = accent, _word_ = italic,
 * [word] = boxed. Timing is shared out by word length.
 */
export function cueWords(cue: Cue): Word[] {
  const raw = cue.text.split(/\s+/).filter(Boolean)
  const words = raw.map((w) => {
    let style: WordStyle = 'normal'
    let text = w
    if (/^\*.+\*[.,!?]?$/.test(w)) {
      style = 'bold'
      text = w.replace(/\*/g, '')
    } else if (/^_.+_[.,!?]?$/.test(w)) {
      style = 'italic'
      text = w.replace(/_/g, '')
    } else if (/^\[.+\][.,!?]?$/.test(w)) {
      style = 'box'
      text = w.replace(/[[\]]/g, '')
    }
    return { text, style }
  })
  // Real word timings from speech recognition, as long as the text wasn't re-worded.
  if (cue.words && cue.words.length === words.length) {
    return words.map((w, i) => ({ ...w, start: cue.words![i][0], end: Math.max(cue.words![i][1], cue.words![i][0] + 0.05) }))
  }
  const weights = words.map((w) => Math.max(2, w.text.length) + 1)
  const total = weights.reduce((a, b) => a + b, 0)
  const dur = Math.max(0.05, cue.end - cue.start)
  let t = cue.start
  return words.map((w, i) => {
    const d = (weights[i] / total) * dur
    const r = { ...w, start: t, end: t + d }
    t += d
    return r
  })
}

/** Group words into lines no longer than maxChars. */
export function wrapWords<T extends { text: string }>(words: T[], maxChars: number): T[][] {
  const lines: T[][] = []
  let cur: T[] = []
  let len = 0
  for (const w of words) {
    const add = (cur.length ? 1 : 0) + w.text.length
    if (cur.length && len + add > maxChars) {
      lines.push(cur)
      cur = []
      len = 0
    }
    cur.push(w)
    len += (cur.length > 1 ? 1 : 0) + w.text.length
  }
  if (cur.length) lines.push(cur)
  return lines
}
