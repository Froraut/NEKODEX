// Focused Electron boundary check: no account, network request or installed profile.
const { app, BrowserWindow, WebContentsView } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { BrowserHost } = require('../electron/browser-host.cjs');

const directory = mkdtempSync(join(tmpdir(), 'nekodex-shell-recovery-'));
app.setPath('userData', directory);
app.disableHardwareAcceleration();
const windows = [], views = [];
const watchdog = setTimeout(() => { console.error('Shell recovery check timed out'); app.exit(1); }, 15_000);
app.whenReady().then(async () => {
  const makeWindow = () => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    windows.push(window); return window;
  };
  const previous = makeWindow();
  await previous.loadURL('data:text/html,<title>Isolated old shell</title>');
  const view = new WebContentsView({ webPreferences: { sandbox: true, partition: 'isolated-task' } });
  views.push(view);
  previous.contentView.addChildView(view);
  await view.webContents.loadURL('data:text/html,<input id="draft" value="retained draft"><p>Existing task</p>');
  const processId = view.webContents.getOSProcessId();
  const session = view.webContents.session;
  const host = { window: previous, view, authView: null, turnTabs: new Map(),
    shellZoomShortcutBindings: new Map(), windowVisibilityListener() {},
    bindShellZoomShortcuts: BrowserHost.prototype.bindShellZoomShortcuts, syncViewVisibility() {} };
  const gone = once(previous.webContents, 'render-process-gone');
  previous.webContents.forcefullyCrashRenderer();
  await gone;
  assert.equal(previous.webContents.isCrashed(), true);
  const replacement = makeWindow();
  BrowserHost.prototype.replaceShellWindow.call(host, replacement);
  await replacement.loadURL('data:text/html,<title>Recovered shell</title>');
  previous.destroy();
  assert.equal(host.window, replacement);
  assert.equal(view.webContents.isDestroyed(), false);
  assert.equal(view.webContents.getOSProcessId(), processId);
  assert.equal(view.webContents.session, session);
  assert.equal(await view.webContents.executeJavaScript('document.getElementById("draft").value'), 'retained draft');
  assert.equal(replacement.webContents.mainFrame.detached, false);
  assert.equal(replacement.contentView.children.includes(view), true);
  console.log('SHELL_RECREATION_PRESERVED_BROWSER_PROCESS_SESSION_AND_DRAFT');
}).then(() => finish(0), error => { console.error(error); finish(1); });

function finish(code) {
  clearTimeout(watchdog);
  for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  app.exit(code);
}
process.on('exit', () => { rmSync(directory, { recursive: true, force: true }); });
