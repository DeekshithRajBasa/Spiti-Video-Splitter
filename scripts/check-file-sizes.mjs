// Cloudflare Pages rejects files over 25 MiB. Remove the local copy of the WebGPU runtime
// (the Cloudflare build loads it from jsDelivr) and fail if anything else is too big.
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [dir = 'dist', mib = '25'] = process.argv.slice(2)
const limit = Number(mib) * 1024 * 1024
const tooBig = []
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (st.size > limit) {
      if (/ort-wasm-simd-threaded\.asyncify.*\.wasm$/.test(name)) {
        rmSync(p)
        console.log(`removed ${p} (${(st.size / 1048576).toFixed(1)} MiB, served from jsDelivr instead)`)
      } else tooBig.push(`${p} (${(st.size / 1048576).toFixed(1)} MiB)`)
    }
  }
}
walk(dir)
if (tooBig.length) {
  console.error(`Files over ${mib} MiB:\n  ${tooBig.join('\n  ')}`)
  process.exit(1)
}
console.log(`All files in ${dir} are under ${mib} MiB.`)
