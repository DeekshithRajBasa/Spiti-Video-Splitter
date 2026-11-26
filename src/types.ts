export type MediaKind = 'video' | 'image' | 'audio'

export interface MediaItem {
  id: string
  name: string
  kind: MediaKind
  url: string
  file: File
  duration: number
  width: number
  height: number
  thumbs: string[]
  waveform: number[]
}

export type CanvasRatio = '9:16' | '4:5' | '1:1' | '3:4' | '16:9'
export type LayoutId = 'solo' | 'split' | 'pip' | 'trio' | 'centered'
export type SplitMode = 'even' | 'wide-top' | 'wide-bottom'
export type PipShape = 'rect' | 'rounded' | 'circle'
export type PipCorner = 'tl' | 'tr' | 'bl' | 'br'

/** Crop inside a source. cx/cy are the normalized center; zoom >= 1 narrows the crop. */
export interface Crop {
  cx: number
  cy: number
  zoom: number
}

export interface Slot {
  sourceId: string | null
  crop: Crop
}

export interface Segment {
  id: string
  start: number
  end: number
}

export type BgMode = 'blur' | 'color' | 'gradient' | 'image'

export interface Background {
  mode: BgMode
  color: string
  gradientFrom: string
  gradientTo: string
  gradientAngle: number
  imageId: string | null
  blur: number
  dim: number
  padding: number
  radius: number
  shadow: number
  dividerSize: number
  dividerColor: string
}

export type CaptionAnim = 'pop-in' | 'pop-in-line' | 'one-by-one' | 'build-up' | 'highlight' | 'full-line'

export interface Cue {
  id: string
  start: number
  end: number
  text: string
}

export interface CaptionStyle {
  animation: CaptionAnim
  font: string
  weight: number
  size: number
  color: string
  activeColor: string
  boxColor: string
  strokeColor: string
  strokeWidth: number
  shadow: number
  uppercase: boolean
  y: number
  maxChars: number
  maxLines: number
}

export interface Headline {
  enabled: boolean
  text: string
  subline: string
  font: string
  size: number
  color: string
  bgColor: string
  bgEnabled: boolean
  y: number
}

export type TemplateId =
  | 'none'
  | 'x-light'
  | 'x-dark'
  | 'tiktok-hook'
  | 'breaking-news'
  | 'poll'
  | 'comment'
  | 'code'
  | 'quote'
  | 'podcast'
  | 'headline-bar'

export interface TemplateConfig {
  id: TemplateId
  name: string
  handle: string
  text: string
  avatarId: string | null
  verified: boolean
  accent: string
  ticker: string
  options: string
}

export interface MusicConfig {
  mediaId: string | null
  volume: number
  peakVolume: number
  riser: number
  offset: number
}

export interface SfxCue {
  id: string
  mediaId: string
  at: number
  volume: number
}

export interface Outro {
  enabled: boolean
  text: string
  handle: string
  duration: number
  color: string
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

export interface Watermark {
  enabled: boolean
  text: string
  imageId: string | null
  position: Corner
  opacity: number
  size: number
}

export interface ExportConfig {
  resolution: 720 | 1080 | 1440 | 2160
  fps: 24 | 30 | 60
  bitrate: number
}

export interface TrackFlags {
  overlay: { hidden: boolean; locked: boolean }
  captions: { hidden: boolean; locked: boolean }
  video: { muted: boolean; locked: boolean }
  sfx: { muted: boolean; locked: boolean }
  music: { muted: boolean; locked: boolean }
}

export interface Project {
  name: string
  canvas: CanvasRatio
  layout: LayoutId
  splitMode: SplitMode
  splitRatio: number
  pipShape: PipShape
  pipCorner: PipCorner
  pipSize: number
  slots: Slot[]
  segments: Segment[]
  sourceVolume: number
  background: Background
  captionsEnabled: boolean
  cues: Cue[]
  captionStyle: CaptionStyle
  headline: Headline
  template: TemplateConfig
  music: MusicConfig
  sfx: SfxCue[]
  outro: Outro
  watermark: Watermark
  export: ExportConfig
  tracks: TrackFlags
}
