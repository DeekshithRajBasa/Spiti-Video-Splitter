'use strict'
// Desktop-only features: importing links (yt-dlp), live-stream recording, a streaming
// media:// protocol for downloaded files, 16 kHz audio for Whisper, CORS-free HTTP for
// AI providers, and API keys encrypted with the OS keychain.

const { app, dialog, ipcMain, net, protocol, safeStorage } = require('electron')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const DEBUG = !!process.env.SPITI_DEBUG
const log = (...a) => DEBUG && console.log('[features]', ...a)

/* ---------------- media:// protocol ---------------- */
// Downloaded files can be many GB, so the renderer streams them with range requests
// instead of loading them into memory. Only files we produced (or the user picked) are served.

const servable = new Set()
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.ts': 'video/mp2t', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
}

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ])
}

function mediaUrl(file) {
  servable.add(path.resolve(file))
  return `media://file/${encodeURIComponent(path.resolve(file))}`
}

function handleMediaProtocol() {
  protocol.handle('media', async (req) => {
    const file = decodeURIComponent(new URL(req.url).pathname.slice(1))
    if (!servable.has(path.resolve(file)) || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
    const size = fs.statSync(file).size
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' }
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
      const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1
      if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      const body = Readable.toWeb(fs.createReadStream(file, { start, end }))
      return new Response(body, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      })
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  })
}

/* ---------------- yt-dlp ---------------- */

const binDir = () => path.join(app.getPath('userData'), 'bin')
const ytPath = () => process.env.SPITI_YTDLP || path.join(binDir(), isWin ? 'yt-dlp.exe' : 'yt-dlp')
const ytAsset = () =>
  isWin ? 'yt-dlp.exe' : isMac ? 'yt-dlp_macos' : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
const RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

/**
 * YouTube needs a JavaScript runtime. yt-dlp prefers Deno when installed; otherwise the app
 * runs itself as Node (ELECTRON_RUN_AS_NODE), so it works on machines with neither.
 */
const jsRuntimeArgs = () => ['--js-runtimes', `node:${process.execPath}`]
const ytEnv = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1' })

function runYt(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(ytPath(), [...jsRuntimeArgs(), ...args], { maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: ytEnv(), ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(cleanErr(stderr) || err.message))
      else resolve(stdout)
    })
  })
}

function cleanErr(s) {
  const lines = String(s || '').split('\n').filter((l) => /ERROR|error/.test(l))
  return (lines.at(-1) || String(s || '').trim().split('\n').at(-1) || '').replace(/^ERROR:\s*/, '').trim()
}

let ensuring = null
/** Download the official yt-dlp build on first use and verify its SHA-256. */
function ensureYtdlp(onProgress) {
  if (fs.existsSync(ytPath())) return Promise.resolve(ytPath())
  if (ensuring) return ensuring
  ensuring = (async () => {
    fs.mkdirSync(binDir(), { recursive: true })
    const asset = ytAsset()
    const sums = await (await net.fetch(`${RELEASE}/SHA2-256SUMS`)).text()
    const expected = sums.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === asset)?.[0]
    if (!expected) throw new Error(`No checksum published for ${asset}`)
    const res = await net.fetch(`${RELEASE}/${asset}`)
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const total = Number(res.headers.get('content-length')) || 0
    const hash = crypto.createHash('sha256')
    const tmp = `${ytPath()}.download`
    const out = fs.createWriteStream(tmp)
    let got = 0
    for await (const chunk of res.body) {
      const b = Buffer.from(chunk)
      hash.update(b)
      out.write(b)
      got += b.length
      if (total) onProgress?.(got / total)
    }
    await new Promise((r) => out.end(r))
    if (hash.digest('hex') !== expected) {
      fs.rmSync(tmp, { force: true })
      throw new Error('yt-dlp download failed its checksum')
    }
    fs.chmodSync(tmp, 0o755)
    fs.renameSync(tmp, ytPath())
    fs.writeFileSync(path.join(binDir(), 'yt-dlp.updated'), String(Date.now()))
    return ytPath()
  })().finally(() => (ensuring = null))
  return ensuring
}

/** Sites change often; keep yt-dlp current (at most once a day, in the background). */
function maybeUpdate() {
  if (process.env.SPITI_YTDLP || !fs.existsSync(ytPath())) return
  const stamp = path.join(binDir(), 'yt-dlp.updated')
  const last = fs.existsSync(stamp) ? Number(fs.readFileSync(stamp, 'utf8')) : 0
  if (Date.now() - last < 24 * 3600 * 1000) return
  fs.writeFileSync(stamp, String(Date.now()))
  execFile(ytPath(), ['-U'], { windowsHide: true }, (e, out) => log('yt-dlp -U', e?.message || out))
}

async function linkInfo(url) {
  await ensureYtdlp()
  const out = await runYt(['-J', '--no-playlist', '--no-warnings', '--skip-download', url], { timeout: 90_000 })
  const j = JSON.parse(out)
  return {
    title: j.title || j.id || url,
    duration: j.duration || 0,
    isLive: j.is_live === true || j.live_status === 'is_live',
    wasLive: j.was_live === true || j.live_status === 'was_live' || j.live_status === 'post_live',
    site: j.extractor_key || j.extractor || 'Web',
    uploader: j.uploader || j.channel || '',
    thumbnail: j.thumbnail || '',
    url: j.webpage_url || url,
    height: j.height || 0,
  }
}

const jobs = new Map()
let jobSeq = 0
const downloadsDir = () => path.join(app.getPath('videos'), 'Spiti Downloads')

function killTree(p, signal) {
  if (!p || p.exitCode !== null) return
  try {
    if (isWin) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-p.pid, signal) // whole process group, so ffmpeg finalises too
  } catch {
    try {
      p.kill(signal)
    } catch {
      /* gone */
    }
  }
}

function newestMedia(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(mp4|mkv|webm|ts|m4a|mov|part)$/i.test(f) && !/\.f\d+\./.test(f))
    .map((f) => ({ f: path.join(dir, f), s: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.s - a.s)
  return files[0]?.f || null
}

/**
 * Download a link (VOD, clip, video on any yt-dlp site) or record a live stream.
 * opts: { url, maxHeight, start?, end?, live?: 'now' | 'start', maxMinutes? }
 */
function startDownload(sender, ffmpeg, opts) {
  const id = ++jobSeq
  const dir = path.join(downloadsDir(), `.job-${Date.now()}-${id}`)
  fs.mkdirSync(dir, { recursive: true })
  const h = Math.max(240, Math.min(4320, opts.maxHeight || 1080))
  const args = [
    '--newline', '--no-playlist', '--no-warnings', '--no-mtime',
    '-f', `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`,
    '--merge-output-format', 'mp4',
    '-o', path.join(dir, '%(title).80B [%(id)s].%(ext)s'),
    '--print', 'after_move:SVSFILE %(filepath)s',
    '--progress-template', 'download:SVSPROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._downloaded_bytes_str)s|%(progress.elapsed)s',
  ]
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg)
  if (opts.live) {
    args.push('--hls-use-mpegts', '--no-part')
    if (opts.live === 'start') args.push('--live-from-start')
  } else if (opts.start != null || opts.end != null) {
    args.push('--download-sections', `*${opts.start ?? 0}-${opts.end ?? 'inf'}`)
  }
  args.push(opts.url)
  log('yt-dlp', args.join(' '))

  const proc = spawn(ytPath(), [...jsRuntimeArgs(), ...args], { windowsHide: true, detached: !isWin, env: ytEnv() })
  const job = { id, proc, dir, stopped: false, final: null, err: '', live: !!opts.live, startedAt: Date.now() }
  jobs.set(id, job)
  const emit = (p) => !sender.isDestroyed() && sender.send('link:progress', { id, ...p })
  let buf = ''
  proc.stdout.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line.startsWith('SVSPROG ')) {
        const [pct, speed, eta, done, elapsed] = line.slice(8).split('|').map((s) => s.trim())
        const percent = parseFloat(pct)
        emit({ status: job.live ? 'recording' : 'downloading', percent: isFinite(percent) ? percent : null, speed, eta, downloaded: done, elapsed: Number(elapsed) || (Date.now() - job.startedAt) / 1000 })
      } else if (line.startsWith('SVSFILE ')) job.final = line.slice(8).trim()
      else if (/\[Merger\]|\[ExtractAudio\]|\[FixupM3u8\]/.test(line)) emit({ status: 'processing' })
    }
  })
  proc.stderr.on('data', (d) => {
    job.err = (job.err + d).slice(-4000)
    log(d.toString().trim())
  })
  if (opts.live && opts.maxMinutes) job.timer = setTimeout(() => stopDownload(id), opts.maxMinutes * 60_000)
  if (opts.live) {
    // ffmpeg does the live download, so report elapsed time and size ourselves.
    job.tick = setInterval(() => {
      let bytes = 0
      try {
        const f = newestMedia(dir)
        if (f) bytes = fs.statSync(f).size
      } catch {
        /* not created yet */
      }
      emit({ status: 'recording', percent: null, elapsed: (Date.now() - job.startedAt) / 1000, downloaded: `${(bytes / 1048576).toFixed(1)} MiB` })
    }, 1000)
  }

  job.done = new Promise((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', async (code) => {
      clearTimeout(job.timer)
      clearInterval(job.tick)
      jobs.delete(id)
      try {
        let file = job.final && fs.existsSync(job.final) ? job.final : null
        // A stopped live recording keeps what was captured; a stopped download is a cancel.
        if (!file && job.live) file = newestMedia(dir)
        if (!file) {
          fs.rmSync(dir, { recursive: true, force: true })
          return reject(new Error(job.stopped ? (job.live ? 'Stopped before anything was recorded' : 'Cancelled') : cleanErr(job.err) || `yt-dlp exited ${code}`))
        }
        // Live recordings are MPEG-TS; remux to a seekable MP4.
        let out = path.join(downloadsDir(), path.basename(file).replace(/\.(part|ts|mkv|webm|mp4)$/i, '') + '.mp4')
        if (fs.existsSync(out)) out = out.replace(/\.mp4$/, ` (${Date.now()}).mp4`)
        if (job.live || !/\.mp4$/i.test(file)) {
          emit({ status: 'processing' })
          await remux(ffmpeg, file, out)
        } else fs.renameSync(file, out)
        fs.rmSync(dir, { recursive: true, force: true })
        resolve(out)
      } catch (e) {
        reject(e)
      }
    })
  })
  return job
}

function remux(ffmpeg, input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-y', '-v', 'error', '-i', input, '-c', 'copy', '-movflags', '+faststart', output], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split('\n').at(-1) || 'remux failed'))))
    p.on('error', reject)
  })
}

function stopDownload(id) {
  const job = jobs.get(id)
  if (!job) return false
  job.stopped = true
  killTree(job.proc, 'SIGINT')
  // If yt-dlp ignores the interrupt, force it after a few seconds.
  setTimeout(() => killTree(job.proc, 'SIGKILL'), 6000)
  return true
}

/* ---------------- 16 kHz mono PCM for Whisper ---------------- */

function pcm(ffmpeg, { file, start, duration }) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-ss', String(start || 0)]
    if (duration) args.push('-t', String(duration))
    args.push('-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-')
    const p = spawn(ffmpeg, args, { windowsHide: true })
    const chunks = []
    let err = ''
    p.stdout.on('data', (d) => chunks.push(d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim().split('\n').at(-1) || 'audio extraction failed'))))
    p.on('error', reject)
  })
}

/* ---------------- HTTP for AI providers (no CORS in the main process) ---------------- */

async function httpRequest({ url, method = 'GET', headers = {}, body, timeoutMs = 600_000 }) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await net.fetch(url, { method, headers, body, signal: ctrl.signal })
    return { status: res.status, ok: res.ok, text: await res.text() }
  } catch (e) {
    return { status: 0, ok: false, text: String(e?.message || e) }
  } finally {
    clearTimeout(t)
  }
}

/* ---------------- secrets ---------------- */

const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json')
function readSecrets() {
  try {
    return JSON.parse(fs.readFileSync(secretsFile(), 'utf8'))
  } catch {
    return {}
  }
}
function getSecret(name) {
  const v = readSecrets()[name]
  if (!v) return ''
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString()
  } catch {
    return ''
  }
}
function setSecret(name, value) {
  const all = readSecrets()
  if (!value) delete all[name]
  else
    all[name] = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value)).toString('base64')
  fs.mkdirSync(path.dirname(secretsFile()), { recursive: true })
  fs.writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 })
}

/* ---------------- registration ---------------- */

/**
 * FFmpeg for network input (live HLS). The fully static Linux build crashes on network
 * streams, so on Linux prefer a system FFmpeg when one is installed.
 */
function networkFfmpeg(bundled) {
  if (process.env.SPITI_FFMPEG) return process.env.SPITI_FFMPEG
  if (process.platform === 'linux') {
    for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/snap/bin/ffmpeg']) if (fs.existsSync(p)) return p
  }
  return bundled
}

function register({ ffmpeg, getWindow, allowWriteDir }) {
  const netFfmpeg = networkFfmpeg(ffmpeg)
  handleMediaProtocol()
  setTimeout(maybeUpdate, 15_000)

  ipcMain.handle('link:ensure', async (e) => {
    await ensureYtdlp((p) => !e.sender.isDestroyed() && e.sender.send('link:progress', { id: 0, status: 'installing', percent: p * 100 }))
    try {
      return (await runYt(['--version'])).trim()
    } catch {
      return 'unknown'
    }
  })
  ipcMain.handle('link:info', (_e, url) => linkInfo(url))
  ipcMain.handle('link:download', async (e, opts) => {
    await ensureYtdlp()
    return startDownload(e.sender, netFfmpeg, opts).id
  })
  ipcMain.handle('link:wait', async (_e, id) => {
    const job = jobs.get(id)
    if (!job) throw new Error('Download not found')
    const file = await job.done
    return { file, url: mediaUrl(file), name: path.basename(file), size: fs.statSync(file).size }
  })
  ipcMain.handle('link:stop', (_e, id) => stopDownload(id))
  ipcMain.handle('media:url', (_e, file) => mediaUrl(file))
  ipcMain.handle('audio:pcm', (_e, opts) => pcm(ffmpeg, opts))
  ipcMain.handle('net:request', (_e, req) => httpRequest(req))
  ipcMain.handle('secret:get', (_e, name) => getSecret(name))
  ipcMain.handle('secret:set', (_e, name, value) => setSecret(name, value))
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('videos') })
    if (r.canceled || !r.filePaths[0]) return null
    allowWriteDir(r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('dialog:openMedia', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (r.canceled) return []
    return r.filePaths.map((f) => ({ file: f, url: mediaUrl(f), name: path.basename(f), size: fs.statSync(f).size }))
  })

  app.on('will-quit', () => {
    for (const id of jobs.keys()) stopDownload(id)
  })
}

module.exports = { registerSchemes, register }
