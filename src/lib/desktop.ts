/** Bridge exposed by electron/preload.cjs. Undefined when running in a normal browser. */
export interface MuxJob {
  video: string
  output: string
  duration: number
  reencode: boolean
  voice?: { file: string; volume: number; segments: { start: number; end: number }[] }
  music?: { file: string; offset: number; volume: number; peak: number; riser: number }
  sfx: { file: string; at: number; volume: number }[]
}

export interface DesktopBridge {
  info(): Promise<{ platform: 'win32' | 'darwin' | 'linux'; version: string; ffmpeg: boolean }>
  pathForFile(f: File): string | null
  saveDialog(name: string, ext: string): Promise<string | null>
  tempPath(ext: string): Promise<string>
  openFile(path: string): Promise<number>
  write(id: number, position: number, data: Uint8Array): Promise<void>
  closeFile(id: number): Promise<void>
  removeFile(path: string): Promise<void>
  decodeStart(o: { file: string; start: number; duration: number; fps: number; maxHeight: number }): Promise<number>
  decodeNext(id: number): Promise<Uint8Array | null>
  decodeStop(id: number): Promise<void>
  mux(job: MuxJob): Promise<void>
  onMuxProgress(cb: (p: number) => void): () => void
  reveal(path: string): Promise<void>
  fileStat(path: string): Promise<{ exists: boolean; size: number }>
  /** Opens the file in the default video player. Resolves to an error message, or '' on success. */
  openVideo(path: string): Promise<string>
  setTitlebarTheme(dark: boolean): Promise<void>
  onMenu(cb: (cmd: string) => void): () => void
  linkEnsure(): Promise<string>
  linkInfo(url: string): Promise<LinkInfo>
  linkDownload(o: { url: string; maxHeight: number; start?: number; end?: number; live?: 'now' | 'start'; maxMinutes?: number }): Promise<number>
  linkWait(id: number): Promise<DiskFile>
  linkStop(id: number): Promise<boolean>
  onLinkProgress(cb: (p: LinkProgress) => void): () => void
  mediaUrl(path: string): Promise<string>
  openMediaDialog(): Promise<DiskFile[]>
  folderDialog(): Promise<string | null>
  audioPcm(o: { file: string; start: number; duration?: number }): Promise<Uint8Array>
  request(r: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }): Promise<{ status: number; ok: boolean; text: string }>
  secretGet(name: string): Promise<string>
  secretSet(name: string, value: string): Promise<void>
  updateState(): Promise<UpdateState>
  updateCheck(): Promise<UpdateState>
  updateDownload(): Promise<unknown>
  updateInstall(): Promise<boolean>
  updateSetAuto(on: boolean): Promise<void>
  onUpdateState(cb: (s: UpdateState) => void): () => void
  takeDeepLinks(): Promise<string[]>
  onDeepLink(cb: () => void): () => void
}

export interface UpdateState {
  supported: boolean
  reason: string
  platform: string
  current: string
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'
  version: string
  notes: string
  url: string
  percent: number
  speed: number
  transferred: number
  total: number
  error: string
  needsToken: boolean
  hasToken: boolean
  /** macOS: the app can't replace itself here (e.g. running from the disk image). */
  manualInstall: boolean
  lastChecked: number
  autoDownload: boolean
}

export interface DiskFile {
  file: string
  url: string
  name: string
  size: number
}

export interface LinkInfo {
  title: string
  duration: number
  isLive: boolean
  wasLive: boolean
  site: string
  uploader: string
  thumbnail: string
  url: string
  height: number
}

export interface LinkProgress {
  id: number
  status: 'installing' | 'downloading' | 'recording' | 'processing'
  percent?: number | null
  speed?: string
  eta?: string
  downloaded?: string
  elapsed?: number
}

export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop

export type DesktopInfo = Awaited<ReturnType<DesktopBridge['info']>>
export let desktopInfo: DesktopInfo | null = null
export const desktopReady: Promise<DesktopInfo | null> = desktop
  ? desktop.info().then((i) => (desktopInfo = i))
  : Promise.resolve(null)
