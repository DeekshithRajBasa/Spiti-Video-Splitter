import { ArrowDownToLine, Check, ExternalLink, KeyRound, Loader2, RefreshCw, RotateCw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { desktop } from '../lib/desktop'
import { checkForUpdates, dismissUpdate, hasUpdate, restartToUpdate, updateAction, updateKey, updateLabel, useDismissed, useUpdate } from '../lib/updates'
import { Section, Toggle } from './ui'

const speed = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`)

/** Tiny button in the top bar: shows while an update is available, downloading, or ready. */
export function UpdateButton() {
  const s = useUpdate()
  if (!desktop || !hasUpdate(s)) return null
  const busy = s.status === 'downloading'
  return (
    <button
      type="button"
      className={`update-btn ${s.status}`}
      disabled={busy}
      onClick={updateAction}
      title={`Version ${s.version}${s.notes ? `\n\n${s.notes}` : ''}`}
    >
      {busy ? <Loader2 size={13} className="spin" /> : s.status === 'ready' ? <RotateCw size={13} /> : <ArrowDownToLine size={13} />}
      <span>{updateLabel(s)}</span>
    </button>
  )
}

/** Snackbar at the bottom-left when an update is found or ready to install. */
export function UpdateSnackbar() {
  const s = useUpdate()
  const dismissed = useDismissed()
  if (!desktop || !hasUpdate(s) || s.status === 'downloading' || dismissed === updateKey(s)) return null
  const ready = s.status === 'ready'
  return (
    <div className="snackbar" role="status" aria-live="polite">
      <span className="snack-icon">{ready ? <RotateCw size={15} /> : <ArrowDownToLine size={15} />}</span>
      <div className="snack-text">
        <strong>{ready ? `Version ${s.version} is ready` : `Version ${s.version} is available`}</strong>
        <span>
          {ready ? 'Restart to finish updating, or it installs when you quit.' : s.manualInstall ? 'Move the app to Applications to update in-app, or download it.' : 'A newer version of Spiti Video Splitter.'}
          {s.url && (
            <>
              {' '}
              <a href={s.url} target="_blank" rel="noreferrer">
                What's new <ExternalLink size={10} />
              </a>
            </>
          )}
        </span>
      </div>
      <button type="button" className="btn dark sm" onClick={updateAction}>
        {ready ? 'Restart' : s.manualInstall ? 'Get update' : 'Update'}
      </button>
      <button type="button" className="icon-btn sm ghost" aria-label="Later" title="Later" onClick={() => dismissUpdate(s)}>
        <X size={13} />
      </button>
    </div>
  )
}

/** Settings → App → Updates. */
export function UpdatesSettings() {
  const s = useUpdate()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (s?.needsToken) setOpen(true)
  }, [s?.needsToken])
  if (!desktop || !s) return null

  const saveToken = async (value: string) => {
    setBusy(true)
    try {
      await desktop!.secretSet('github.updateToken', value)
      setToken('')
      await checkForUpdates()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Updates">
      <div className="update-status">
        <div>
          <strong>Version {s.current}</strong>
          <span>
            {!s.supported
              ? s.reason
              : s.status === 'checking'
                ? 'Checking for updates…'
                : s.status === 'available'
                  ? `Version ${s.version} is available`
                  : s.status === 'downloading'
                    ? `Downloading version ${s.version} · ${Math.round(s.percent)}%${s.speed ? ` · ${speed(s.speed)}` : ''}`
                    : s.status === 'ready'
                      ? `Version ${s.version} is ready to install`
                      : s.status === 'error'
                        ? ''
                        : s.lastChecked
                          ? `You're up to date · checked ${new Date(s.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : 'Updates are checked automatically.'}
          </span>
          {s.status === 'error' && <span className="error-text">{s.error}</span>}
        </div>
        {s.supported &&
          (s.status === 'ready' ? (
            <button type="button" className="btn dark sm" onClick={restartToUpdate}>
              <RotateCw size={13} /> Restart to update
            </button>
          ) : s.status === 'available' ? (
            <button type="button" className="btn dark sm" onClick={updateAction}>
              <ArrowDownToLine size={13} /> {s.manualInstall ? 'Get update' : 'Download'}
            </button>
          ) : (
            <button type="button" className="btn sm" disabled={s.status === 'checking' || s.status === 'downloading'} onClick={() => void checkForUpdates()}>
              {s.status === 'checking' ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Check now
            </button>
          ))}
      </div>
      {s.status === 'downloading' && (
        <div className="bar">
          <i style={{ width: `${s.percent}%` }} />
        </div>
      )}
      {s.supported && <Toggle label="Download updates automatically" checked={s.autoDownload} onChange={(v) => void desktop!.updateSetAuto(v)} />}
      {s.supported && (
        <details className="private-releases" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Releases are private? Add a GitHub token</summary>
          <p className="hint">
            If this app's releases live in a private repository, paste a fine-grained GitHub token with read-only <b>Contents</b> access to it. It's stored in your system keychain
            and used only to check and download updates.
          </p>
          <div className="input-row">
            <input type="password" value={token} placeholder={s.hasToken ? '•••••••• saved' : 'github_pat_…'} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
            <button type="button" className="btn sm" disabled={!token.trim() || busy} onClick={() => void saveToken(token.trim())}>
              <KeyRound size={13} /> Save
            </button>
            {s.hasToken && (
              <button type="button" className="icon-btn sm" aria-label="Remove saved token" disabled={busy} onClick={() => void saveToken('')}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
          {s.hasToken && (
            <p className="ok-text">
              <Check size={13} /> Token saved
            </p>
          )}
        </details>
      )}
    </Section>
  )
}
