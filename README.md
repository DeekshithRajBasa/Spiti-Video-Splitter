# Spiti Video Splitter

Turn widescreen podcasts, live streams and gameplay into vertical clips for Shorts, Reels and TikTok, entirely in your browser. Nothing is uploaded; decoding, compositing and encoding all happen on your machine.

## Auto clip: paste a link, get clips

**Copy a link and paste it anywhere in the app** (Ctrl/⌘+V). It switches to Auto clip and starts on its own: download, captions, best moments, and the top clip opens ready to export. Turn this off with **Start as soon as I paste a link**.

| Where | YouTube / Twitch / other sites |
| --- | --- |
| Desktop app | Works directly. |
| Web, with a [link server](#link-server-youtube-in-the-web-version) | Works directly. |
| Web, without one | **Clip it in the desktop app** opens the desktop app (via a `spiti://` link) and it starts clipping there. |

1. **Paste a link** in the Auto clip tab, or open a video file.
   - Desktop app: YouTube, Twitch (VODs, clips, live), Kick, X, Instagram, TikTok, Facebook, Vimeo and 1,000+ other sites through [yt-dlp](https://github.com/yt-dlp/yt-dlp). It installs itself on first use (checksum-verified) and updates daily. Choose the quality, optionally download only part of a long VOD (From / To).
   - **Live streams**: record from now (or from the start, on YouTube), stop after N minutes or press **Stop & clip** whenever you like. The recording is converted to MP4 and clipped straight away.
   - Web: direct video-file links only, because browsers block downloads from YouTube/Twitch.
2. **Auto captions**: Whisper runs on your device (WebGPU when available, otherwise CPU) with word-level timestamps, so captions animate in sync with each word. 8 models from Tiny (41 MB) to Large v3 Turbo, 99 languages. Settings → Speech to text shows which models suit your device and which are already downloaded.
3. **Find clips** with one of three modes:
   - **Local**: offline scoring of hooks, questions, numbers, emotion, pace, loudness peaks and payoff. Nothing leaves your device.
   - **AI**: a language model ranks the moments and writes a title and on-screen hook for each.
     - On your computer: **Ollama**, **LM Studio** or any OpenAI-compatible server (llama.cpp, Jan, vLLM, LocalAI). The app detects installed models and recommends ones that work well (Qwen 3, Gemma 3, Llama 3.x, Phi-4 Mini, Mistral Nemo), with RAM needs and install commands.
     - Cloud, with your own key: **Claude**, **OpenAI**, **Gemini**, **OpenRouter**, **Groq** or a custom endpoint. Only the transcript text is sent, never the video.
   - **Auto** (default): uses AI when it's set up and reachable, and falls back to Local otherwise.
4. Each clip is applied in one click: cut to the moment, captioned, with its hook as the headline. **Preview**, **Edit**, **Export**, or **Export all** to a folder.

Long VODs: set In/Out first to transcribe only part of the video.

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
- **Renders panel**: every video you export appears in a panel on the right (open it from the top bar or the left rail). Play it right there, see its size and resolution, **Show in Finder/Explorer**, open it in your video player, copy its path, or remove it from the list. The desktop app remembers your renders across restarts and flags files you've since moved or deleted; the web version keeps the last 8 for the session. Export all shows the whole batch together when it finishes.
- Light and dark mode, settings autosave locally, keyboard shortcuts for everything (press `?`).

## Updates (desktop apps)

The desktop app checks for a new version a few seconds after it starts and every 6 hours. When one is found, a small snackbar appears at the bottom-left ("Version 1.3.0 is available / ready"), a small **Update** button appears in the top-right corner, and a dot appears on the bottom-left rail. Updates download in the background; click **Restart to update** (or just quit the app) and it installs and reopens on the new version. Turn background downloads off, check manually, or see the current version in **Settings → App → Updates**.

| Platform | How it updates |
| --- | --- |
| Windows | `electron-updater`: checksum-verified, only the changed parts are downloaded, silent install, then the app reopens. |
| macOS | Apps without an Apple Developer certificate can't use macOS's own updater, so the app downloads the release `.zip`, verifies its SHA-256, and swaps itself into place after you quit (the old copy is restored if anything goes wrong). It needs the app to be in a folder you can write to, normally Applications; from a disk image it offers a manual download instead. |
| Linux | `electron-updater` for the AppImage build. |

The first updater-enabled version has to be installed by hand once; after that, updates are in-app.

### Where updates come from

The app reads the public GitHub releases of this repository (the `publish` block in `electron-builder.yml`), so no token or extra setup is needed.

If you ever make the repository private again, the app can still update: either paste a fine-grained, read-only **Contents** token in **Settings → App → Updates → Releases are private?** (stored in the system keychain), or publish releases to a separate public releases-only repo by setting `publish.repo` in `electron-builder.yml`, the repository variable `RELEASES_REPO` (`owner/name`) and the secret `RELEASES_TOKEN` (Contents: read and write on that repo). Installed apps remember where to look, so make that change before shipping the version people install.

### Releasing an update

Bump `version` in `package.json`, merge to `main`, then run **Actions → Desktop apps → Run workflow** with the new tag (for example `v1.3.1`). Installed apps pick it up on their next check.

## Web and mobile

The web version runs on desktop and mobile browsers. On phones the editor switches to a single-column layout: preview on top, panels in a swipeable tab bar, and a touch-friendly timeline. Add it to your home screen to use it like an app.

### Hosting on Cloudflare Pages

The web version deploys to Cloudflare Pages (free plan is enough; works with private repos). Cloudflare serves `public/_headers`, which makes the page cross-origin isolated so on-device captions use every CPU core.

Set it up once in the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick this repository, then set:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build:cloudflare` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |

Cloudflare then rebuilds on every push: `main` goes to production (`https://<project>.pages.dev`), and every other branch gets its own preview URL.

Add a custom domain under the project's **Custom domains** tab.

`npm run build:cloudflare` differs from `npm run build` in one way: the 26 MB WebGPU speech runtime is over Cloudflare's 25 MiB per-file limit, so that file loads from jsDelivr instead of your site. The build checks that no other file is over the limit.

### Link server (YouTube in the web version)

Browsers can't download from YouTube, Twitch and similar sites. The link server in `server/` is a small Docker container (Node + yt-dlp + FFmpeg) that downloads links for the web app. Run it yourself, ideally at home: YouTube often blocks downloads from cloud and datacenter servers ("Sign in to confirm you're not a bot").

```bash
cd server
# edit docker-compose.yml: set ACCESS_TOKEN and ALLOWED_ORIGINS (your web app's address)
docker compose up -d
```

Then in the web app open **Settings → App → Link server**, enter the server's URL (e.g. `http://localhost:8787`) and the same access token, and press **Test connection**. A web app served over HTTPS can reach `http://localhost`, but a server elsewhere needs HTTPS too: put it behind a reverse proxy, or a Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:8787`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `ACCESS_TOKEN` | (none) | Required in practice. Without it anyone who finds the server can use it. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated web app origins allowed to call it. |
| `MAX_HEIGHT` | `1080` | Highest download resolution. |
| `MAX_DURATION_MINUTES` | `240` | Longer videos need a From/To range. |
| `MAX_LIVE_MINUTES` | `120` | Longest live recording. |
| `MAX_CONCURRENT_JOBS` | `2` | Downloads at once. |
| `FILE_TTL_MINUTES` | `60` | Finished files are deleted after this (or as soon as the web app has them). |
| `COOKIES_FILE` | (none) | A browser-exported `cookies.txt`, for videos that need a signed-in account. |

Without Docker: install yt-dlp and FFmpeg, then `ACCESS_TOKEN=… ALLOWED_ORIGINS=… node server/server.mjs`.

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
- Link import and live-stream recording (see Auto clip above), with downloads saved to Videos → Spiti Downloads. YouTube needs a JavaScript runtime; the app supplies its own, so nothing else needs installing.
- Opens `spiti://clip?url=…` links, so the web version can hand a link over and clipping starts here.
- API keys for cloud AI are encrypted with your OS keychain.
- Fully offline: fonts and FFmpeg ship inside the app. Speech models download once and are cached.

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

Set `SPITI_DEBUG=1` to log the FFmpeg and yt-dlp commands the desktop app runs. `SPITI_YTDLP` and `SPITI_FFMPEG` point the app at your own yt-dlp or FFmpeg binaries. (On Linux, live recording uses the system FFmpeg when installed, because the bundled static build can't read network streams.)

Downloading from YouTube and most platforms is allowed by their terms only for content you own or have permission to use.

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
