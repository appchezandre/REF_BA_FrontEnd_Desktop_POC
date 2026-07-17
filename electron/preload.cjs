const { contextBridge, ipcRenderer } = require('electron');

// Liste blanche des canaux d'événements main -> renderer.
const EVENT_CHANNELS = new Set(['window:maximized-changed', 'sync:event']);

function subscribe(channel, listener) {
  if (!EVENT_CHANNELS.has(channel)) {
    throw new Error(`Canal non autorisé : ${channel}`);
  }
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

// API minimale exposée au renderer — jamais ipcRenderer directement.
contextBridge.exposeInMainWorld('desktopAPI', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    getPlatform: () => Promise.resolve(process.platform)
  },
  windows: {
    getContext: () => ipcRenderer.invoke('window:get-context'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    close: () => ipcRenderer.invoke('window:close'),
    detachTab: (request) => ipcRenderer.invoke('window:detach-tab', request),
    onMaximizedChanged: (listener) =>
      subscribe('window:maximized-changed', listener)
  },
  sync: {
    publish: (topic, data) => ipcRenderer.invoke('sync:publish', { topic, data }),
    getState: (topic) => ipcRenderer.invoke('sync:get-state', topic),
    onEvent: (listener) => subscribe('sync:event', listener)
  }
});
