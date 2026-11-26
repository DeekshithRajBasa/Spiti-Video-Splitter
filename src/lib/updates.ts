// In-app updates (desktop only). The main process does the work (electron/updater.cjs);
// this keeps the latest state for the UI and wraps the actions.
import { useSyncExternalStore } from 'react'
import { store } from '../store'
import { desktop, type UpdateState } from './desktop'

let state: UpdateState | null = null
let dismissed = ''
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (desktop) {
  try {
    dismissed = localStorage.getItem('svs.update.dismissed') || ''
  } catch {
    /* storage unavailable */
  }
  void desktop.updateState().then((s) => {
    state = s
    emit()
  })
  desktop.onUpdateState((s) => {
    state = s
    emit()
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useUpdate = () => useSyncExternalStore(subscribe, () => state)
export const useDismissed = () => useSyncExternalStore(subscribe, () => dismissed)

/** What the snackbar remembers: "Later" hides it for this version and state. */
export const updateKey = (s: UpdateState | null) => (s ? `${s.status}:${s.version}` : '')

export function dismissUpdate(s: UpdateState) {
  dismissed = updateKey(s)
  try {
    localStorage.setItem('svs.update.dismissed', dismissed)
  } catch {
    /* ignore */
  }
  emit()
}

/** Is there an update worth showing in the corner button? */
export const hasUpdate = (s: UpdateState | null): s is UpdateState => !!s && s.supported && ['available', 'downloading', 'ready'].includes(s.status)

export function checkForUpdates() {
  return desktop?.updateCheck()
}

export function restartToUpdate() {
  if (!desktop) return
  if (store.get().ui.exporting && !confirm('An export is still running. Restarting now will cancel it. Restart anyway?')) return
  if (Object.keys(store.get().media).length && !confirm('Restart to update? Your current edit (loaded videos and cuts) will close. Your settings and Renders list are kept.')) return
  void desktop.updateInstall()
}

/** The one action the corner button performs, depending on where the update is. */
export function updateAction() {
  const s = state
  if (!desktop || !s) return
  if (s.status === 'ready') restartToUpdate()
  else if (s.status === 'available') {
    if (s.manualInstall) window.open(s.url, '_blank')
    else void desktop.updateDownload()
  } else if (s.status === 'error') void desktop.updateCheck()
}

export const updateLabel = (s: UpdateState) =>
  s.status === 'ready' ? 'Restart to update' : s.status === 'downloading' ? `Updating ${Math.round(s.percent)}%` : s.manualInstall ? 'Get update' : 'Update'
