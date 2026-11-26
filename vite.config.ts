import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Production builds get a strict Content-Security-Policy (dev needs inline HMR scripts).
const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: media: https:; media-src 'self' blob: media:; font-src 'self' data:; connect-src 'self' blob: data: media: https: http://localhost:* http://127.0.0.1:*; worker-src 'self' blob:" />`,
    ),
})

export default defineConfig({
  // Relative asset paths so the desktop app can load dist/ from disk.
  base: './',
  plugins: [react(), csp()],
  worker: { format: 'es' },
  // transformers.js / ONNX Runtime load their own WebAssembly; don't pre-bundle them.
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
})
