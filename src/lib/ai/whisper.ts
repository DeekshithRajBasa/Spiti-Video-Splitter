// On-device speech recognition (Whisper via transformers.js). Works in the browser and the
// desktop app; models download once from Hugging Face and are cached by the browser.
import ortAsyncifyMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortAsyncifyWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import ortPlainMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortPlainWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { uid } from '../../defaults'
import { store } from '../../store'
import type { Cue, MediaItem } from '../../types'
import { desktop } from '../desktop'
import { aiSettings } from './settings'
import { aiStore, type Transcript, type Word } from './state'

export interface WhisperModel {
  id: string
  name: string
  /** Approximate download, in MB, for the files we load (WASM / WebGPU). */
  sizeWasm: number
  sizeGpu: number
  english: boolean
  speed: 1 | 2 | 3 | 4 | 5
  quality: 1 | 2 | 3 | 4 | 5
  note: string
  gpuOnly?: boolean
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'onnx-community/whisper-tiny_timestamped', name: 'Whisper Tiny', sizeWasm: 41, sizeGpu: 105, english: false, speed: 5, quality: 1, note: '99 languages. Fastest; fine for clear speech.' },
  { id: 'onnx-community/whisper-tiny.en_timestamped', name: 'Whisper Tiny (English)', sizeWasm: 41, sizeGpu: 105, english: true, speed: 5, quality: 2, note: 'English only, a bit more accurate than Tiny.' },
  { id: 'onnx-community/whisper-base_timestamped', name: 'Whisper Base', sizeWasm: 77, sizeGpu: 205, english: false, speed: 4, quality: 2, note: '99 languages. Good default for most podcasts.' },
  { id: 'onnx-community/whisper-base.en_timestamped', name: 'Whisper Base (English)', sizeWasm: 77, sizeGpu: 205, english: true, speed: 4, quality: 3, note: 'English only. Good balance of speed and accuracy.' },
  { id: 'onnx-community/whisper-small_timestamped', name: 'Whisper Small', sizeWasm: 245, sizeGpu: 590, english: false, speed: 3, quality: 3, note: '99 languages. Noticeably better with accents and noise.' },
  { id: 'onnx-community/whisper-small.en_timestamped', name: 'Whisper Small (English)', sizeWasm: 245, sizeGpu: 590, english: true, speed: 3, quality: 4, note: 'English only. Strong accuracy, still practical on CPU.' },
  { id: 'onnx-community/whisper-medium_timestamped', name: 'Whisper Medium', sizeWasm: 790, sizeGpu: 1050, english: false, speed: 2, quality: 4, note: '99 languages. Slow without a graphics card.', gpuOnly: true },
  { id: 'onnx-community/whisper-large-v3-turbo_timestamped', name: 'Whisper Large v3 Turbo', sizeWasm: 1100, sizeGpu: 1000, english: false, speed: 2, quality: 5, note: '99 languages. Best accuracy; needs WebGPU.', gpuOnly: true },
]

export const LANGUAGES: [string, string][] = [
  ['auto', 'Detect automatically'], ['en', 'English'], ['hi', 'Hindi'], ['te', 'Telugu'], ['ta', 'Tamil'], ['kn', 'Kannada'],
  ['ml', 'Malayalam'], ['mr', 'Marathi'], ['bn', 'Bengali'], ['gu', 'Gujarati'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
  ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['nl', 'Dutch'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['fa', 'Persian'],
  ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
]

export const modelInfo = (id: string) => WHISPER_MODELS.find((m) => m.id === id) ?? WHISPER_MODELS[2]

/* ---------- device ---------- */

let gpuInfo: Promise<{ webgpu: boolean; f16: boolean; name: string }> | null = null
export function detectGpu() {
  if (!gpuInfo) {
    gpuInfo = (async () => {
      try {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string>; info?: { vendor?: string; architecture?: string; description?: string } } | null> } }).gpu
        const a = await gpu?.requestAdapter()
        if (!a) return { webgpu: false, f16: false, name: '' }
        const i = a.info
        return { webgpu: true, f16: a.features.has('shader-f16'), name: i?.description || [i?.vendor, i?.architecture].filter(Boolean).join(' ') || 'GPU' }
      } catch {
        return { webgpu: false, f16: false, name: '' }
      }
    })()
  }
  return gpuInfo
}

/** Which model files are already downloaded (transformers.js caches them in Cache Storage). */
export async function cachedModels(): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const c = await caches.open('transformers-cache')
    for (const req of await c.keys()) {
      const m = /huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/onnx\//.exec(req.url)
      if (m) out.add(m[1])
    }
  } catch {
    /* no Cache Storage (e.g. insecure context) */
  }
  return out
}

export async function deleteCachedModel(id: string) {
  const c = await caches.open('transformers-cache')
  for (const req of await c.keys()) if (req.url.includes(`/${id}/`)) await c.delete(req)
}

/* ---------- worker ---------- */

let worker: Worker | null = null
let reqId = 0
const pending = new Map<number, { resolve: (w: Word[]) => void; reject: (e: Error) => void }>()
let loadWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'download') aiStore.job({ stage: 'model', message: `Downloading speech model · ${(m.loaded / 1048576).toFixed(0)} / ${(m.total / 1048576).toFixed(0)} MB`, progress: m.total ? m.loaded / m.total : null })
    else if (m.type === 'ready') {
      loadWaiter?.resolve()
      loadWaiter = null
    } else if (m.type === 'result') {
      pending.get(m.id)?.resolve(m.words)
      pending.delete(m.id)
    } else if (m.type === 'error') {
      const err = new Error(m.message)
      if (m.id != null && pending.has(m.id)) {
        pending.get(m.id)!.reject(err)
        pending.delete(m.id)
      } else {
        loadWaiter?.reject(err)
        loadWaiter = null
      }
    }
  }
  return worker
}

export function cancelTranscription() {
  worker?.terminate()
  worker = null
  for (const p of pending.values()) p.reject(new Error('Cancelled'))
  pending.clear()
  loadWaiter?.reject(new Error('Cancelled'))
  loadWaiter = null
}

async function loadModel(modelId: string) {
  const s = aiSettings.get()
  const gpu = await detectGpu()
  const info = modelInfo(modelId)
  const useGpu = s.device === 'webgpu' || (s.device === 'auto' && gpu.webgpu)
  if (s.device === 'webgpu' && !gpu.webgpu) throw new Error('WebGPU is not available on this device. Pick “Auto” or “CPU”.')
  const device: 'webgpu' | 'wasm' = useGpu && gpu.webgpu ? 'webgpu' : 'wasm'
  const dtype =
    device === 'webgpu'
      ? { encoder_model: gpu.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }
      : { encoder_model: 'q8', decoder_model_merged: 'q8' }
  if (device === 'wasm' && info.gpuOnly) throw new Error(`${info.name} needs WebGPU. Choose a smaller model for this device.`)
  const threaded = typeof SharedArrayBuffer !== 'undefined'
  const w = getWorker()
  aiStore.job({ stage: 'model', message: `Loading ${info.name}…`, progress: null })
  await new Promise<void>((resolve, reject) => {
    loadWaiter = { resolve, reject }
    w.postMessage({
      type: 'load',
      model: modelId,
      device,
      dtype,
      // The asyncify build runs both WASM and WebGPU; the plain one is for browsers without WebGPU.
      wasmPaths: device === 'webgpu' ? { mjs: abs(ortAsyncifyMjs), wasm: abs(ortAsyncifyWasm) } : { mjs: abs(ortPlainMjs), wasm: abs(ortPlainWasm) },
      threads: threaded ? Math.min(8, navigator.hardwareConcurrency || 4) : 1,
    })
  })
  return device
}

const abs = (u: string) => new URL(u, location.href).href

/* ---------- audio ---------- */

const SR = 16000
const CHUNK = 60
const OVERLAP = 1.5

/** Decode a whole file to 16 kHz mono in the browser (used when there's no FFmpeg). */
async function decodeAll(m: MediaItem): Promise<Float32Array> {
  const blob = m.file ?? (await (await fetch(m.url)).blob())
  if (blob.size > 1.6 * 1024 ** 3) throw new Error('This file is too large to transcribe in the browser. Use the desktop app, or trim it first.')
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
  } catch {
    throw new Error("This browser can't decode this file's audio.")
  } finally {
    void ctx.close()
  }
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  return (await off.startRendering()).getChannelData(0)
}

async function pcmChunk(m: MediaItem, start: number, dur: number, whole: Float32Array | null): Promise<Float32Array> {
  if (whole) return whole.slice(Math.floor(start * SR), Math.floor((start + dur) * SR))
  const raw = await desktop!.audioPcm({ file: m.path!, start, duration: dur })
  // Copy so the Float32Array is aligned.
  const copy = new Uint8Array(raw.byteLength - (raw.byteLength % 4))
  copy.set(raw.subarray(0, copy.length))
  return new Float32Array(copy.buffer)
}

/* ---------- transcription ---------- */

/** Transcribe the main video (or part of it, in source seconds). */
export async function transcribe(m: MediaItem, range?: [number, number]): Promise<Transcript> {
  const s = aiSettings.get()
  const info = modelInfo(s.whisperModel)
  const [a, b] = range ?? [0, m.duration]
  aiStore.job({ stage: 'audio', message: 'Reading audio…', progress: null, error: undefined })
  const whole = desktop && m.path ? null : await decodeAll(m)
  const device = await loadModel(info.id)
  const words: Word[] = []
  const loudness: number[] = []
  const total = b - a
  const t0 = performance.now()
  for (let t = a; t < b; t += CHUNK) {
    const len = Math.min(CHUNK + OVERLAP, b - t)
    const audio = await pcmChunk(m, t, len, whole)
    // Loudness (RMS) per second, for the local clip scorer.
    for (let i = 0; i < Math.min(CHUNK, len); i++) {
      let sum = 0
      const seg = audio.subarray(i * SR, (i + 1) * SR)
      for (let k = 0; k < seg.length; k += 4) sum += seg[k] * seg[k]
      loudness.push(Math.sqrt(sum / Math.max(1, seg.length / 4)))
    }
    if (audio.length < SR * 0.3) continue
    const id = ++reqId
    const got = await new Promise<Word[]>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      getWorker().postMessage({ type: 'transcribe', id, audio, language: s.language === 'auto' || info.english ? null : s.language, english: info.english }, [audio.buffer])
    })
    const lastEnd = words.length ? words[words.length - 1].end : -1
    for (const w of got) {
      const text = w.text.trim()
      const start = t + w.start
      const end = t + Math.max(w.end, w.start + 0.05)
      // Skip words the overlap already produced.
      if (!text || start < lastEnd - 0.05) continue
      words.push({ text, start, end })
    }
    const done = Math.min(total, t + CHUNK - a)
    const speed = done / ((performance.now() - t0) / 1000)
    aiStore.job({
      stage: 'transcribe',
      message: `Transcribing on ${device === 'webgpu' ? 'GPU' : 'CPU'} · ${Math.round((done / total) * 100)}% · ${speed.toFixed(1)}× speed`,
      progress: done / total,
    })
  }
  const max = Math.max(1e-4, ...loudness)
  const tr: Transcript = {
    mediaId: m.id,
    model: info.id,
    language: s.language,
    words,
    loudness: loudness.map((v) => v / max),
    range: [a, b],
    createdAt: Date.now(),
  }
  aiStore.set({ transcripts: { ...aiStore.get().transcripts, [m.id]: tr } })
  return tr
}

const NON_SPEECH = /^[[(].*[\])]$|^♪+$/

/** Turn recognised words into caption cues with real per-word timing. */
export function wordsToCues(words: Word[], maxWords: number, maxChars: number): Cue[] {
  const cues: Cue[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    // Caption markup characters would restyle words, so strip them from recognised text.
    const clean = cur.map((w) => w.text.replace(/[*_[\]]/g, ''))
    cues.push({ id: uid(), start: cur[0].start, end: cur[cur.length - 1].end, text: clean.join(' '), words: cur.map((w) => [w.start, w.end]) })
    cur = []
  }
  for (const w of words) {
    if (NON_SPEECH.test(w.text)) {
      flush()
      continue
    }
    const prev = cur[cur.length - 1]
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length
    // Let one extra word in if it finishes the sentence, so captions don't start on a full stop.
    const endsSentence = /[.?!,]$/.test(w.text) && cur.length <= maxWords
    const full = cur.length >= maxWords && !endsSentence
    if (prev && (w.start - prev.end > 0.6 || full || chars > maxChars + (endsSentence ? 8 : 0) || w.end - cur[0].start > 3.2)) flush()
    cur.push(w)
    if (/[.?!]$/.test(w.text) && cur.length >= 2) flush()
  }
  flush()
  return cues
}

/** Put transcript words in [a, b] onto the timeline as captions. */
export function applyCaptions(tr: Transcript, range?: [number, number]) {
  const s = aiSettings.get()
  const st = store.get().project.captionStyle
  const words = range ? tr.words.filter((w) => w.start >= range[0] - 0.05 && w.end <= range[1] + 0.05) : tr.words
  const cues = wordsToCues(words, s.captionWords, st.maxChars * Math.max(1, st.maxLines))
  store.update((p) => {
    p.cues = cues
    p.captionsEnabled = true
  })
  return cues.length
}
