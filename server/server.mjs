// Spiti link server: lets the web app import links from YouTube, Twitch, Kick and the other
// sites yt-dlp supports, which browsers can't download from directly. No dependencies.
//
//   GET    /health                 → { ok, ytdlp }
//   POST   /api/info   { url }     → title, duration, isLive, …
//   POST   /api/jobs   { url, maxHeight, start?, end?, live?, maxMinutes? } → { id }
//   GET    /api/jobs/:id           → status and progress
//   POST   /api/jobs/:id/stop      → stop a live recording (keeps what was recorded) or cancel
//   GET    /api/jobs/:id/file      → the finished MP4 (supports Range)
//   DELETE /api/jobs/:id           → delete the file now
//
// Configure with environment variables (see README "Link server").
import { execFile, spawn } from 'node:child_process'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const env = process.env
const PORT = Number(env.PORT || 8787)
const HOST = env.HOST || '0.0.0.0'
const TOKEN = env.ACCESS_TOKEN || ''
const ORIGINS = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean)
const MAX_MINUTES = Number(env.MAX_DURATION_MINUTES || 240)
const MAX_LIVE_MINUTES = Number(env.MAX_LIVE_MINUTES || 120)
const MAX_HEIGHT = Number(env.MAX_HEIGHT || 1080)
const MAX_JOBS = Number(env.MAX_CONCURRENT_JOBS || 2)
const TTL_MS = Number(env.FILE_TTL_MINUTES || 60) * 60_000
const YTDLP = env.YTDLP || 'yt-dlp'
const FFMPEG = env.FFMPEG || 'ffmpeg'
const COOKIES = env.COOKIES_FILE || ''
const DIR = env.DATA_DIR || path.join(os.tmpdir(), 'spiti-link-server')
fs.mkdirSync(DIR, { recursive: true })

const log = (...a) => console.log(new Date().toISOString(), ...a)

if (!TOKEN) log('WARNING: ACCESS_TOKEN is not set. Anyone who can reach this server can use it to download videos.')
if (ORIGINS.includes('*')) log('WARNING: ALLOWED_ORIGINS is "*". Set it to your web app origin, e.g. https://spiti.pages.dev')

/* ---------- yt-dlp ---------- */

const baseArgs = () => {
  // YouTube needs a JavaScript runtime; this server runs on Node, so offer it.
  const a = ['--js-runtimes', `node:${process.execPath}`, '--no-warnings', '--no-playlist']
  if (COOKIES && fs.existsSync(COOKIES)) a.push('--cookies', COOKIES)
  return a
}

function runYt(args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, [...baseArgs(), ...args], { maxBuffer: 64 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(cleanErr(stderr) || err.message))
      else resolve(stdout)
    })
  })
}

function cleanErr(s) {
  const lines = String(s || '').split('\n').filter((l) => /ERROR/.test(l))
  return (lines.at(-1) || String(s || '').trim().split('\n').at(-1) || '').replace(/^ERROR:\s*/, '').trim()
}

let ytVersion = 'unknown'
execFile(YTDLP, ['--version'], (e, out) => {
  ytVersion = e ? 'missing' : out.trim()
  log(`yt-dlp ${ytVersion}`)
})
// Sites change often: keep yt-dlp current.
const update = () => execFile(YTDLP, ['-U'], (e, out) => log('yt-dlp -U:', (e?.message || out).trim().split('\n').at(-1)))
setTimeout(update, 5_000)
setInterval(update, 24 * 3600_000).unref()

async function info(url) {
  const j = JSON.parse(await runYt(['-J', '--skip-download', url], 90_000))
  return {
    title: j.title || j.id || url,
    duration: j.duration || 0,
    isLive: j.is_live === true || j.live_status === 'is_live',
    wasLive: j.was_live === true || ['was_live', 'post_live'].includes(j.live_status),
    site: j.extractor_key || j.extractor || 'Web',
    uploader: j.uploader || j.channel || '',
    thumbnail: j.thumbnail || '',
    url: j.webpage_url || url,
    height: j.height || 0,
  }
}

/* ---------- jobs ---------- */

const jobs = new Map()
const running = () => [...jobs.values()].filter((j) => ['queued', 'downloading', 'recording', 'processing'].includes(j.status) && j.proc).length

function publicJob(j) {
  const { id, status, percent, speed, eta, downloaded, elapsed, error, name, size } = j
  return { id, status, percent, speed, eta, downloaded, elapsed: j.live && j.startedAt ? (Date.now() - j.startedAt) / 1000 : elapsed, error, name, size }
}

function newestMedia(dir) {
  return (
    fs
      .readdirSync(dir)
      .filter((f) => /\.(mp4|mkv|webm|ts|m4a|mov|part)$/i.test(f) && !/\.f\d+\./.test(f))
      .map((f) => ({ f: path.join(dir, f), s: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => b.s - a.s)[0]?.f || null
  )
}

function remux(input, output) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-y', '-v', 'error', '-i', input, '-c', 'copy', '-movflags', '+faststart', output])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split('\n').at(-1) || 'remux failed'))))
    p.on('error', reject)
  })
}

async function startJob(body) {
  const url = String(body.url || '').trim()
  if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error('A http(s) link is required'), { status: 400 })
  if (running() >= MAX_JOBS) throw Object.assign(new Error('The server is busy. Try again in a minute.'), { status: 429 })
  const h = Math.max(240, Math.min(MAX_HEIGHT, Number(body.maxHeight) || 1080))
  const live = body.live === 'now' || body.live === 'start' ? body.live : null
  const start = Number.isFinite(body.start) ? Math.max(0, body.start) : null
  const end = Number.isFinite(body.end) ? body.end : null
  const id = randomUUID()
  const dir = path.join(DIR, id)
  fs.mkdirSync(dir)
  const job = { id, dir, url, status: 'queued', percent: null, live: !!live, createdAt: Date.now() }
  jobs.set(id, job)

  // Refuse very long downloads unless only a section is requested.
  if (!live && start == null && end == null) {
    try {
      const i = await info(url)
      if (i.isLive) job.live = true
      else if (i.duration > MAX_MINUTES * 60) {
        job.status = 'error'
        job.error = `This video is longer than ${MAX_MINUTES} minutes. Choose a From/To range.`
        return job
      }
    } catch (e) {
      job.status = 'error'
      job.error = e.message
      return job
    }
  }

  const args = [
    '--newline', '--no-mtime', '--ffmpeg-location', FFMPEG,
    '-f', `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`,
    '--merge-output-format', 'mp4',
    '-o', path.join(dir, '%(title).80B [%(id)s].%(ext)s'),
    '--print', 'after_move:SVSFILE %(filepath)s',
    '--progress-template', 'download:SVSPROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._downloaded_bytes_str)s',
  ]
  if (job.live) {
    args.push('--hls-use-mpegts', '--no-part')
    if (live === 'start') args.push('--live-from-start')
  } else if (start != null || end != null) args.push('--download-sections', `*${start ?? 0}-${end ?? 'inf'}`)
  args.push(url)

  const proc = spawn(YTDLP, [...baseArgs(), ...args], { detached: true })
  job.proc = proc
  job.status = job.live ? 'recording' : 'downloading'
  job.startedAt = Date.now()
  const limitMin = job.live ? Math.min(MAX_LIVE_MINUTES, Number(body.maxMinutes) || MAX_LIVE_MINUTES) : 0
  if (limitMin) job.timer = setTimeout(() => stopJob(job), limitMin * 60_000)
  if (job.live)
    job.tick = setInterval(() => {
      try {
        const f = newestMedia(dir)
        if (f) job.downloaded = `${(fs.statSync(f).size / 1048576).toFixed(1)} MiB`
      } catch {
        /* not created yet */
      }
    }, 1000)
  let buf = ''
  let err = ''
  proc.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line.startsWith('SVSPROG ')) {
        const [pct, speed, eta, done] = line.slice(8).split('|').map((s) => s.trim())
        const p = parseFloat(pct)
        Object.assign(job, { percent: Number.isFinite(p) ? p : null, speed, eta, downloaded: done })
      } else if (line.startsWith('SVSFILE ')) job.final = line.slice(8).trim()
      else if (/\[Merger\]|\[FixupM3u8\]/.test(line) && !job.live) job.status = 'processing'
    }
  })
  proc.stderr.on('data', (d) => (err = (err + d).slice(-4000)))
  proc.on('close', async (code) => {
    clearTimeout(job.timer)
    clearInterval(job.tick)
    job.proc = null
    try {
      let file = job.final && fs.existsSync(job.final) ? job.final : null
      if (!file && job.live) file = newestMedia(dir)
      if (!file) throw new Error(job.stopped ? (job.live ? 'Stopped before anything was recorded' : 'Cancelled') : cleanErr(err) || `yt-dlp exited ${code}`)
      if (job.live || !/\.mp4$/i.test(file)) {
        job.status = 'processing'
        const out = path.join(dir, `${path.basename(file).replace(/\.(part|ts|mkv|webm|mp4)$/i, '')}.remux.mp4`)
        await remux(file, out)
        fs.rmSync(file, { force: true })
        file = out
      }
      job.file = file
      job.name = path.basename(file).replace(/\.remux\.mp4$/, '.mp4')
      job.size = fs.statSync(file).size
      job.status = 'done'
      job.percent = 100
      log(`job ${id} done: ${job.name} (${(job.size / 1048576).toFixed(1)} MiB)`)
    } catch (e) {
      job.status = 'error'
      job.error = e.message
      log(`job ${id} failed: ${e.message}`)
    }
  })
  log(`job ${id} started: ${url}${job.live ? ' (live)' : ''}`)
  return job
}

function stopJob(job) {
  if (!job.proc) return
  job.stopped = true
  try {
    process.kill(-job.proc.pid, 'SIGINT')
  } catch {
    job.proc.kill('SIGINT')
  }
  setTimeout(() => {
    try {
      if (job.proc) process.kill(-job.proc.pid, 'SIGKILL')
    } catch {
      /* gone */
    }
  }, 6000)
}

function removeJob(job) {
  stopJob(job)
  fs.rmSync(job.dir, { recursive: true, force: true })
  jobs.delete(job.id)
}

// Delete finished files after FILE_TTL_MINUTES.
setInterval(() => {
  for (const j of jobs.values()) if (!j.proc && Date.now() - j.createdAt > TTL_MS) removeJob(j)
}, 60_000).unref()

/* ---------- http ---------- */

function cors(req, res) {
  const origin = req.headers.origin
  const allow = ORIGINS.includes('*') ? '*' : origin && ORIGINS.includes(origin) ? origin : ''
  if (allow) res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Disposition')
  // The web app is cross-origin isolated (COEP), so responses must opt in.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  return !!allow || !origin
}

function authorized(req) {
  if (!TOKEN) return true
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  const want = Buffer.from(TOKEN)
  return got.length === want.length && timingSafeEqual(got, want)
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (d) => {
      b += d
      if (b.length > 64 * 1024) reject(new Error('Body too large'))
    })
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {})
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }))
      }
    })
  })
}

function sendFile(req, res, job) {
  const size = fs.statSync(job.file).size
  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.name)}`,
  }
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    fs.createReadStream(job.file, { start, end }).pipe(res)
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size })
    fs.createReadStream(job.file).pipe(res)
  }
}

http
  .createServer(async (req, res) => {
    const okOrigin = cors(req, res)
    if (req.method === 'OPTIONS') return res.writeHead(204).end()
    if (!okOrigin) return send(res, 403, { error: 'This website is not allowed to use this link server (ALLOWED_ORIGINS).' })
    const { pathname } = new URL(req.url, 'http://x')
    try {
      if (pathname === '/health') return send(res, 200, { ok: true, ytdlp: ytVersion })
      if (!authorized(req)) return send(res, 401, { error: 'Missing or wrong access token' })
      if (pathname === '/api/info' && req.method === 'POST') return send(res, 200, await info(String((await readBody(req)).url || '')))
      if (pathname === '/api/jobs' && req.method === 'POST') return send(res, 200, publicJob(await startJob(await readBody(req))))
      const m = /^\/api\/jobs\/([0-9a-f-]{36})(\/stop|\/file)?$/.exec(pathname)
      const job = m && jobs.get(m[1])
      if (m && !job) return send(res, 404, { error: 'Job not found (it may have expired)' })
      if (job && !m[2] && req.method === 'GET') return send(res, 200, publicJob(job))
      if (job && m[2] === '/stop' && req.method === 'POST') {
        stopJob(job)
        return send(res, 200, publicJob(job))
      }
      if (job && m[2] === '/file' && req.method === 'GET') {
        if (job.status !== 'done') return send(res, 409, { error: `Not ready (${job.status})` })
        return sendFile(req, res, job)
      }
      if (job && !m[2] && req.method === 'DELETE') {
        removeJob(job)
        return send(res, 200, { ok: true })
      }
      send(res, 404, { error: 'Not found' })
    } catch (e) {
      send(res, e.status || 500, { error: e.message })
    }
  })
  .listen(PORT, HOST, () => log(`Spiti link server on http://${HOST}:${PORT} (data: ${DIR})`))
