const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  
  registerShortcut: (id, shortcut) => ipcRenderer.invoke('shortcut:register', { id, shortcut }),
  unregisterShortcut: (shortcut) => ipcRenderer.invoke('shortcut:unregister', shortcut),
  unregisterAllShortcuts: () => ipcRenderer.invoke('shortcut:unregisterAll'),
  
  saveRecordedAudio: (arrayBuffer) => ipcRenderer.invoke('audio:saveRecord', arrayBuffer),
  saveRecordedSnippet: (arrayBuffer) => ipcRenderer.invoke('audio:saveSnippet', arrayBuffer),
  
  openNvidia: () => ipcRenderer.invoke('util:openNvidia'),
  
  onShortcutTriggered: (callback) => ipcRenderer.on('shortcut:triggered', (_event, id) => callback(id))
});
