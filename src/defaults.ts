import type { CanvasRatio, Project } from './types'

export const uid = () => Math.random().toString(36).slice(2, 10)

export const CANVAS_RATIOS: Record<CanvasRatio, [number, number]> = {
  '9:16': [9, 16],
  '4:5': [4, 5],
  '1:1': [1, 1],
  '3:4': [3, 4],
  '16:9': [16, 9],
}

export const FONTS = ['Montserrat', 'Inter', 'Poppins', 'Bebas Neue', 'Anton', 'Roboto Mono', 'Playfair Display']

export const defaultCrop = () => ({ cx: 0.5, cy: 0.5, zoom: 1 })

export function createProject(): Project {
  return {
    name: 'untitled-clip',
    canvas: '9:16',
    layout: 'solo',
    splitMode: 'even',
    splitRatio: 0.5,
    pipShape: 'rounded',
    pipCorner: 'br',
    pipSize: 0.34,
    slots: [
      { sourceId: null, crop: { cx: 0.3, cy: 0.5, zoom: 1 } },
      { sourceId: null, crop: { cx: 0.7, cy: 0.5, zoom: 1 } },
      { sourceId: null, crop: { cx: 0.5, cy: 0.5, zoom: 1 } },
    ],
    segments: [],
    sourceVolume: 1,
    background: {
      mode: 'blur',
      color: '#101014',
      gradientFrom: '#7c3aed',
      gradientTo: '#ec4899',
      gradientAngle: 135,
      imageId: null,
      blur: 40,
      dim: 0.35,
      padding: 0,
      radius: 0,
      shadow: 0.4,
      dividerSize: 0,
      dividerColor: '#ffffff',
    },
    captionsEnabled: true,
    cues: [],
    captionStyle: {
      animation: 'pop-in-line',
      font: 'Montserrat',
      weight: 900,
      size: 6.4,
      color: '#ffffff',
      activeColor: '#facc15',
      boxColor: '#7c3aed',
      strokeColor: '#000000',
      strokeWidth: 0.9,
      shadow: 0.6,
      uppercase: true,
      y: 0.68,
      maxChars: 22,
      maxLines: 2,
    },
    headline: {
      enabled: false,
      text: 'The strength of being misunderstood',
      subline: '',
      font: 'Montserrat',
      size: 5.2,
      color: '#ffffff',
      bgColor: '#000000',
      bgEnabled: false,
      y: 0.1,
    },
    template: {
      id: 'none',
      name: 'Alex Rivera',
      handle: '@alexrivera',
      text: 'What is the single most valuable lesson you learned this year?',
      avatarId: null,
      verified: true,
      accent: '#e11d48',
      ticker: 'LIVE  •  New episode out now  •  Subscribe for more  •',
      options: 'Consistency\nTalent\nLuck',
    },
    music: { mediaId: null, volume: 0.15, peakVolume: 0.85, riser: 5, offset: 0 },
    sfx: [],
    outro: { enabled: false, text: 'Follow for more', handle: '@yourchannel', duration: 2.5, color: '#7c3aed' },
    watermark: { enabled: false, text: '@yourchannel', imageId: null, position: 'tr', opacity: 0.8, size: 0.16 },
    export: { resolution: 1080, fps: 30, bitrate: 12, mode: 'fast' },
    tracks: {
      overlay: { hidden: false, locked: false },
      captions: { hidden: false, locked: false },
      video: { muted: false, locked: false },
      sfx: { muted: false, locked: false },
      music: { muted: false, locked: false },
    },
  }
}
