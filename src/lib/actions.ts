import { uid } from '../defaults'
import { store } from '../store'
import type { MediaItem } from '../types'
import { parseSubtitles } from './captions'
import { engine } from './engine'
import { importFile, isSubtitle } from './media'
import { outToSource, sourceToOut, totalDuration } from './timeline'

export function setMaster(m: MediaItem) {
  if (m.kind !== 'video') return
  store.update((p) => {
    p.slots[0].sourceId = m.id
    p.segments = [{ id: uid(), start: 0, end: m.duration }]
  })
  store.ui({ inPoint: null, outPoint: null, selection: null })
  setTimeout(() => engine.seek(0), 50)
}

export function setSlot(index: number, m: MediaItem | null) {
  store.update((p) => {
    p.slots[index].sourceId = m?.id ?? null
    if (index > 0 && p.layout === 'solo') p.layout = index === 2 ? 'trio' : 'split'
    if (index === 2 && p.layout !== 'trio') p.layout = 'trio'
  })
}

export function setMusic(m: MediaItem) {
  store.update((p) => {
    p.music.mediaId = m.id
  })
}

export async function addSfx(m: MediaItem) {
  await engine.loadBuffer(m)
  store.update((p) => {
    p.sfx.push({ id: uid(), mediaId: m.id, at: engine.outTime, volume: 0.9 })
  })
}

/** Smart default when a file is dropped or clicked. */
export async function useMedia(m: MediaItem) {
  const p = store.get().project
  if (m.kind === 'video') {
    if (!p.slots[0].sourceId) setMaster(m)
    else if (!p.slots[1].sourceId) setSlot(1, m)
    else setSlot(2, m)
  } else if (m.kind === 'audio') {
    if (!p.music.mediaId) setMusic(m)
    else await addSfx(m)
  } else if (m.kind === 'image') {
    if (!p.slots[0].sourceId) return
    setSlot(1, m)
  }
}

export async function importFiles(files: FileList | File[]) {
  const list = Array.from(files)
  for (const f of list) {
    if (isSubtitle(f)) {
      const cues = parseSubtitles(await f.text())
      store.update((p) => {
        p.cues = cues
        p.captionsEnabled = true
      })
      store.ui({ leftTab: 'captions' })
      continue
    }
    try {
      const m = await importFile(f)
      if (m && m.kind === 'video' && !store.get().project.slots[0].sourceId) setMaster(m)
    } catch (e) {
      alert(`${f.name}: ${(e as Error).message}`)
    }
  }
}

/* ---------- timeline editing ---------- */

export function splitAtPlayhead() {
  const p = store.get().project
  if (p.tracks.video.locked) return
  const { index, src } = outToSource(p.segments, engine.outTime)
  const seg = p.segments[index]
  if (!seg || src - seg.start < 0.05 || seg.end - src < 0.05) return
  store.update((d) => {
    const s = d.segments[index]
    const a = { id: uid(), start: s.start, end: src }
    const b = { id: uid(), start: src, end: s.end }
    d.segments.splice(index, 1, a, b)
  })
  const after = store.get().project.segments[index + 1]
  store.ui({ selection: { kind: 'segment', id: after.id } })
}

export function deleteSelection() {
  const { selection } = store.get().ui
  const p = store.get().project
  if (!selection) return
  if (selection.kind === 'segment') {
    if (p.segments.length <= 1 || p.tracks.video.locked) return
    store.update((d) => {
      d.segments = d.segments.filter((s) => s.id !== selection.id)
    })
    engine.seek(Math.min(engine.outTime, totalDuration(store.get().project.segments)))
  } else if (selection.kind === 'cue') {
    if (p.tracks.captions.locked) return
    store.update((d) => {
      d.cues = d.cues.filter((c) => c.id !== selection.id)
    })
  } else if (selection.kind === 'sfx') {
    store.update((d) => {
      d.sfx = d.sfx.filter((c) => c.id !== selection.id)
    })
  } else if (selection.kind === 'music') {
    store.update((d) => {
      d.music.mediaId = null
    })
  } else if (selection.kind === 'overlay') {
    store.update((d) => {
      d.template.id = 'none'
    })
  }
  store.ui({ selection: null })
}

export function setInPoint() {
  store.ui({ inPoint: engine.outTime })
}
export function setOutPoint() {
  store.ui({ outPoint: engine.outTime })
}

/** Keep only the In→Out range of the current edit. */
export function trimToInOut() {
  const { inPoint, outPoint } = store.get().ui
  const p = store.get().project
  const a = inPoint ?? 0
  const b = outPoint ?? totalDuration(p.segments)
  if (b - a < 0.1) return
  store.update((d) => {
    const out: typeof d.segments = []
    let acc = 0
    for (const s of d.segments) {
      const len = s.end - s.start
      const lo = Math.max(a, acc)
      const hi = Math.min(b, acc + len)
      if (hi > lo) out.push({ id: uid(), start: s.start + (lo - acc), end: s.start + (hi - acc) })
      acc += len
    }
    d.segments = out
  })
  store.ui({ inPoint: null, outPoint: null })
  engine.seek(0)
}

/** Cut the In→Out range out of the edit. */
export function rippleDeleteInOut() {
  const { inPoint, outPoint } = store.get().ui
  if (inPoint == null || outPoint == null || outPoint - inPoint < 0.05) return
  store.update((d) => {
    const out: typeof d.segments = []
    let acc = 0
    for (const s of d.segments) {
      const len = s.end - s.start
      const segA = acc
      const segB = acc + len
      if (outPoint <= segA || inPoint >= segB) out.push(s)
      else {
        if (inPoint > segA) out.push({ id: uid(), start: s.start, end: s.start + (inPoint - segA) })
        if (outPoint < segB) out.push({ id: uid(), start: s.start + (outPoint - segA), end: s.end })
      }
      acc += len
    }
    if (out.length) d.segments = out
  })
  store.ui({ inPoint: null, outPoint: null })
  engine.seek(inPoint)
}

export function resetCuts() {
  const p = store.get().project
  const m = p.slots[0].sourceId ? store.get().media[p.slots[0].sourceId] : null
  if (!m) return
  store.update((d) => {
    d.segments = [{ id: uid(), start: 0, end: m.duration }]
  })
}

/** Insert a caption at the playhead (source time). */
export function addCueAtPlayhead(text = 'New caption') {
  const src = engine.srcTime
  const id = uid()
  store.update((d) => {
    d.cues.push({ id, start: src, end: src + 1.6, text })
    d.cues.sort((a, b) => a.start - b.start)
    d.captionsEnabled = true
  })
  store.ui({ selection: { kind: 'cue', id }, leftTab: 'captions' })
  return id
}

export function cueOutStart(start: number) {
  return sourceToOut(store.get().project.segments, start)
}
