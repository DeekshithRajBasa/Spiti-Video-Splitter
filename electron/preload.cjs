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
  setTitlebarTheme: (dark) => ipcRenderer.invoke('titlebar:theme', dark),
  onMenu: (cb) => {
    const h = (_e, cmd) => cb(cmd)
    ipcRenderer.on('menu', h)
    return () => ipcRenderer.removeListener('menu', h)
  },
})
