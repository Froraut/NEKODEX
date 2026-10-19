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
  // Non-browser screens unmount their slot observer. Native resize must keep
  // drawable primary/running views beyond the enlarged window without closing them.
  const running = new WebContentsView({ webPreferences: { sandbox: true, partition: 'isolated-running-task' } });
  views.push(running);
  replacement.contentView.addChildView(running);
  await running.webContents.loadURL('data:text/html,<input id="draft" value="running draft">');
  const runningProcessId = running.webContents.getOSProcessId();
  Object.assign(host, {
    visible: true, surfaceActive: false, boundsReady: true, bounds: { x: 0, y: 0, width: 1, height: 1 },
    primaryRendererReady: false, primaryDeviceEmulationViewport: null,
    isAccountVisible: () => true, selectedTurnTab: () => null,
    hiddenTurnBounds: BrowserHost.prototype.hiddenTurnBounds,
    presentPrimaryView: BrowserHost.prototype.presentPrimaryView,
    presentTurnView: BrowserHost.prototype.presentTurnView,
    syncViewVisibility: BrowserHost.prototype.syncViewVisibility,
  });
  host.turnTabs.set('running', { view: running, status: 'running', interactionMode: 'automatic', rendererReady: false });
  host.windowVisibilityListener = () => host.syncViewVisibility();
  // Use the production reparent/listener path, then let real Electron resize emit.
  const resized = makeWindow();
  resized.setContentSize(700, 500);
  BrowserHost.prototype.replaceShellWindow.call(host, resized);
  await resized.loadURL('data:text/html,<input id="shell-draft" value="usage draft">');
  replacement.destroy();
  const sizeChanged = once(resized, 'resize');
  resized.setContentSize(1600, 1000);
  await sizeChanged;
  const [width, height] = resized.getContentSize();
  for (const candidate of [view, running]) {
    const bounds = candidate.getBounds();
    assert.ok(bounds.x >= width && bounds.y >= height, 'Background view leaked into the enlarged shell');
    assert.equal(candidate.getVisible(), true);
    assert.equal(candidate.webContents.isDestroyed(), false);
  }
  assert.equal(view.webContents.getOSProcessId(), processId);
  assert.equal(running.webContents.getOSProcessId(), runningProcessId);
  assert.equal(await view.webContents.executeJavaScript('document.getElementById("draft").value'), 'retained draft');
  assert.equal(await running.webContents.executeJavaScript('document.getElementById("draft").value'), 'running draft');
  assert.equal(await resized.webContents.executeJavaScript('document.getElementById("shell-draft").value'), 'usage draft');
  console.log('NATIVE_RESIZE_KEPT_BACKGROUND_VIEWS_OFFSCREEN_WITH_PROCESSES_AND_DRAFTS');
}).then(() => finish(0), error => { console.error(error); finish(1); });

function finish(code) {
  clearTimeout(watchdog);
  for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
  for (const window of windows) if (!window.isDestroyed()) window.destroy();
  app.exit(code);
}
process.on('exit', () => { rmSync(directory, { recursive: true, force: true }); });
