'use strict'
// `npm run desktop:dev`: start Vite, then open Electron pointed at it.
const { spawn } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const port = 5173
const url = `http://localhost:${port}`
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)

const vite = spawn(bin('vite'), ['--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' })
let started = false
vite.stdout.on('data', (d) => {
  process.stdout.write(d)
  if (!started && d.toString().includes('Local')) {
    started = true
    const electron = spawn(require('electron'), ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } })
    electron.on('close', () => {
      vite.kill()
      process.exit(0)
    })
  }
})
