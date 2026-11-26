import { AudioLines, Filter, ImagePlus, Music, Search, Trash2, Video, Image as ImageIcon, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { addSfx, importFiles, setMaster, setMusic, setSlot } from '../lib/actions'
import { fmtShort } from '../lib/timeline'
import { store, useMedia, useProject } from '../store'
import type { MediaItem, MediaKind } from '../types'

export function MediaPanel() {
  const media = useMedia()
  const project = useProject()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<MediaKind | 'all'>('all')
  const input = useRef<HTMLInputElement>(null)
  const items = Object.values(media).filter(
    (m) => (kind === 'all' || m.kind === kind) && m.name.toLowerCase().includes(q.toLowerCase()),
  )

  const usage = (m: MediaItem) => {
    const u: string[] = []
    project.slots.forEach((s, i) => s.sourceId === m.id && u.push(i === 0 ? 'Main' : `Slot ${i + 1}`))
    if (project.music.mediaId === m.id) u.push('Music')
    if (project.sfx.some((s) => s.mediaId === m.id)) u.push('SFX')
    if (project.background.imageId === m.id) u.push('BG')
    if (project.template.avatarId === m.id) u.push('Avatar')
    if (project.watermark.imageId === m.id) u.push('Logo')
    return u
  }

  return (
    <div className="panel-body">
      <div className="search-row">
        <label className="search">
          <Search size={15} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="filter" title="Filter by type">
          <Filter size={14} />
          <select value={kind} onChange={(e) => setKind(e.target.value as MediaKind | 'all')} aria-label="Filter by type">
            <option value="all">All</option>
            <option value="video">Video</option>
            <option value="image">Images</option>
            <option value="audio">Audio</option>
          </select>
        </label>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="video/*,audio/*,image/*,.srt,.vtt,.ass,.ssa,.mkv,.mov"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <div className="media-grid">
        <button type="button" className="import-tile" onClick={() => input.current?.click()}>
          <ImagePlus size={20} />
          <span>Import</span>
          <small>Video, audio, image, .srt</small>
        </button>
        {items.map((m) => (
          <MediaCard key={m.id} m={m} usage={usage(m)} />
        ))}
      </div>
      {!Object.keys(media).length && (
        <p className="muted pad">
          Drop a widescreen video anywhere to start. Files stay on your computer and are never uploaded.
        </p>
      )}
    </div>
  )
}

function MediaCard({ m, usage }: { m: MediaItem; usage: string[] }) {
  const [open, setOpen] = useState(false)
  const actions: { label: string; run: () => void }[] = []
  if (m.kind === 'video') {
    actions.push({ label: 'Use as main', run: () => setMaster(m) })
    actions.push({ label: 'Put in slot 2', run: () => setSlot(1, m) })
    actions.push({ label: 'Put in slot 3', run: () => setSlot(2, m) })
  }
  if (m.kind === 'image') {
    actions.push({ label: 'B-roll in slot 2', run: () => setSlot(1, m) })
    actions.push({
      label: 'Background image',
      run: () =>
        store.update((p) => {
          p.background.imageId = m.id
          p.background.mode = 'image'
        }),
    })
    actions.push({
      label: 'Template avatar',
      run: () =>
        store.update((p) => {
          p.template.avatarId = m.id
        }),
    })
    actions.push({
      label: 'Logo watermark',
      run: () =>
        store.update((p) => {
          p.watermark.imageId = m.id
          p.watermark.enabled = true
        }),
    })
  }
  if (m.kind === 'audio') {
    actions.push({ label: 'Set as music', run: () => setMusic(m) })
    actions.push({ label: 'Sound effect at playhead', run: () => void addSfx(m) })
  }
  const Icon = m.kind === 'video' ? Video : m.kind === 'audio' ? Music : ImageIcon
  return (
    <div className="media-card" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-svs-media', m.id)}>
      <button type="button" className="thumb" onClick={() => setOpen((o) => !o)} title={m.name}>
        {m.kind === 'audio' ? (
          <div className="audio-thumb">
            <AudioLines size={26} />
          </div>
        ) : m.thumbs[0] ? (
          <img src={m.thumbs[Math.floor(m.thumbs.length / 3)] ?? m.thumbs[0]} alt="" />
        ) : (
          <div className="audio-thumb">
            <Icon size={22} />
          </div>
        )}
        {m.duration > 0 && <span className="badge">{fmtShort(m.duration)}</span>}
        {usage.length > 0 && <span className="usage">{usage.join(' · ')}</span>}
      </button>
      <div className="media-name">
        <Icon size={12} />
        <span>{m.name}</span>
      </div>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          {actions.map((a) => (
            <button
              type="button"
              key={a.label}
              onClick={() => {
                a.run()
                setOpen(false)
              }}
            >
              <Sparkles size={12} /> {a.label}
            </button>
          ))}
          <button type="button" className="danger" onClick={() => removeMedia(m)}>
            <Trash2 size={12} /> Remove
          </button>
        </div>
      )}
    </div>
  )
}

function removeMedia(m: MediaItem) {
  store.update((p) => {
    p.slots.forEach((s) => {
      if (s.sourceId === m.id) s.sourceId = null
    })
    if (p.slots[0].sourceId === null) p.segments = []
    if (p.music.mediaId === m.id) p.music.mediaId = null
    p.sfx = p.sfx.filter((s) => s.mediaId !== m.id)
    if (p.background.imageId === m.id) p.background.imageId = null
    if (p.template.avatarId === m.id) p.template.avatarId = null
    if (p.watermark.imageId === m.id) p.watermark.imageId = null
  })
  store.removeMedia(m.id)
}
