'use strict'
// Electron main process: window, menus, and the native side of fast export
// (FFmpeg frame decoding, file writing and the final audio mix / mux).

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const features = require('./features.cjs')

const isMac = process.platform === 'darwin'
const DEV_URL = process.env.VITE_DEV_SERVER_URL

/* ---------------- ffmpeg ---------------- */

function ffmpegPath() {
  try {
    let p = require('ffmpeg-static')
    if (!p) return null
    // Inside a packaged app the binary is unpacked next to the asar archive.
    p = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    return fs.existsSync(p) ? p : null
  } catch {
    return null
  }
}
const FFMPEG = ffmpegPath()

const DEBUG = !!process.env.SPITI_DEBUG
const log = (...a) => DEBUG && console.log('[main]', ...a)

function run(args, onStderr) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('FFmpeg is not available'))
    const t0 = Date.now()
    log('ffmpeg', args.join(' '))
    const p = spawn(FFMPEG, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => {
      const s = d.toString()
      err = (err + s).slice(-8000)
      onStderr?.(s)
    })
    p.on('error', reject)
    p.on('close', (code) => log(`ffmpeg exited ${code} after ${Date.now() - t0}ms`))
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim().split('\n').slice(-4).join('\n') || `ffmpeg exited ${code}`))))
  })
}

/** Does this file have an audio stream? (ffmpeg -i always "fails", so read stderr.) */
function probe(file) {
  return new Promise((resolve) => {
    if (!FFMPEG) return resolve({ hasAudio: false })
    const p = spawn(FFMPEG, ['-hide_banner', '-i', file], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d.toString()))
    p.on('close', () => resolve({ hasAudio: /Stream #.*Audio:/.test(err) }))
    p.on('error', () => resolve({ hasAudio: false }))
  })
}

/* ---------------- frame decoder ---------------- */
// Streams JPEG frames from ffmpeg at exactly the export frame rate. The renderer
// pulls frames one by one; we pause ffmpeg when too many are buffered.

const decoders = new Map()
let seq = 0
const HIGH_WATER = 24

function startDecoder({ file, start, duration, fps, maxHeight }) {
  if (!FFMPEG) throw new Error('FFmpeg is not available')
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`)
  const id = ++seq
  const args = [
    '-v', 'error',
    '-hwaccel', 'auto',
    '-ss', String(Math.max(0, start)),
    '-t', String(Math.max(0.01, duration)),
    '-i', file,
    '-an', '-sn',
    '-vf', `fps=${fps},scale=-2:'min(ih,${maxHeight})'`,
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3',
    '-',
  ]
  const proc = spawn(FFMPEG, args, { windowsHide: true })
  const st = { proc, queue: [], buf: Buffer.alloc(0), scan: 0, ended: false, waiters: [], err: '' }
  const flush = () => {
    while (st.waiters.length && (st.queue.length || st.ended)) st.waiters.shift()(st.queue.shift() ?? null)
  }
  proc.stdout.on('data', (chunk) => {
    st.buf = st.buf.length ? Buffer.concat([st.buf, chunk]) : chunk
    // JPEG frames end with FF D9; inside entropy-coded data 0xFF is always stuffed.
    for (;;) {
      const end = st.buf.indexOf(0xd9, Math.max(1, st.scan))
      if (end < 0) {
        st.scan = st.buf.length
        break
      }
      if (st.buf[end - 1] === 0xff) {
        st.queue.push(Buffer.from(st.buf.subarray(0, end + 1)))
        st.buf = st.buf.subarray(end + 1)
        st.scan = 0
      } else st.scan = end + 1
    }
    if (st.queue.length > HIGH_WATER) proc.stdout.pause()
    flush()
  })
  proc.stderr.on('data', (d) => (st.err = (st.err + d).slice(-4000)))
  proc.on('close', () => {
    st.ended = true
    flush()
  })
  proc.on('error', (e) => {
    st.err += String(e)
    st.ended = true
    flush()
  })
  decoders.set(id, st)
  return id
}

function nextFrame(id) {
  const st = decoders.get(id)
  if (!st) return Promise.resolve(null)
  const frame = st.queue.shift()
  if (st.queue.length < HIGH_WATER / 2 && st.proc.stdout.isPaused()) st.proc.stdout.resume()
  if (frame) return Promise.resolve(frame)
  if (st.ended) return Promise.resolve(null)
  return new Promise((r) => st.waiters.push(r))
}

function stopDecoder(id) {
  const st = decoders.get(id)
  if (!st) return
  decoders.delete(id)
  try {
    st.proc.kill()
  } catch {
    /* already gone */
  }
}

/* ---------------- output files ---------------- */
// The renderer may only write to paths the user picked in a save dialog or to our temp dir.

const writable = new Set()
const writableDirs = new Set()
const handles = new Map()
const tmpDir = path.join(os.tmpdir(), 'spiti-video-splitter')

function allowed(file) {
  const abs = path.resolve(file)
  return writable.has(abs) || abs.startsWith(tmpDir + path.sep) || [...writableDirs].some((d) => abs.startsWith(d + path.sep))
}

/* ---------------- final mix + mux ---------------- */

async function mux(job, onProgress) {
  const t0 = Date.now()
  const D = job.duration
  const args = ['-y', '-hide_banner', '-i', job.video]
  const filters = []
  const mixes = []
  let input = 1

  if (job.voice && job.voice.segments.length) {
    const { hasAudio } = await probe(job.voice.file)
    if (hasAudio) {
      args.push('-i', job.voice.file)
      const parts = job.voice.segments.map((s, i) => {
        filters.push(`[${input}:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[vs${i}]`)
        return `[vs${i}]`
      })
      filters.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1,volume=${job.voice.volume}[voice]`)
      mixes.push('[voice]')
      input++
    }
  }
  if (job.music) {
    const { hasAudio } = await probe(job.music.file)
    if (hasAudio) {
      const m = job.music
      args.push('-i', m.file)
      const r = Math.min(m.riser, D)
      const vol =
        r > 0
          ? `volume='if(lt(t,${D - r}),${m.volume},${m.volume}+(${m.peak}-${m.volume})*pow((t-${D - r})/${r},2))':eval=frame`
          : `volume=${m.volume}`
      filters.push(`[${input}:a]atrim=start=${m.offset},asetpts=PTS-STARTPTS,atrim=end=${D},${vol}[music]`)
      mixes.push('[music]')
      input++
    }
  }
  for (const [i, s] of (job.sfx || []).entries()) {
    args.push('-i', s.file)
    const ms = Math.round(s.at * 1000)
    filters.push(`[${input}:a]adelay=delays=${ms}:all=1,volume=${s.volume}[fx${i}]`)
    mixes.push(`[fx${i}]`)
    input++
  }

  if (mixes.length) {
    filters.push(`${mixes.join('')}amix=inputs=${mixes.length}:duration=longest:normalize=0,apad,atrim=end=${D}[aout]`)
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k')
  } else {
    args.push('-map', '0:v')
  }
  if (job.reencode) args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p')
  else args.push('-c:v', 'copy')
  args.push('-t', String(D), '-movflags', '+faststart', job.output)

  log(`mux prepared in ${Date.now() - t0}ms`)
  await run(args, (s) => {
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
    if (m && D > 0) onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / D))
  })
}

/* ---------------- window ---------------- */

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: 'Spiti Video Splitter',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0e' : '#ececee',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 20 },
    titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: '#55555f', height: 62 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return
    e.preventDefault()
  })
  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

function send(cmd) {
  win?.webContents.send('menu', cmd)
}

function buildMenu() {
  const mod = isMac ? 'Cmd' : 'Ctrl'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Import Media…', accelerator: `${mod}+O`, click: () => send('import') },
        { type: 'separator' },
        { label: 'Export Video…', accelerator: `${mod}+E`, click: () => send('export') },
        { label: 'Save Frame as PNG…', accelerator: `${mod}+Shift+S`, click: () => send('snapshot') },
        { type: 'separator' },
        { label: 'New Project', accelerator: `${mod}+N`, click: () => send('new') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: `${mod}+Z`, click: () => send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Split at Playhead', accelerator: `${mod}+B`, click: () => send('split') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Light / Dark', accelerator: 'Shift+L', registerAccelerator: false, click: () => send('theme') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Keyboard Shortcuts', accelerator: 'Shift+/', registerAccelerator: false, click: () => send('help') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* ---------------- IPC ---------------- */

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    version: app.getVersion(),
    ffmpeg: !!FFMPEG,
  }))
  ipcMain.handle('dialog:save', async (_e, name, ext) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('videos'), name),
      filters: [{ name: ext === 'png' ? 'PNG image' : 'Video', extensions: [ext] }],
    })
    if (r.canceled || !r.filePath) return null
    const abs = path.resolve(r.filePath)
    writable.add(abs)
    return abs
  })
  ipcMain.handle('tmp:path', (_e, ext) => {
    fs.mkdirSync(tmpDir, { recursive: true })
    return path.join(tmpDir, `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  })
  ipcMain.handle('file:open', (_e, file) => {
    if (!allowed(file)) throw new Error('Not allowed to write there')
    const fd = fs.openSync(file, 'w')
    const id = ++seq
    handles.set(id, fd)
    return id
  })
  ipcMain.handle('file:write', (_e, id, position, data) => {
    const fd = handles.get(id)
    if (fd === undefined) throw new Error('File is closed')
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    fs.writeSync(fd, buf, 0, buf.length, position)
  })
  ipcMain.handle('file:close', (_e, id) => {
    const fd = handles.get(id)
    if (fd !== undefined) fs.closeSync(fd)
    handles.delete(id)
  })
  ipcMain.handle('file:remove', (_e, file) => {
    if (allowed(file) && path.resolve(file).startsWith(tmpDir)) fs.rmSync(file, { force: true })
  })
  ipcMain.handle('decode:start', (_e, opts) => startDecoder(opts))
  ipcMain.handle('decode:next', (_e, id) => nextFrame(id))
  ipcMain.handle('decode:stop', (_e, id) => stopDecoder(id))
  ipcMain.handle('mux', async (e, job) => {
    if (!allowed(job.output) || !allowed(job.video)) throw new Error('Not allowed to write there')
    await mux(job, (p) => e.sender.send('mux:progress', p))
  })
  ipcMain.handle('shell:reveal', (_e, file) => shell.showItemInFolder(file))
  ipcMain.handle('titlebar:theme', (_e, dark) => {
    if (!win || isMac) return
    try {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#b4b4be' : '#55555f', height: 62 })
    } catch {
      /* not supported */
    }
  })
}

// Must run before the app is ready.
features.registerSchemes()

/* ---------------- spiti:// links ----------------
 * The web app hands links to the desktop app with spiti://clip?url=<video link>.
 * The renderer takes pending links once it's ready, so cold starts work too.
 */
const pendingLinks = []
function handleDeepLink(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'spiti:') return
    const link = u.searchParams.get('url')
    if (!link || !/^https?:\/\//i.test(link)) return
    pendingLinks.push(link)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      win.webContents.send('deeplink')
    }
  } catch {
    /* malformed link */
  }
}
const linkFromArgv = (argv) => argv.find((a) => a.startsWith('spiti://'))

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    const l = linkFromArgv(argv)
    if (l) handleDeepLink(l)
    else if (win) win.focus()
  })
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  handleDeepLink(url)
})
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('spiti', process.execPath, [path.resolve(process.argv[1])])
else app.setAsDefaultProtocolClient('spiti')
{
  const l = linkFromArgv(process.argv)
  if (l) handleDeepLink(l)
}
ipcMain.handle('deeplink:take', () => pendingLinks.splice(0))
// Multi-threaded WebAssembly makes on-device Whisper several times faster.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')

app.whenReady().then(() => {
  registerIpc()
  features.register({ ffmpeg: FFMPEG, getWindow: () => win, allowWriteDir: (d) => writableDirs.add(path.resolve(d)) })
  buildMenu()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  for (const id of decoders.keys()) stopDecoder(id)
  if (!isMac) app.quit()
})

app.on('will-quit', () => fs.rmSync(tmpDir, { recursive: true, force: true }))

