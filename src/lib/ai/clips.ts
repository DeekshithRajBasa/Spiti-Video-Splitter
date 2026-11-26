// Finds the best short clips in a transcript. Local mode scores moments offline
// (hooks, energy, pacing, payoff). AI mode asks a local or cloud LLM. Auto uses AI when
// it's set up and reachable, and falls back to Local otherwise.
import { uid } from '../../defaults'
import { store } from '../../store'
import { engine } from '../engine'
import { outToSource } from '../timeline'
import { providerInfo, providerReady, rankWithProvider } from './providers'
import { aiSettings } from './settings'
import { aiStore, type ClipSuggestion, type Transcript, type Word } from './state'
import { applyCaptions } from './whisper'

export interface Sentence {
  i: number
  start: number
  end: number
  text: string
  words: Word[]
}

/** Split recognised words into sentences (punctuation or pauses), capped at ~15 s each. */
export function toSentences(words: Word[]): Sentence[] {
  const out: Sentence[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    out.push({ i: out.length, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(' '), words: cur })
    cur = []
  }
  for (const w of words) {
    const prev = cur[cur.length - 1]
    if (prev && (w.start - prev.end > 0.8 || w.end - cur[0].start > 15)) flush()
    cur.push(w)
    if (/[.?!]["')\]]?$/.test(w.text)) flush()
  }
  flush()
  return out
}

/* ---------------- local scorer ---------------- */

const HOOKS = [
  /\b(nobody|no one) (tells|told|talks)\b/, /\bthe (secret|truth|real reason|problem|mistake|key)\b/, /\bhere'?s (why|how|the thing|what)\b/,
  /\b(biggest|worst|best|craziest|most important|number one)\b/, /\b(never|always|stop|don'?t|must)\b/, /\bwhy (do|does|did|is|are)\b/,
  /\blet me tell you\b/, /\byou (need|have) to\b/, /\bwhat if\b/, /\bthe (one|only) thing\b/, /\b(i|we) (learned|realized|discovered|quit|failed|lost|made)\b/,
  /\bthis is (why|how|what)\b/, /\bunpopular opinion\b/, /\b(hot take|plot twist)\b/,
]
const EMOTION = /\b(crazy|insane|amazing|incredible|shocking|terrified|hate|love|scared|angry|obsessed|wild|unbelievable|genius|ridiculous|huge|massive|destroyed|changed my life|viral|million|billion)\b/g
const FILLER = /\b(um+|uh+|erm|hmm|you know|i mean|kind of|sort of|like)\b/g
const LAUGH = /\b(haha+|lol|laugh(s|ing|ter)?)\b|\[laughter\]|\(laughs\)/i
const NUMBER = /\b\d+(\.\d+)?\s?(%|percent|k|million|billion|x|times|years|months|days|dollars)?\b/

function windowScore(sents: Sentence[], a: number, b: number, loud: number[], globalRate: number, medLoud: number) {
  const first = sents[a]
  const text = sents.slice(a, b + 1).map((s) => s.text).join(' ')
  const lower = text.toLowerCase()
  const start = first.start
  const end = sents[b].end
  const dur = end - start
  const nWords = sents.slice(a, b + 1).reduce((n, s) => n + s.words.length, 0)
  const opener = sents.slice(a, Math.min(b + 1, a + 2)).map((s) => s.text.toLowerCase()).join(' ')

  let hook = 0
  for (const h of HOOKS) if (h.test(opener)) hook += 1
  if (/\?/.test(first.text)) hook += 1.2
  if (NUMBER.test(opener)) hook += 0.6
  if (/^(so|and|but|because|which|that)\b/i.test(first.text)) hook -= 0.8 // starts mid-thought
  const emotion = (lower.match(EMOTION) || []).length / Math.max(1, dur / 30)
  const fillers = (lower.match(FILLER) || []).length / Math.max(1, nWords)
  const laughs = LAUGH.test(lower) ? 1 : 0
  const rate = nWords / Math.max(1, dur)
  const pace = Math.max(-1, Math.min(1, (rate - globalRate) / Math.max(0.5, globalRate * 0.35)))
  let energy = 0
  let peaks = 0
  for (let t = Math.floor(start); t < Math.ceil(end) && t < loud.length; t++) {
    energy += loud[t]
    if (loud[t] > medLoud * 1.6) peaks++
  }
  energy = energy / Math.max(1, Math.ceil(end) - Math.floor(start)) / Math.max(0.05, medLoud) - 1
  let gaps = 0
  for (let k = a + 1; k <= b; k++) if (sents[k].start - sents[k - 1].end > 1.8) gaps++
  const payoff = /[.!]$/.test(sents[b].text) ? 0.5 : -0.5
  const questionAnswered = /\?/.test(text) && b > a ? 0.6 : 0

  const raw =
    hook * 14 + emotion * 6 + laughs * 8 + pace * 7 + Math.max(-1, Math.min(2, energy)) * 8 + Math.min(4, peaks) * 2 +
    payoff * 6 + questionAnswered * 6 - fillers * 60 - gaps * 6
  return { raw, hook, opener }
}

function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

function shortTitle(text: string, n = 60) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`
}

export function localClips(tr: Transcript, count: number, minLen: number, maxLen: number): ClipSuggestion[] {
  const sents = toSentences(tr.words)
  if (!sents.length) return []
  const totalWords = tr.words.length
  const span = Math.max(1, tr.words[tr.words.length - 1].end - tr.words[0].start)
  const globalRate = totalWords / span
  const medLoud = median(tr.loudness.filter((v) => v > 0.01)) || 0.3
  const cands: { a: number; b: number; raw: number; hook: number }[] = []
  for (let a = 0; a < sents.length; a++) {
    for (let b = a; b < sents.length; b++) {
      const dur = sents[b].end - sents[a].start
      if (dur > maxLen) break
      if (dur < minLen) continue
      const s = windowScore(sents, a, b, tr.loudness, globalRate, medLoud)
      // Mild preference for the middle of the allowed length range.
      const lenFit = 1 - Math.abs(dur - (minLen + maxLen) / 2) / ((maxLen - minLen) / 2 + 1)
      cands.push({ a, b, raw: s.raw + lenFit * 4, hook: s.hook })
    }
  }
  if (!cands.length) {
    // Very short source: suggest the whole thing.
    return [{ id: uid(), start: sents[0].start, end: sents[sents.length - 1].end, title: shortTitle(sents[0].text), hook: shortTitle(sents[0].text, 80), score: 50, reason: 'The whole video is shorter than the minimum clip length.', source: 'local' }]
  }
  cands.sort((x, y) => y.raw - x.raw)
  const picked: typeof cands = []
  for (const c of cands) {
    const s = sents[c.a].start
    const e = sents[c.b].end
    if (picked.some((p) => s < sents[p.b].end + 2 && e > sents[p.a].start - 2)) continue
    picked.push(c)
    if (picked.length >= count) break
  }
  const top = picked[0]?.raw ?? 1
  const bottom = cands[cands.length - 1]?.raw ?? 0
  return picked.map((c) => {
    const opener = sents[c.a].text
    const reasons: string[] = []
    if (c.hook >= 1) reasons.push('strong opening line')
    if (/\?/.test(opener)) reasons.push('opens with a question')
    const body = sents.slice(c.a, c.b + 1).map((s) => s.text).join(' ').toLowerCase()
    if ((body.match(EMOTION) || []).length) reasons.push('emotional language')
    if (NUMBER.test(body)) reasons.push('concrete numbers')
    if (/[.!]$/.test(sents[c.b].text)) reasons.push('ends on a complete thought')
    return {
      id: uid(),
      start: Math.max(0, sents[c.a].start - 0.15),
      end: sents[c.b].end + 0.3,
      title: shortTitle(opener),
      hook: shortTitle(opener, 80),
      score: Math.round(40 + (55 * (c.raw - bottom)) / Math.max(1, top - bottom)),
      reason: reasons.length ? `${reasons.join(', ')}.` : 'Steady, clear speech.',
      source: 'local' as const,
    }
  })
}

/* ---------------- AI ranking ---------------- */

function systemPrompt(count: number, minLen: number, maxLen: number) {
  return `You are an expert short-form video editor who cuts long podcasts, streams and videos into clips for YouTube Shorts, Instagram Reels and TikTok.

You get a transcript split into numbered lines with start and end times in seconds. Pick up to ${count} clips that would perform best as standalone vertical videos.

A good clip:
- hooks the viewer within the first 2 seconds (a bold claim, a question, a surprising fact, conflict, or a strong emotion)
- makes sense on its own, without the rest of the conversation
- has a payoff: an answer, a punchline, a lesson or a reveal
- ends on a complete thought
- lasts between ${minLen} and ${maxLen} seconds (end time of end_line minus start time of start_line)

Rules:
- Use only line numbers that appear in the transcript. start_line <= end_line.
- Clips must not overlap.
- title: a catchy title under 60 characters.
- hook: the on-screen headline for the first seconds, under 80 characters, in the speaker's language. You may rephrase.
- score: 0-100, how likely the clip is to do well. Be discerning; reserve 90+ for exceptional moments.
- reason: one short sentence on why it works.
- Fewer, better clips beat filler. Return an empty list if nothing qualifies.`
}

function linesBlock(sents: Sentence[]) {
  return sents.map((s) => `L${s.i} [${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n')
}

/** Chunk long transcripts so each request fits small local models; cloud models get bigger chunks. */
function chunkSentences(sents: Sentence[], maxChars: number): Sentence[][] {
  const chunks: Sentence[][] = []
  let cur: Sentence[] = []
  let n = 0
  for (const s of sents) {
    const len = s.text.length + 20
    if (cur.length && n + len > maxChars) {
      chunks.push(cur)
      // Overlap a little so moments on a boundary aren't lost.
      cur = cur.slice(-4)
      n = cur.reduce((x, y) => x + y.text.length + 20, 0)
    }
    cur.push(s)
    n += len
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

export async function aiClips(tr: Transcript, count: number, minLen: number, maxLen: number, title: string): Promise<ClipSuggestion[]> {
  const s = aiSettings.get()
  const sents = toSentences(tr.words)
  if (!sents.length) return []
  const local = providerInfo(s.provider).kind === 'local'
  const chunks = chunkSentences(sents, local ? 22_000 : 160_000)
  const picks: ClipSuggestion[] = []
  for (let c = 0; c < chunks.length; c++) {
    aiStore.job({ stage: 'clips', message: `Asking ${providerInfo(s.provider).name}${chunks.length > 1 ? ` · part ${c + 1} of ${chunks.length}` : ''}…`, progress: c / chunks.length })
    const perChunk = chunks.length > 1 ? Math.max(2, Math.ceil((count * 1.5) / chunks.length)) : count
    const res = await rankWithProvider(
      systemPrompt(perChunk, minLen, maxLen),
      `${title ? `Video title: ${title}\n\n` : ''}Transcript:\n${linesBlock(chunks[c])}`,
    )
    for (const p of res.clips) {
      let a = Math.max(0, Math.min(p.start_line, p.end_line))
      let b = Math.min(sents.length - 1, Math.max(p.start_line, p.end_line))
      if (!sents[a] || !sents[b]) continue
      // Nudge to the allowed length on sentence boundaries.
      while (sents[b].end - sents[a].start < minLen && b < sents.length - 1) b++
      while (sents[b].end - sents[a].start > maxLen && b > a) b--
      while (sents[b].end - sents[a].start > maxLen && a < b) a++
      picks.push({
        id: uid(),
        start: Math.max(0, sents[a].start - 0.15),
        end: sents[b].end + 0.3,
        title: shortTitle(p.title || sents[a].text),
        hook: shortTitle(p.hook || p.title, 80),
        score: Math.max(0, Math.min(100, p.score)),
        reason: p.reason,
        source: 'ai',
      })
    }
  }
  picks.sort((x, y) => y.score - x.score)
  const out: ClipSuggestion[] = []
  for (const p of picks) {
    if (out.some((o) => p.start < o.end && p.end > o.start)) continue
    out.push(p)
    if (out.length >= count) break
  }
  return out
}

/** Run the selected mode. Auto falls back to Local when AI isn't available or fails. */
export async function findClips(tr: Transcript, title = ''): Promise<ClipSuggestion[]> {
  const s = aiSettings.get()
  const args = [tr, s.clipCount, s.minLength, Math.max(s.minLength + 5, s.maxLength)] as const
  let notice = ''
  let clips: ClipSuggestion[]
  if (s.clipMode === 'local') clips = localClips(...args)
  else {
    const ready = await providerReady(s.provider)
    if (!ready.ok) {
      if (s.clipMode === 'ai') throw new Error(ready.reason)
      notice = `Used Local mode: ${ready.reason?.replace(/\.$/, '')}.`
      clips = localClips(...args)
    } else {
      try {
        clips = await aiClips(...args, title)
        if (!clips.length && s.clipMode === 'auto') {
          notice = 'The AI found no strong clips, so these are from Local mode.'
          clips = localClips(...args)
        }
      } catch (e) {
        if (s.clipMode === 'ai') throw e
        notice = `AI failed (${(e as Error).message.replace(/\.$/, '')}). Used Local mode instead.`
        clips = localClips(...args)
      }
    }
  }
  aiStore.set({ clips, clipsFor: tr.mediaId, notice, activeClip: null })
  return clips
}

/* ---------------- applying clips ---------------- */

/** Turn a suggestion into the current edit: cut to it, caption it, add the hook headline. */
export function applyClip(c: ClipSuggestion) {
  const s = aiSettings.get()
  const tr = aiStore.get().transcripts[aiStore.get().clipsFor ?? '']
  store.update((p) => {
    p.segments = [{ id: uid(), start: c.start, end: c.end }]
    if (s.hookHeadline && c.hook) {
      p.headline.enabled = true
      p.headline.text = c.hook
      p.headline.subline = ''
    }
    p.name = slug(c.title) || p.name
  })
  if (tr && s.autoCaptions) applyCaptions(tr, [c.start, c.end])
  store.ui({ inPoint: null, outPoint: null, selection: null })
  aiStore.set({ activeClip: c.id })
  engine.seek(0)
}

export function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

/** The transcription range: In→Out if set, otherwise the whole video. Source seconds. */
export function transcribeRange(): [number, number] | undefined {
  const { ui, project } = store.get()
  if (ui.inPoint == null && ui.outPoint == null) return undefined
  const a = outToSource(project.segments, ui.inPoint ?? 0).src
  const b = outToSource(project.segments, ui.outPoint ?? engine.duration).src
  return b - a > 1 ? [a, b] : undefined
}
