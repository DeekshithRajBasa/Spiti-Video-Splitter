import {
  ArrowLeft,
  AudioLines,
  Captions,
  Cloud,
  Crop,
  Film,
  FolderOpen,
  HelpCircle,
  LayoutTemplate,
  Moon,
  Palette,
  Pencil,
  Settings2,
  Sun,
  Type,
  X,
  Clapperboard,
  PanelsTopLeft,
  Sparkles,
  Download,
  Scissors,
  MonitorPlay,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CaptionsPanel } from './components/CaptionsPanel'
import { ClipsPanel } from './components/ClipsPanel'
import { SettingsModal } from './components/SettingsModal'
import { ExportButton, ExportProgress, Inspector } from './components/Inspector'
import { LayoutPanel } from './components/LayoutPanel'
import { MediaPanel } from './components/MediaPanel'
import { Preview } from './components/Preview'
import { RendersButton, RendersDrawer } from './components/RendersPanel'
import { TemplatesPanel } from './components/TemplatesPanel'
import { Timeline } from './components/Timeline'
import { createProject } from './defaults'
import {
  addCueAtPlayhead,
  deleteSelection,
  importFiles,
  setInPoint,
  setOutPoint,
  splitAtPlayhead,
} from './lib/actions'
import { receiveLink } from './lib/ai/autoclip'
import { desktop, desktopReady } from './lib/desktop'
import { engine } from './lib/engine'
import { runExport, saveSnapshot } from './lib/exportFlow'
import { store, useProject, useUi, type UiState } from './store'

const LEFT_TABS: { id: UiState['leftTab']; label: string; icon: typeof Film }[] = [
  { id: 'clips', label: 'Auto clip', icon: Sparkles },
  { id: 'media', label: 'Media', icon: Film },
  { id: 'captions', label: 'Captions', icon: Type },
  { id: 'layout', label: 'Layout', icon: PanelsTopLeft },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
]
const RIGHT_TABS: { id: UiState['rightTab']; label: string; icon: typeof Film }[] = [
  { id: 'frame', label: 'Frame', icon: Crop },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'audio', label: 'Audio', icon: AudioLines },
  { id: 'export', label: 'Export', icon: Sparkles },
]

function ago(t: number, now: number) {
  const s = Math.round((now - t) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60)
  return `${m} minute${m > 1 ? 's' : ''} ago`
}

export default function App() {
  const ui = useUi()
  const [help, setHelp] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [settings, setSettings] = useState<null | 'ai' | 'speech' | 'app'>(null)
  const mobile = useIsMobile()

  const importRef = useRef<HTMLInputElement>(null)

  // Paste a link anywhere (outside text fields) and clipping starts.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const text = e.clipboardData?.getData('text')?.trim() ?? ''
      if (!/^https?:\/\/\S+$/i.test(text)) return
      e.preventDefault()
      receiveLink(text, 'paste')
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Desktop: links handed over from the web app (spiti://clip?url=…).
  useEffect(() => {
    if (!desktop) return
    const take = () => void desktop!.takeDeepLinks().then((links) => links.forEach((l) => receiveLink(l, 'deeplink')))
    take()
    return desktop.onDeepLink(take)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = ui.theme
    void desktop?.setTitlebarTheme(ui.theme === 'dark')
  }, [ui.theme])

  // Desktop app: platform classes for the title bar, and native menu commands.
  useEffect(() => {
    if (!desktop) return
    void desktopReady.then((info) => {
      if (info) document.documentElement.classList.add('desktop', `platform-${info.platform}`)
    })
    return desktop.onMenu((cmd) => {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      switch (cmd) {
        case 'import':
          importRef.current?.click()
          break
        case 'export':
          store.ui({ rightTab: 'export' })
          void runExport()
          break
        case 'snapshot':
          void saveSnapshot()
          break
        case 'new':
          newProject()
          break
        case 'undo':
          if (typing) document.execCommand('undo')
          else store.undo()
          break
        case 'redo':
          if (typing) document.execCommand('redo')
          else store.redo()
          break
        case 'split':
          if (!typing) splitAtPlayhead()
          break
        case 'theme':
          store.ui({ theme: store.get().ui.theme === 'dark' ? 'light' : 'dark' })
          break
        case 'help':
          setHelp(true)
          break
      }
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        store.redo()
      } else if (mod && k === 'b') {
        e.preventDefault()
        splitAtPlayhead()
      } else if (mod && k === 'e') {
        e.preventDefault()
        store.ui({ rightTab: 'export' })
      } else if (mod && k === 'm') {
        e.preventDefault()
        store.update((d) => void (d.tracks.video.muted = !d.tracks.video.muted))
      } else if (mod && k === 'g') {
        e.preventDefault()
        store.update((d) => void (d.captionsEnabled = !d.captionsEnabled))
      } else if (e.shiftKey && k === 'l') {
        store.ui({ theme: store.get().ui.theme === 'dark' ? 'light' : 'dark' })
      } else if (mod) {
        return
      } else if (e.code === 'Space' || k === 'k') {
        e.preventDefault()
        engine.toggle()
      } else if (k === 'i') setInPoint()
      else if (k === 'o') setOutPoint()
      else if (k === 's') splitAtPlayhead()
      else if (k === 't') addCueAtPlayhead()
      else if (k === 'delete' || k === 'backspace') deleteSelection()
      else if (k === 'arrowleft') engine.step(e.shiftKey ? -10 : -1)
      else if (k === 'arrowright') engine.step(e.shiftKey ? 10 : 1)
      else if (k === 'j') engine.seek(engine.outTime - 5)
      else if (k === 'l') engine.seek(engine.outTime + 5)
      else if (k === 'home') engine.seek(0)
      else if (k === 'end') engine.seek(engine.duration)
      else if (k === '=' || k === '+') store.ui({ zoom: Math.min(64, store.get().ui.zoom * 1.4) })
      else if (k === '-') store.ui({ zoom: Math.max(0.02, store.get().ui.zoom / 1.4) })
      else if (k === 'escape') {
        store.ui({ selection: null, inPoint: null, outPoint: null })
        setHelp(false)
      } else if (k === '?') setHelp((h) => !h)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        void importFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={importRef}
        type="file"
        multiple
        hidden
        accept="video/*,audio/*,image/*,.srt,.vtt,.ass,.ssa,.mkv,.mov"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {mobile ? (
        <MobileShell openSettings={(t) => setSettings(t ?? 'ai')} onHelp={() => setHelp(true)} />
      ) : (
        <>
          <nav className="rail" aria-label="Main">
            <div className="logo" aria-label="Spiti">
              <svg viewBox="0 0 32 32" width="34" height="34">
                <rect width="32" height="32" rx="9" fill="currentColor" />
                <path d="M9 21 L14 11 L18 18 L20.5 14 L24 21 Z" fill="var(--rail-bg)" />
                <circle cx="21" cy="10" r="2" fill="var(--rail-bg)" />
              </svg>
            </div>
            <RailItem icon={Sparkles} label="Auto clip" on={ui.leftTab === 'clips'} onClick={() => store.ui({ leftTab: 'clips' })} />
            <RailItem icon={Clapperboard} label="Media" on={ui.leftTab === 'media'} onClick={() => store.ui({ leftTab: 'media' })} />
            <RailItem icon={Captions} label="Captions" on={ui.leftTab === 'captions'} onClick={() => store.ui({ leftTab: 'captions' })} />
            <RailItem icon={PanelsTopLeft} label="Layouts" on={ui.leftTab === 'layout'} onClick={() => store.ui({ leftTab: 'layout' })} />
            <RailItem icon={LayoutTemplate} label="Templates" on={ui.leftTab === 'templates'} onClick={() => store.ui({ leftTab: 'templates' })} />
            <RailItem icon={Palette} label="Brand Kit" on={ui.rightTab === 'style'} onClick={() => store.ui({ rightTab: 'style' })} />
            <RailItem icon={AudioLines} label="Audio" on={ui.rightTab === 'audio'} onClick={() => store.ui({ rightTab: 'audio' })} />
            <div className="rail-spacer" />
            <RailItem icon={HelpCircle} label="Help" on={help} onClick={() => setHelp(true)} />
            <RailItem icon={MonitorPlay} label="Renders" on={ui.rendersOpen} onClick={() => store.ui({ rendersOpen: !ui.rendersOpen })} />
            <RailItem icon={Settings2} label="Settings" on={!!settings} onClick={() => setSettings('ai')} />
          </nav>

          <div className="main">
            <TopBar onHelp={() => setHelp(true)} />
            <div className="workspace">
              <aside className="left card">
                <div className="tabs">
                  {LEFT_TABS.map((t) => (
                    <button type="button" key={t.id} className={ui.leftTab === t.id ? 'on' : ''} onClick={() => store.ui({ leftTab: t.id })}>
                      <t.icon size={14} /> {t.label}
                    </button>
                  ))}
                </div>
                <LeftPanel tab={ui.leftTab} openSettings={(t) => setSettings(t ?? 'ai')} />
              </aside>

              <Preview />

              <aside className="right card">
                <div className="tabs">
                  {RIGHT_TABS.map((t) => (
                    <button type="button" key={t.id} className={ui.rightTab === t.id ? 'on' : ''} onClick={() => store.ui({ rightTab: t.id })}>
                      <t.icon size={14} /> {t.label}
                    </button>
                  ))}
                </div>
                <Inspector />
              </aside>
            </div>

            <Timeline />
          </div>
        </>
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <Film size={28} />
            <strong>Drop to import</strong>
            <span>Videos, images, music and .srt / .ass subtitles</span>
          </div>
        </div>
      )}
      {ui.rightTab !== 'export' && <ExportProgress />}
      {help && <HelpModal onClose={() => setHelp(false)} />}
      {settings && <SettingsModal initial={settings} onClose={() => setSettings(null)} />}
      <RendersDrawer />
    </div>
  )
}

function useIsMobile() {
  const q = '(max-width: 860px)'
  const [m, setM] = useState(() => window.matchMedia?.(q).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

type OpenSettings = (tab?: 'ai' | 'speech' | 'app') => void

function LeftPanel({ tab, openSettings }: { tab: UiState['leftTab']; openSettings: OpenSettings }) {
  if (tab === 'clips') return <ClipsPanel onOpenSettings={openSettings} />
  if (tab === 'media') return <MediaPanel />
  if (tab === 'captions') return <CaptionsPanel />
  if (tab === 'layout') return <LayoutPanel />
  return <TemplatesPanel />
}

function TopBar({ onHelp, compact }: { onHelp: () => void; compact?: boolean }) {
  const ui = useUi()
  const p = useProject()
  const [editingName, setEditingName] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(i)
  }, [])
  return (
    <header className="topbar">
      {!compact && (
        <button type="button" className="icon-btn" title="New project" aria-label="New project" onClick={newProject}>
          <ArrowLeft size={16} />
        </button>
      )}
      {editingName ? (
        <input
          className="name-input"
          autoFocus
          defaultValue={p.name}
          aria-label="Project name"
          onBlur={(e) => {
            const v = e.target.value.trim() || 'untitled-clip'
            store.update((d) => void (d.name = v))
            setEditingName(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button type="button" className="project-name" onClick={() => setEditingName(true)}>
          <span>{p.name}.mp4</span> <Pencil size={13} />
        </button>
      )}
      <div className="topbar-spacer" />
      {!compact && (
        <>
          <span className="saved">
            <Cloud size={15} /> Saved locally {ago(ui.lastSaved, now)}
          </span>
          <span className="offline-pill" title="Editing, captions and local AI run on your device">
            <span className="dot" /> On-device
          </span>
        </>
      )}
      <button
        type="button"
        className="icon-btn"
        title="Toggle theme (Shift+L)"
        aria-label="Toggle theme"
        onClick={() => store.ui({ theme: ui.theme === 'dark' ? 'light' : 'dark' })}
      >
        {ui.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      {!compact && (
        <button type="button" className="btn outline" onClick={onHelp}>
          <FolderOpen size={15} /> Shortcuts
        </button>
      )}
      <RendersButton compact={compact} />
      <ExportButton />
    </header>
  )
}

const MOBILE_TABS: { id: string; label: string; icon: typeof Film; left?: UiState['leftTab']; right?: UiState['rightTab'] }[] = [
  { id: 'clips', label: 'Auto clip', icon: Sparkles, left: 'clips' },
  { id: 'media', label: 'Media', icon: Film, left: 'media' },
  { id: 'timeline', label: 'Timeline', icon: Scissors },
  { id: 'captions', label: 'Captions', icon: Type, left: 'captions' },
  { id: 'layout', label: 'Layout', icon: PanelsTopLeft, left: 'layout' },
  { id: 'frame', label: 'Frame', icon: Crop, right: 'frame' },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, left: 'templates' },
  { id: 'style', label: 'Style', icon: Palette, right: 'style' },
  { id: 'audio', label: 'Audio', icon: AudioLines, right: 'audio' },
  { id: 'export', label: 'Export', icon: Download, right: 'export' },
]

/** Phone layout: preview on top, a scrollable tab strip, and one panel at a time. */
function MobileShell({ openSettings, onHelp }: { openSettings: OpenSettings; onHelp: () => void }) {
  const ui = useUi()
  const tab = MOBILE_TABS.find((t) => t.id === ui.mobileTab) ?? MOBILE_TABS[0]
  return (
    <div className="mobile">
      <TopBar onHelp={onHelp} compact />
      <Preview />
      <nav className="mobile-tabs" aria-label="Panels">
        {MOBILE_TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={t.id === tab.id ? 'on' : ''}
            onClick={() => store.ui({ mobileTab: t.id, ...(t.left ? { leftTab: t.left } : {}), ...(t.right ? { rightTab: t.right } : {}) })}
          >
            <t.icon size={15} />
            <span>{t.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => openSettings()}>
          <Settings2 size={15} />
          <span>Settings</span>
        </button>
      </nav>
      <div className={`mobile-panel card ${tab.id === 'timeline' ? 'is-timeline' : ''}`}>
        {tab.id === 'timeline' ? <Timeline /> : tab.left ? <LeftPanel tab={tab.left} openSettings={openSettings} /> : <Inspector />}
      </div>
    </div>
  )
}

function newProject() {
  if (!confirm('Start a new project? Your current edit settings will be cleared.')) return
  engine.pause()
  store.update(() => createProject())
}

function RailItem({ icon: Icon, label, on, onClick }: { icon: typeof Film; label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`rail-item ${on ? 'on' : ''}`} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Space / K', 'Play / pause'],
  ['I / O', 'Set In / Out point'],
  ['S or Ctrl+B', 'Split at playhead'],
  ['Delete', 'Delete selected clip, caption or sound'],
  ['T', 'Add caption at playhead'],
  ['← / →', 'Step one frame (Shift: 10)'],
  ['J / L', 'Back / forward 5 seconds'],
  ['Home / End', 'Jump to start / end'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+M', 'Mute video audio'],
  ['Ctrl+G', 'Toggle captions'],
  ['Ctrl+E', 'Open export'],
  ['Shift+L', 'Light / dark mode'],
  ['+ / −, Ctrl+scroll', 'Zoom timeline'],
  ['?', 'This help'],
]

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>How it works</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <ol className="steps">
          <li>
            <b>Import</b> a widescreen podcast, stream or gameplay video. Drag it anywhere in the window.
          </li>
          <li>
            <b>Frame</b>: pick Solo, Split, PiP, Trio or Centered in Layouts, then drag the boxes over each speaker in the Frame tab.
          </li>
          <li>
            <b>Cut</b>: set In/Out with <kbd>I</kbd>/<kbd>O</kbd>, split with <kbd>S</kbd>, delete the parts you don't want.
          </li>
          <li>
            <b>Caption</b>: import an .srt or .ass file, or type the words. Pick one of six word-by-word animations.
          </li>
          <li>
            <b>Style</b>: add a template, background, headline hook, music with an end-rise, outro card and watermark.
          </li>
          <li>
            <b>Export</b> at up to 4K, 60 fps. Everything runs in your browser; files are never uploaded.
          </li>
        </ol>
        <h4>Keyboard shortcuts</h4>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
