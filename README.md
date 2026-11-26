# Spiti Video Splitter

Turn widescreen podcasts, live streams and gameplay into vertical clips for Shorts, Reels and TikTok, entirely in your browser. Nothing is uploaded; decoding, compositing and encoding all happen on your machine.

## Features

- **Frame**: 9:16, 4:5, 1:1, 3:4 and 16:9 canvases. Solo, Split (even / 16:9 top / 16:9 bottom), PiP (square, rounded, circle), Trio and Centered layouts. Drag a box over each speaker, scroll to zoom, swap cameras in one click, drop an image or a second video into any slot as B-roll.
- **Captions**: import `.srt`, `.vtt` or `.ass`, or type a transcript and have it timed from the playhead. Six word-by-word animations (Pop-In, Pop-In Line, One-by-One, Build Up, Highlight, Full Line). Style one word with `*accent*`, `_italic_` or `[box]`. Font, weight, colours, outline, glow, line length, line count, position. Export your captions back to `.srt`.
- **Headline hook** pinned above the clip, with an optional subline and box.
- **Templates**: X Light, X Dark, Code Card and Quote wrap a 16:9 clip in a card. TikTok Hook, Breaking News (with ticker), Poll, Comment Reply, Podcast Name and Headline Bar sit on top of any layout.
- **Background**: blurred video, solid colour, gradient or your own image with blur and dim. Padding, rounded corners, card shadow and split dividers.
- **Audio**: voice volume, one music track that sits low and rises to its peak volume over the final seconds, and a sound-effects track with cues you can drag.
- **Edit**: In/Out points, split, delete, ripple cut, trim segment edges, undo/redo. The kept pieces play and export back to back.
- **Brand**: animated "Follow for more" outro card and a logo or text watermark.
- **Export**: 720p, 1080p, 2K or 4K at 24/30/60 fps. MP4 (H.264) where the browser supports it, otherwise WebM. Also save any frame as a PNG.
- Light and dark mode, settings autosave locally, keyboard shortcuts for everything (press `?`).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static files in dist/
```

Chrome or Edge works best: they have hardware H.264 recording. Export renders in real time, so keep the tab visible while it runs.

## Shortcuts

| Key | Action |
| --- | --- |
| Space / K | Play / pause |
| I / O | Set In / Out |
| S or Ctrl+B | Split at playhead |
| Delete | Delete selected item |
| T | Add caption at playhead |
| ← / → | Step a frame (Shift: 10) |
| J / L | Back / forward 5 s |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+M / Ctrl+G | Mute video / toggle captions |
| Shift+L | Light / dark mode |

## How it's built

React + TypeScript + Vite. A single canvas renderer (`src/lib/render.ts`) draws every frame for both the preview and the export. The engine (`src/lib/engine.ts`) keeps playback in sync across cuts, mixes audio through Web Audio, and records the export with `canvas.captureStream()` and `MediaRecorder`. Fonts are bundled, so the app works offline.
