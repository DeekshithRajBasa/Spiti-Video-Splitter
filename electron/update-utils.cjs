'use strict'
// Pure helpers for the updater (no Electron imports, so they can be tested with plain Node).

/** "v1.2.3" or "1.2.3-beta.1" → { major, minor, patch, pre } (null if not a version). */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim())
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' } : null
}

/** 1 if a > b, -1 if a < b, 0 if equal or unparseable. A pre-release is older than its release. */
function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre > y.pre ? 1 : -1
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

/** Release notes (HTML, markdown, array or null) → short plain text for the snackbar. */
function cleanNotes(raw, max = 700) {
  let t = Array.isArray(raw) ? raw.map((r) => r?.note ?? r).join('\n\n') : String(raw ?? '')
  t = t
    .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t
}

/** "sha256:ABC…" (GitHub's asset digest) → lower-case hex, or '' if absent. */
function parseDigest(d) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(d ?? '').trim())
  return m ? m[1].toLowerCase() : ''
}

/** The macOS update zip for this CPU in a GitHub release's asset list. */
function pickMacAsset(assets, arch) {
  const want = arch === 'arm64' ? 'arm64' : 'x64'
  return (assets || []).find((a) => new RegExp(`-mac-${want}\\.zip$`, 'i').test(a?.name || '')) || null
}

/**
 * Swaps the running .app for the downloaded one after the app quits, then relaunches.
 * The old app is moved aside first and put back if anything fails, so a bad update can't
 * leave you without an app.  Args: APP NEW PID RELAUNCH(1|0)
 */
function macApplyScript() {
  return `#!/bin/sh
APP="$1"; NEW="$2"; PID="$3"; RELAUNCH="$4"
BAK="$APP.updating-old"
# Wait (up to 30 s) for the running app to exit.
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 60 ]; do sleep 0.5; i=$((i+1)); done
if kill -0 "$PID" 2>/dev/null; then exit 2; fi
rm -rf "$BAK"
mv "$APP" "$BAK" || { [ "$RELAUNCH" = "1" ] && open "$APP"; exit 3; }
if ditto "$NEW" "$APP"; then
  xattr -cr "$APP" 2>/dev/null
  rm -rf "$BAK" "$NEW"
  [ "$RELAUNCH" = "1" ] && open "$APP"
  exit 0
fi
# Copy failed: restore the previous version.
rm -rf "$APP"
mv "$BAK" "$APP"
[ "$RELAUNCH" = "1" ] && open "$APP"
exit 1
`
}

module.exports = { parseVersion, compareVersions, cleanNotes, parseDigest, pickMacAsset, macApplyScript }
