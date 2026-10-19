// Focused Electron boundary check: no account, network request or installed profile.
const { app, BrowserWindow, WebContentsView } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { BrowserHost, bindRendererSurfaceInvalidation } = require('../electron/browser-host.cjs');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');

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
    bindShellZoomShortcuts: BrowserHost.prototype.bindShellZoomShortcuts, syncViewVisibility() {}, setState() {},
    invalidateRendererSurface: BrowserHost.prototype.invalidateRendererSurface };
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
  if (process.env.NEKODEX_SHELL_CHECK === 'renderer-document') {
    const pool = { hosts: new Map([['fixture', host]]), bounds: null, surfaceActive: false, rendererZoomFactor: 1,
      invalidateRendererSurface: AccountBrowserPool.prototype.invalidateRendererSurface,
      setBounds: AccountBrowserPool.prototype.setBounds };
    Object.assign(host, { setBounds: BrowserHost.prototype.setBounds,
      setSurfaceActive: BrowserHost.prototype.setSurfaceActive, snapshot: () => ({}) });
    let currentWindow = replacement;
    bindRendererSurfaceInvalidation(replacement, () => currentWindow, () => pool);
    pool.setBounds({ x: 10, y: 10, width: 400, height: 300 });
    host.setSurfaceActive(true); pool.surfaceActive = true;
    replacement.webContents.emit('did-start-navigation', {}, 'about:blank#same', true, true);
    replacement.webContents.emit('did-start-navigation', {}, 'about:blank', false, false);
    assert.equal(host.boundsReady, true, 'Same-document/subframe navigation revoked the viewport');
    const loaded = once(replacement.webContents, 'did-finish-load');
    replacement.webContents.reload();
    await loaded;
    assert.equal(pool.bounds, null);
    assert.equal(pool.surfaceActive, false);
    assert.equal(host.boundsReady, false);
    assert.equal(host.surfaceActive, false);
    for (const candidate of [view, running]) {
      const [width, height] = replacement.getContentSize();
      assert.ok(candidate.getBounds().x >= width && candidate.getBounds().y >= height);
      assert.equal(candidate.webContents.isDestroyed(), false);
    }
    host.setSurfaceActive(true);
    assert.equal(host.boundsReady, false, 'Activation alone reused old document bounds');
    pool.setBounds({ x: 20, y: 20, width: 500, height: 350 });
    assert.equal(host.boundsReady, true);
    assert.equal(pool.bounds.width, 500);
    currentWindow = null;
    replacement.webContents.emit('did-start-navigation', {}, 'about:blank', false, true);
    assert.equal(host.boundsReady, true, 'An obsolete window invalidated the current registration');
    currentWindow = replacement;
    assert.equal(view.webContents.getOSProcessId(), processId);
    assert.equal(view.webContents.session, session);
    assert.equal(running.webContents.getOSProcessId(), runningProcessId);
    assert.equal(await view.webContents.executeJavaScript('document.getElementById("draft").value'), 'retained draft');
    assert.equal(await running.webContents.executeJavaScript('document.getElementById("draft").value'), 'running draft');
    console.log('SHELL_DOCUMENT_RELOAD_REVOKED_VIEWPORT_AND_PRESERVED_CONTEXTS');
    return;
  }
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
