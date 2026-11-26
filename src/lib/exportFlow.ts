import { store } from '../store'
import { desktop } from './desktop'
import { engine } from './engine'
import { canFastExport, ExportCancelled, fastExport } from './fastExport'
import { download } from './media'

async function writeBlob(path: string, blob: Blob) {
  const d = desktop!
  const id = await d.openFile(path)
  try {
    const buf = new Uint8Array(await blob.arrayBuffer())
    const CH = 8 * 1024 * 1024
    for (let i = 0; i < buf.length; i += CH) await d.write(id, i, buf.subarray(i, i + CH))
  } finally {
    await d.closeFile(id)
  }
}

let running = false

/** Export the current project: desktop fast path when possible, real-time recording otherwise. */
export async function runExport() {
  if (running) return
  const p = store.get().project
  if (!p.slots[0].sourceId) return
  running = true
  store.ui({ lastExport: null })
  try {
    if (desktop) {
      const fast = p.export.mode === 'fast' && canFastExport().ok
      if (fast) {
        const path = await desktop.saveDialog(`${p.name}.mp4`, 'mp4')
        if (!path) return
        engine.pause()
        store.ui({ exporting: { progress: 0, status: 'Starting' } })
        await fastExport(path, (progress, status) => store.ui({ exporting: { progress, status } }))
        store.ui({ exporting: null, lastExport: path })
        return
      }
      const r = await engine.export()
      if (!r) return
      const path = await desktop.saveDialog(`${p.name}.${r.ext}`, r.ext)
      if (!path) return
      await writeBlob(path, r.blob)
      store.ui({ lastExport: path })
      return
    }
    const r = await engine.export()
    if (r) download(r.blob, `${p.name}.${r.ext}`)
  } catch (err) {
    if (!(err instanceof ExportCancelled)) alert(`Export failed: ${(err as Error).message}`)
  } finally {
    store.ui({ exporting: null })
    running = false
  }
}

export async function saveSnapshot() {
  const p = store.get().project
  if (!p.slots[0].sourceId) return
  const b = await engine.snapshot()
  if (!b) return
  if (desktop) {
    const path = await desktop.saveDialog(`${p.name}-frame.png`, 'png')
    if (path) await writeBlob(path, b)
  } else download(b, `${p.name}-frame.png`)
}
