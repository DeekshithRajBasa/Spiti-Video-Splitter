'use strict'
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('app:info'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null
    } catch {
      return null
    }
  },
  saveDialog: (name, ext) => ipcRenderer.invoke('dialog:save', name, ext),
  tempPath: (ext) => ipcRenderer.invoke('tmp:path', ext),
  openFile: (path) => ipcRenderer.invoke('file:open', path),
  write: (id, position, data) => ipcRenderer.invoke('file:write', id, position, data),
  closeFile: (id) => ipcRenderer.invoke('file:close', id),
  removeFile: (path) => ipcRenderer.invoke('file:remove', path),
  decodeStart: (opts) => ipcRenderer.invoke('decode:start', opts),
  decodeNext: (id) => ipcRenderer.invoke('decode:next', id),
  decodeStop: (id) => ipcRenderer.invoke('decode:stop', id),
  mux: (job) => ipcRenderer.invoke('mux', job),
  onMuxProgress: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('mux:progress', h)
    return () => ipcRenderer.removeListener('mux:progress', h)
  },
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
  fileStat: (path) => ipcRenderer.invoke('file:stat', path),
  openVideo: (path) => ipcRenderer.invoke('shell:open', path),
  setTitlebarTheme: (dark) => ipcRenderer.invoke('titlebar:theme', dark),
  linkEnsure: () => ipcRenderer.invoke('link:ensure'),
  linkInfo: (url) => ipcRenderer.invoke('link:info', url),
  linkDownload: (opts) => ipcRenderer.invoke('link:download', opts),
  linkWait: (id) => ipcRenderer.invoke('link:wait', id),
  linkStop: (id) => ipcRenderer.invoke('link:stop', id),
  onLinkProgress: (cb) => {
    const h = (_e, p) => cb(p)
    ipcRenderer.on('link:progress', h)
    return () => ipcRenderer.removeListener('link:progress', h)
  },
  mediaUrl: (path) => ipcRenderer.invoke('media:url', path),
  openMediaDialog: () => ipcRenderer.invoke('dialog:openMedia'),
  folderDialog: () => ipcRenderer.invoke('dialog:folder'),
  audioPcm: (opts) => ipcRenderer.invoke('audio:pcm', opts),
  request: (req) => ipcRenderer.invoke('net:request', req),
  secretGet: (name) => ipcRenderer.invoke('secret:get', name),
  secretSet: (name, value) => ipcRenderer.invoke('secret:set', name, value),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateSetAuto: (on) => ipcRenderer.invoke('update:setAuto', on),
  onUpdateState: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('update:state', h)
    return () => ipcRenderer.removeListener('update:state', h)
  },
  takeDeepLinks: () => ipcRenderer.invoke('deeplink:take'),
  onDeepLink: (cb) => {
    const h = () => cb()
    ipcRenderer.on('deeplink', h)
    return () => ipcRenderer.removeListener('deeplink', h)
  },
  onMenu: (cb) => {
    const h = (_e, cmd) => cb(cmd)
    ipcRenderer.on('menu', h)
    return () => ipcRenderer.removeListener('menu', h)
  },
})
