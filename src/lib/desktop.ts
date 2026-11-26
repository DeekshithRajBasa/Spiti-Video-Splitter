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
  setTitlebarTheme(dark: boolean): Promise<void>
  onMenu(cb: (cmd: string) => void): () => void
}

export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop

export type DesktopInfo = Awaited<ReturnType<DesktopBridge['info']>>
export let desktopInfo: DesktopInfo | null = null
export const desktopReady: Promise<DesktopInfo | null> = desktop
  ? desktop.info().then((i) => (desktopInfo = i))
  : Promise.resolve(null)
