/// <reference lib="webworker" />
// Runs Whisper (transformers.js + ONNX Runtime) off the main thread.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

type Msg =
  | { type: 'load'; model: string; device: 'webgpu' | 'wasm'; dtype: Record<string, string>; wasmPaths: { mjs: string; wasm: string }; threads: number }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null; english: boolean }

let pipe: AutomaticSpeechRecognitionPipeline | null = null
let loaded = ''

env.allowLocalModels = false
env.useBrowserCache = true

const post = (m: unknown) => (self as unknown as Worker).postMessage(m)

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      const key = `${msg.model}|${msg.device}|${JSON.stringify(msg.dtype)}`
      if (pipe && loaded === key) return post({ type: 'ready' })
      const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } }
      if (onnx.wasm) {
        onnx.wasm.wasmPaths = msg.wasmPaths
        onnx.wasm.numThreads = msg.threads
      }
      await pipe?.dispose()
      pipe = null
      const files = new Map<string, { loaded: number; total: number }>()
      pipe = (await pipeline('automatic-speech-recognition', msg.model, {
        device: msg.device,
        dtype: msg.dtype as never,
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status === 'progress' && p.file) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
            let a = 0
            let b = 0
            for (const f of files.values()) {
              a += f.loaded
              b += f.total
            }
            post({ type: 'download', loaded: a, total: b })
          }
        },
      })) as AutomaticSpeechRecognitionPipeline
      loaded = key
      return post({ type: 'ready' })
    }
    if (msg.type === 'transcribe') {
      if (!pipe) throw new Error('Model not loaded')
      const opts: Record<string, unknown> = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 }
      if (!msg.english) {
        opts.task = 'transcribe'
        if (msg.language) opts.language = msg.language
      }
      const out = (await pipe(msg.audio, opts)) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }
      const words = (out.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
      return post({ type: 'result', id: msg.id, words, text: out.text })
    }
  } catch (err) {
    post({ type: 'error', id: (msg as { id?: number }).id, message: (err as Error)?.message || String(err) })
  }
}
