'use strict'
// In-app updates.
//  - Windows / Linux: electron-updater (checksum-verified, differential downloads).
//  - macOS: electron-updater can't install updates for apps without an Apple Developer ID
//    signature, so this downloads the release zip itself, verifies its SHA-256 and swaps the
//    .app in place after quitting (rolling back if anything fails).
// Updates come from the GitHub releases named in app-update.yml (electron-builder writes it
// from the `publish` block). For a private repo, a read-only token can be saved in Settings.

const { app, BrowserWindow, ipcMain, net } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const features = require('./features.cjs')
const { cleanNotes, compareVersions, macApplyScript, parseDigest, pickMacAsset } = require('./update-utils.cjs')

// SPITI_TEST_MAC / SPITI_DITTO let the macOS path be exercised in tests on other systems.
const isMac = process.platform === 'darwin' || process.env.SPITI_TEST_MAC === '1'
const DITTO = process.env.SPITI_DITTO || '/usr/bin/ditto'
const TOKEN_KEY = 'github.updateToken'
const API = process.env.SPITI_GITHUB_API || 'https://api.github.com'
const CHECK_EVERY_MS = 6 * 3600_000
const DEBUG = !!process.env.SPITI_DEBUG
const log = (...a) => DEBUG && console.log('[updater]', ...a)

let settings = { autoDownload: true }
let state = {
  supported: true,
  reason: '',
  platform: process.platform,
  current: '',
  status: 'idle', // idle | checking | available | downloading | ready | none | error
  version: '',
  notes: '',
  url: '',
  percent: 0,
  speed: 0,
  transferred: 0,
  total: 0,
  error: '',
  needsToken: false,
  hasToken: false,
  manualInstall: false,
  lastChecked: 0,
  autoDownload: true,
}

function setState(patch) {
  state = { ...state, ...patch }
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:state', state)
}

/* ---------------- config ---------------- */

const settingsFile = () => path.join(app.getPath('userData'), 'update-settings.json')
function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    /* defaults */
  }
}
const saveSettings = () => {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings))
  } catch {
    /* read-only profile */
  }
}

/** owner/repo from the app-update.yml that electron-builder embeds (or package.json when unpackaged). */
function repoInfo() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const owner = /^owner:\s*(\S+)/m.exec(yml)?.[1]
    const repo = /^repo:\s*(\S+)/m.exec(yml)?.[1]
    if (owner && repo) return { owner, repo }
  } catch {
    /* unpackaged */
  }
  try {
    const url = require('../package.json').repository?.url || ''
    const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url)
    if (m) return { owner: m[1], repo: m[2] }
  } catch {
    /* ignore */
  }
  return null
}

const token = () => (process.env.SPITI_UPDATE_TOKEN || features.getSecret(TOKEN_KEY) || '').trim()
const releasePage = (v) => {
  const r = repoInfo()
  return r ? `https://github.com/${r.owner}/${r.repo}/releases/tag/v${v}` : ''
}

function friendly(err) {
  const msg = String(err?.message || err || '')
  if (/404|Not Found|Cannot find latest|No published versions|Unable to find latest/i.test(msg))
    return token() ? 'No release found. Check the token can read this repository.' : 'Releases are private or missing. Add a read-only GitHub token in Settings → Updates.'
  if (/401|403|Bad credentials|rate limit/i.test(msg)) return /rate limit/i.test(msg) ? 'GitHub is rate-limiting update checks. Try again in a while.' : 'The GitHub token was rejected. Check it in Settings → Updates.'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ERR_INTERNET|ERR_NETWORK|net::|fetch failed/i.test(msg)) return "Couldn't reach the update server. Check your internet connection."
  return msg.split('\n')[0].slice(0, 240)
}
const needsToken = (err) => !token() && /404|Not Found|Cannot find latest|No published versions|Unable to find latest/i.test(String(err?.message || err || ''))

/* ---------------- Windows / Linux (electron-updater) ---------------- */

let au = null
function setupNative() {
  const { autoUpdater } = require('electron-updater')
  au = autoUpdater
  au.autoDownload = settings.autoDownload
  au.autoInstallOnAppQuit = true
  au.allowPrerelease = false
  au.logger = DEBUG ? console : null
  const feed = process.env.SPITI_UPDATE_URL
  if (feed) {
    // Testing / self-hosted updates: any static folder with latest*.yml.
    au.forceDevUpdateConfig = true
    au.setFeedURL({ provider: 'generic', url: feed })
  } else if (token()) {
    const r = repoInfo()
    if (r) au.setFeedURL({ provider: 'github', owner: r.owner, repo: r.repo, private: true, token: token() })
  }
  au.on('checking-for-update', () => setState({ status: 'checking', error: '', needsToken: false }))
  au.on('update-available', (info) =>
    setState({ status: settings.autoDownload ? 'downloading' : 'available', version: info.version, notes: cleanNotes(info.releaseNotes), url: releasePage(info.version), percent: 0, error: '', lastChecked: Date.now() }),
  )
  au.on('update-not-available', () => setState({ status: 'none', error: '', lastChecked: Date.now() }))
  au.on('download-progress', (p) => setState({ status: 'downloading', percent: p.percent, speed: p.bytesPerSecond, transferred: p.transferred, total: p.total }))
  au.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version, percent: 100, speed: 0, lastChecked: Date.now() }))
  au.on('error', (e) => setState({ status: 'error', error: friendly(e), needsToken: needsToken(e), lastChecked: Date.now() }))
}

/* ---------------- macOS (download + swap) ---------------- */

const updatesDir = () => path.join(app.getPath('userData'), 'updates')
let mac = { asset: null, staged: null, applying: false, abort: null }

async function ghFetch(url, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'User-Agent': `SpitiVideoSplitter/${app.getVersion()}` }
  if (token()) headers.Authorization = `Bearer ${token()}`
  return net.fetch(url, { headers })
}

async function macCheck() {
  const r = repoInfo()
  if (!r) throw new Error('No update source is configured')
  const res = await ghFetch(`${API}/repos/${r.owner}/${r.repo}/releases/latest`)
  if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`)
  if (!res.ok) throw new Error(`GitHub replied ${res.status}`)
  const rel = await res.json()
  const version = String(rel.tag_name || '').replace(/^v/, '')
  if (compareVersions(version, app.getVersion()) <= 0) return null
  const asset = pickMacAsset(rel.assets, process.arch)
  if (!asset) throw new Error(`Release ${version} has no macOS ${process.arch} update file`)
  return { version, asset, notes: cleanNotes(rel.body), url: rel.html_url || releasePage(version) }
}

/** The running .app, if we're allowed to replace it (not on a mounted DMG / translocated / read-only). */
function replaceableAppPath() {
  const appPath = path.resolve(process.execPath, '..', '..', '..')
  if (!appPath.endsWith('.app') || /^\/Volumes\//.test(appPath) || appPath.includes('/AppTranslocation/')) return null
  try {
    fs.accessSync(path.dirname(appPath), fs.constants.W_OK)
    return appPath
  } catch {
    return null
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split('\n').at(-1) || `${cmd} exited ${c}`))))
  })
}

async function macDownload() {
  const { asset, version } = mac
  const dir = updatesDir()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const zip = path.join(dir, asset.name)
  setState({ status: 'downloading', percent: 0, error: '' })
  const ctrl = new AbortController()
  mac.abort = ctrl
  // The API asset URL + octet-stream works for public and private repos alike.
  const headers = { Accept: 'application/octet-stream', 'User-Agent': `SpitiVideoSplitter/${app.getVersion()}` }
  if (token()) headers.Authorization = `Bearer ${token()}`
  const res = await net.fetch(token() ? asset.url : asset.browser_download_url || asset.url, { headers, signal: ctrl.signal })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || asset.size || 0
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(zip)
  let got = 0
  let last = Date.now()
  let lastBytes = 0
  for await (const chunk of res.body) {
    const b = Buffer.from(chunk)
    hash.update(b)
    if (!out.write(b)) await new Promise((r) => out.once('drain', r))
    got += b.length
    const now = Date.now()
    if (now - last > 400) {
      setState({ percent: total ? (got / total) * 100 : 0, transferred: got, total, speed: ((got - lastBytes) / (now - last)) * 1000 })
      last = now
      lastBytes = got
    }
  }
  await new Promise((r) => out.end(r))
  const want = parseDigest(asset.digest)
  if (want && hash.digest('hex') !== want) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error('The downloaded update failed its checksum, so it was discarded.')
  }
  setState({ percent: 100, speed: 0 })
  const stage = path.join(dir, `stage-${version}`)
  fs.mkdirSync(stage)
  await run(DITTO, ['-x', '-k', zip, stage])
  fs.rmSync(zip, { force: true })
  const appDir = fs.readdirSync(stage).find((f) => f.endsWith('.app'))
  if (!appDir) throw new Error('The update file did not contain an app.')
  mac.staged = path.join(stage, appDir)
  setState({ status: 'ready', version })
}

function launchApply(relaunch) {
  const target = replaceableAppPath()
  if (!mac.staged || !target || mac.applying) return false
  mac.applying = true
  const script = path.join(updatesDir(), 'apply.sh')
  fs.writeFileSync(script, macApplyScript(), { mode: 0o755 })
  spawn('/bin/sh', [script, target, mac.staged, String(process.pid), relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref()
  return true
}

/* ---------------- public actions ---------------- */

async function check(manual = false) {
  if (!state.supported) return state
  if (['checking', 'downloading'].includes(state.status) || (state.status === 'ready' && !manual)) return state
  state.hasToken = !!token()
  try {
    if (isMac) {
      setState({ status: 'checking', error: '', needsToken: false, hasToken: !!token() })
      const found = await macCheck()
      if (!found) return setState({ status: 'none', lastChecked: Date.now() }), state
      mac = { ...mac, asset: found.asset, version: found.version, staged: null }
      const manualInstall = !replaceableAppPath()
      setState({ status: 'available', version: found.version, notes: found.notes, url: found.url, manualInstall, lastChecked: Date.now() })
      if (settings.autoDownload && !manualInstall) void download()
    } else {
      setState({ hasToken: !!token() })
      if (token() && !process.env.SPITI_UPDATE_URL) {
        const r = repoInfo()
        if (r) au.setFeedURL({ provider: 'github', owner: r.owner, repo: r.repo, private: true, token: token() })
      }
      await au.checkForUpdates()
    }
  } catch (e) {
    setState({ status: 'error', error: friendly(e), needsToken: needsToken(e), hasToken: !!token(), lastChecked: Date.now() })
  }
  return state
}

async function download() {
  if (!['available', 'error'].includes(state.status) && !(state.status === 'downloading' && isMac)) return state
  try {
    if (isMac) {
      if (!mac.asset) return state
      await macDownload()
    } else {
      setState({ status: 'downloading', percent: 0, error: '' })
      await au.downloadUpdate()
    }
  } catch (e) {
    if (e?.name === 'AbortError') return state
    setState({ status: 'error', error: friendly(e) })
  }
  return state
}

function install() {
  if (state.status !== 'ready') return false
  if (isMac) {
    if (!launchApply(true)) {
      setState({ status: 'error', error: 'Could not replace the app. Move it to your Applications folder, or download the update manually.', manualInstall: true })
      return false
    }
    app.quit()
    return true
  }
  // Silent install, then start the new version.
  au.quitAndInstall(true, true)
  return true
}

function register({ getWindow }) {
  void getWindow
  loadSettings()
  state = { ...state, current: app.getVersion(), autoDownload: settings.autoDownload, hasToken: !!token() }

  if (process.env.SPITI_NO_UPDATE) setState({ supported: false, reason: 'Updates are turned off.' })
  else if (!app.isPackaged && !process.env.SPITI_UPDATE_URL && !process.env.SPITI_GITHUB_API) setState({ supported: false, reason: 'Updates work in the installed app.' })
  else if (process.platform === 'linux' && !isMac && app.isPackaged && !process.env.APPIMAGE && !process.env.SPITI_UPDATE_URL) setState({ supported: false, reason: 'Updates need the AppImage build.' })
  else if (!repoInfo() && !process.env.SPITI_UPDATE_URL) setState({ supported: false, reason: 'No update source is configured.' })
  if (state.supported && !isMac) {
    try {
      setupNative()
    } catch (e) {
      setState({ supported: false, reason: `Updater unavailable: ${friendly(e)}` })
    }
  }

  ipcMain.handle('update:state', () => ({ ...state, hasToken: !!token() }))
  ipcMain.handle('update:check', () => check(true))
  ipcMain.handle('update:download', () => (state.manualInstall ? false : download()))
  ipcMain.handle('update:install', () => install())
  ipcMain.handle('update:setAuto', (_e, on) => {
    settings.autoDownload = !!on
    saveSettings()
    if (au) au.autoDownload = settings.autoDownload
    setState({ autoDownload: settings.autoDownload })
  })

  if (state.supported) {
    // First check shortly after start-up, then every few hours.
    setTimeout(() => void check(false), Number(process.env.SPITI_UPDATE_DELAY_MS) || 15_000).unref?.()
    setInterval(() => void check(false), CHECK_EVERY_MS).unref?.()
  }
  // macOS: a downloaded update is applied when you quit, like electron-updater does elsewhere.
  app.on('will-quit', () => {
    if (isMac && state.status === 'ready' && mac.staged && !mac.applying) launchApply(false)
  })
}

module.exports = { register, _test: { check, download, install, state: () => state } }
