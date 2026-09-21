const { contextBridge, ipcRenderer } = require('electron');

const CHANNEL = 'nekodex:chrome-profile-picker';
contextBridge.exposeInMainWorld('nekodexChromeProfiles', Object.freeze({
  ready: () => ipcRenderer.send(CHANNEL, { type: 'ready' }),
  cancel: () => ipcRenderer.send(CHANNEL, { type: 'cancel' }),
  createNew: () => ipcRenderer.send(CHANNEL, { type: 'new' }),
  select: id => ipcRenderer.send(CHANNEL, { type: 'select', id }),
  receive: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.once(CHANNEL, (_event, value) => callback(value));
  },
}));
