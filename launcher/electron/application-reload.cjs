// Native menu shortcuts must use the same account/turn owner as the toolbar.
// Electron's built-in reload role can otherwise target a child page without its lease checks.
async function reloadApplicationPage({ focusedContents, focusedWindow, mainWindow, browserPool, reloadShell, ignoreCache = false }) {
  let contents = focusedContents ?? focusedWindow?.webContents;
  if (!contents || contents.isDestroyed?.()) throw new Error("No browser page is available to reload");
  const shell = mainWindow?.webContents;
  if (contents === shell) {
    if (!browserPool?.surfaceActive || !browserPool.snapshot().visible) {
      return reloadShell(mainWindow);
    }
    contents = browserPool.selectedHost().activeView().webContents;
  }
  for (const host of browserPool?.hosts?.values() ?? []) {
    const apiPanel = host.ownsApiPanelContents?.(contents);
    const workspace = host.workspaceBrowser?.ownsContents(contents);
    const embedded = [host.view, host.authView, ...[...(host.turnTabs?.values() ?? [])].map(tab => tab.view)]
      .some(view => view?.webContents === contents);
    if (!apiPanel && !workspace && !embedded) continue;
    // An explicit recovery action replaces a background check, not a submitted task.
    if (host.readOnlyInspection) await host.cancelReadOnlyInspection();
    const busy = browserPool.accountOperationError?.(host.accountId);
    if (busy) throw busy;
    host.assertUserNavigationAllowed();
    if (apiPanel) return host.reloadApiPanelContents(contents);
    if (workspace) return host.workspaceBrowser.reloadContents(contents, { ignoreCache });
    if (ignoreCache) contents.reloadIgnoringCache(); else contents.reload();
    return true;
  }
  throw new Error("This window has no reloadable browser page");
}

module.exports = { reloadApplicationPage };
