const { randomUUID } = require('node:crypto');
const allWindows = new Set();
const MAX_WINDOWS = 16;
const HOME = 'https://chatgpt.com/?temporary-chat=true';

// User browsing has its own WebContents. It never re-parents or navigates a task-owned tab.
class BrowserWorkspaceWindows {
  constructor({ BrowserWindow, session, accountId, label, allowedUrl, register, unregister, external, onAuthNavigation,
    platform = process.platform, home = HOME }) {
    Object.assign(this, { BrowserWindow, session, accountId, label, allowedUrl, register, unregister, external, onAuthNavigation, platform, home });
    this.windows = new Set();
    this.lastWindow = null;
  }
  options(group = `nekodex-browser-${this.accountId}-${randomUUID()}`) {
    return { width: 1100, height: 800, minWidth: 480, minHeight: 360, show: false,
      title: `${this.label} — NEKODEX Browser`, autoHideMenuBar: false,
      ...(this.platform === 'darwin' ? { tabbingIdentifier: group } : {}),
      webPreferences: { session: this.session, nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false } };
  }
  open({ asTab = false } = {}) {
    if (allWindows.size >= MAX_WINDOWS) throw new Error('Close an unused browser tab or window before opening another (limit 16)');
    const anchor = this.lastWindow && !this.lastWindow.isDestroyed() ? this.lastWindow : [...this.windows][0];
    const win = new this.BrowserWindow(this.options(asTab ? anchor?.tabbingIdentifier : undefined));
    this.bind(win);
    if (asTab && anchor && this.platform === 'darwin') anchor.addTabbedWindow(win);
    win.loadURL(this.home).catch(() => { if (!win.isDestroyed()) win.setTitle(`${this.label} — Page unavailable`); });
    win.show(); win.focus();
    return win;
  }
  bind(win) {
    const contents = win.webContents;
    this.windows.add(win); allWindows.add(win); this.lastWindow = win;
    this.register(contents, win);
    win.on('focus', () => { this.lastWindow = win; });
    win.once('closed', () => {
      this.unregister(contents); this.windows.delete(win); allWindows.delete(win);
      if (this.lastWindow === win) this.lastWindow = [...this.windows].at(-1) ?? null;
    });
    contents.on('page-title-updated', (event, title) => { event.preventDefault(); win.setTitle(`${this.label} — ${title || 'NEKODEX Browser'}`); });
    const navigation = (event, url) => {
      if (!this.allowedUrl(url)) { event.preventDefault(); void this.external(contents, url); }
    };
    contents.on('will-navigate', navigation);
    contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => { if (isMainFrame) navigation(event, url); });
    contents.on('did-navigate', (_event, url) => { void this.onAuthNavigation?.(url); });
    contents.setWindowOpenHandler(({url}) => {
      if (!this.allowedUrl(url)) { void this.external(contents, url); return {action:'deny'}; }
      if (allWindows.size >= MAX_WINDOWS) return {action:'deny'};
      // Electron preserves OAuth POST/referrer semantics; never pass privileged preferences.
      return {action:'allow', overrideBrowserWindowOptions:this.options(win.tabbingIdentifier)};
    });
    contents.on('did-create-window', child => {
      if (allWindows.size >= MAX_WINDOWS) { child.destroy(); return; }
      this.bind(child);
      if (this.platform === 'darwin' && !win.isDestroyed()) win.addTabbedWindow(child);
      child.show(); child.focus();
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      const command = this.platform === 'darwin' ? input.meta : input.control;
      if (command && !input.alt && ['t','n'].includes(input.key.toLowerCase())) {
        event.preventDefault();
        try { this.open({asTab:input.key.toLowerCase()==='t'}); } catch { /* Keep existing windows at capacity. */ }
      } else if (this.platform === 'darwin' && input.control && input.key === 'Tab') {
        event.preventDefault(); input.shift ? win.selectPreviousTab() : win.selectNextTab();
      }
    });
  }
  async closeAll() {
    for (const win of [...this.windows]) {
      if (win.isDestroyed()) continue;
      const contents = win.webContents;
      await new Promise((resolve, reject) => {
        const finish = error => { clearTimeout(timer); win.removeListener('closed', closed);
          contents.removeListener('will-prevent-unload', blocked); error ? reject(error) : resolve(); };
        const closed = () => finish();
        const blocked = () => finish(new Error('Finish or save work in the browser window before quitting NEKODEX'));
        const timer = setTimeout(blocked, 5000);
        win.once('closed', closed); contents.once('will-prevent-unload', blocked); win.close();
      });
    }
  }
  destroy() { for (const win of [...this.windows]) if (!win.isDestroyed()) win.destroy(); }
}
module.exports = { BrowserWorkspaceWindows };
