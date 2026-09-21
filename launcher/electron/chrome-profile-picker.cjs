const path = require('node:path');

const PICKER_CHANNEL = 'nekodex:chrome-profile-picker';

function normalizedSearch(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase().slice(0, 160)
    : '';
}

function filterChromeProfiles(profiles, query) {
  const search = normalizedSearch(query);
  if (!search) return [...profiles];
  return profiles.filter(profile => [profile.name, profile.googleEmail, profile.id]
    .some(value => normalizedSearch(value).includes(search)));
}

function showChromeProfilePicker({ BrowserWindow, parent, profiles, selectedId = null, language = 'en', signal }) {
  if (typeof BrowserWindow !== 'function') throw new Error('Chrome profile picker window is unavailable');
  if (!Array.isArray(profiles) || profiles.some(profile => !profile || typeof profile.id !== 'string')) {
    throw new Error('Chrome profile picker received an invalid profile list');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const picker = new BrowserWindow({
      width: 620,
      height: 610,
      minWidth: 440,
      minHeight: 430,
      parent: parent || undefined,
      modal: Boolean(parent),
      show: false,
      resizable: true,
      title: language === 'ru' ? 'Профиль Chrome' : 'Chrome profile',
      backgroundColor: '#111318',
      webPreferences: {
        preload: path.join(__dirname, 'chrome-profile-picker-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: false,
        spellcheck: false,
      },
    });
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', aborted);
      if (!picker.isDestroyed()) picker.destroy();
      error ? reject(error) : resolve(value);
    };
    const aborted = () => finish({ kind: 'cancel' });
    signal?.addEventListener('abort', aborted, { once: true });
    picker.webContents.on('will-navigate', event => event.preventDefault());
    picker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    picker.webContents.on('ipc-message', (_event, channel, message) => {
      if (channel !== PICKER_CHANNEL || !message || typeof message !== 'object' || Array.isArray(message)) return;
      if (message.type === 'ready') {
        picker.webContents.send(PICKER_CHANNEL, { type: 'profiles', language, selectedId,
          profiles: profiles.map(({ id, name, googleEmail }) => ({ id, name, googleEmail })) });
        return;
      }
      if (message.type === 'cancel' && Object.keys(message).length === 1) return finish({ kind: 'cancel' });
      if (message.type === 'new' && Object.keys(message).length === 1) return finish({ kind: 'new' });
      if (message.type === 'select' && Object.keys(message).length === 2 && typeof message.id === 'string') {
        const profile = profiles.find(candidate => candidate.id === message.id);
        if (profile) finish({ kind: 'existing', profile });
      }
    });
    picker.once('closed', () => finish({ kind: 'cancel' }));
    picker.once('ready-to-show', () => picker.show());
    picker.loadFile(path.join(__dirname, 'chrome-profile-picker.html')).catch(error => finish(null, error));
    if (signal?.aborted) aborted();
  });
}

module.exports = { filterChromeProfiles, normalizedSearch, showChromeProfilePicker };
