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

## Desktop apps (Windows & Mac)

Download the installers from the repository's **Actions** tab (latest "Desktop apps" run → Artifacts) or from **Releases** once a version tag is pushed.

| Platform | File |
| --- | --- |
| Windows 10/11 (64-bit) | `Spiti-Video-Splitter-<version>-Windows-Setup.exe` |
| Mac with Apple Silicon (M1–M4) | `Spiti-Video-Splitter-<version>-mac-arm64.dmg` |
| Intel Mac | `Spiti-Video-Splitter-<version>-mac-x64.dmg` |

The desktop app adds:

- **Fast export**: FFmpeg decodes your footage frame by frame, the graphics card encodes H.264 (Media Foundation on Windows, so NVENC / AMD AMF / Intel QuickSync; VideoToolbox on Mac), and FFmpeg mixes the voice, music riser and sound effects into an MP4 with AAC audio. It runs faster than real time, is frame-accurate at every cut, and keeps going while the window is in the background. Real-time export is still there as a fallback.
- Native save dialogs, **Show in Finder / Explorer** after export, a proper menu bar (File → Import, Export, Save Frame; Edit → Undo, Redo, Split) and a native title bar.
- Fully offline: fonts and FFmpeg ship inside the app.

**First launch (the apps are not code-signed yet):**

- **Windows**: SmartScreen says "Windows protected your PC". Click **More info → Run anyway**.
- **Mac**: open the `.dmg`, drag the app to Applications, then **right-click the app → Open → Open**. If macOS says the app "is damaged", run `xattr -cr "/Applications/Spiti Video Splitter.app"` in Terminal once.

To remove these warnings, add a code-signing certificate: an Apple Developer ID (set `CSC_LINK` / `CSC_KEY_PASSWORD`, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to notarize), and a Windows code-signing certificate (`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`). Add them as repository secrets and pass them to the build steps.

### Build the desktop apps yourself

```bash
npm install
npm run desktop:dev   # run the desktop app against the Vite dev server
npm run desktop       # build and run the desktop app
npm run dist:win      # Windows installer → release/  (run on Windows)
npm run dist:mac      # macOS .dmg → release/       (run on a Mac)
```

Set `SPITI_DEBUG=1` to log the FFmpeg commands the desktop app runs.

## Run it in the browser

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static files in dist/
```

Chrome or Edge works best: they have hardware H.264 recording. In the browser, export renders in real time, so keep the tab visible while it runs.

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

React + TypeScript + Vite, packaged for desktop with Electron and electron-builder. A single canvas renderer (`src/lib/render.ts`) draws every frame for both the preview and the export. The engine (`src/lib/engine.ts`) keeps playback in sync across cuts, mixes audio through Web Audio, and records the export with `canvas.captureStream()` and `MediaRecorder`. On desktop, `src/lib/fastExport.ts` instead pulls frames from FFmpeg (`electron/main.cjs`), encodes them with WebCodecs and muxes with `mp4-muxer`, then FFmpeg mixes the audio. Fonts are bundled, so the app works offline.

FFmpeg is bundled via `ffmpeg-static` (GPL-3.0 build). If you distribute the app, include its licence and offer the corresponding source.
