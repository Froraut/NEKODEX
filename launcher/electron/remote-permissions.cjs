// Electron 41 grants most permissions when no handler is installed. Both handlers must
// remain installed for the lifetime of this private session, including host teardown.
// https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler
const CLIPBOARD_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write"]);
const PROMPT_TIMEOUT_MS = 60_000;

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      ? url.origin : null;
  } catch { return null; }
}

function createRemotePermissionPolicy({
  session,
  isAllowedPage,
  isVisible,
  requestConsent,
  promptTimeoutMs = PROMPT_TIMEOUT_MS,
}) {
  const owned = new Map();
  let disposed = false;
  let pending = null;

  function contextFor(contents, details, requestingOrigin) {
    const record = owned.get(contents);
    if (disposed || !record || contents.isDestroyed() || contents.session !== session
      || details?.isMainFrame !== true || !isVisible(contents)) return null;
    const currentUrl = contents.getURL();
    const origin = httpsOrigin(currentUrl);
    // Full committed URL equality also prevents a stale same-origin request from being
    // approved after navigation. Origin alone is insufficient for an async consent dialog.
    if (!origin || details.requestingUrl !== currentUrl
      || !isAllowedPage(currentUrl, record.kind)
      || httpsOrigin(details.requestingUrl) !== origin
      || (requestingOrigin !== undefined && httpsOrigin(requestingOrigin) !== origin)
      || (details.embeddingOrigin !== undefined && httpsOrigin(details.embeddingOrigin) !== origin)
      || (details.securityOrigin !== undefined && httpsOrigin(details.securityOrigin) !== origin)) return null;
    return { record, generation: record.generation, currentUrl, origin };
  }

  function finishPending(granted) {
    const request = pending;
    if (!request) return;
    pending = null;
    clearTimeout(request.timer);
    request.controller.abort();
    // A renderer can disappear before Electron consumes its callback.
    try { request.callback(granted === true); } catch {}
  }

  function unregister(contents) {
    const record = owned.get(contents);
    if (!record) return;
    if (pending?.contents === contents) finishPending(false);
    owned.delete(contents);
    contents.off("did-start-navigation", record.onNavigation);
    contents.off("render-process-gone", record.onInvalidated);
    contents.off("destroyed", record.onDestroyed);
  }

  function register(contents, kind = "chatgpt") {
    if (disposed || contents.isDestroyed() || contents.session !== session) {
      throw new Error("Remote browser permission ownership is invalid");
    }
    if (owned.has(contents)) return;
    const record = { kind, generation: 0 };
    record.onInvalidated = () => {
      record.generation += 1;
      if (pending?.contents === contents) finishPending(false);
    };
    record.onNavigation = (event, _url, _inPlace, mainFrame) => {
      // Electron's current event carries named details; retain legacy event arguments
      // for host fixtures/older events, never interpreting a child navigation as main.
      if (event?.isMainFrame === true || mainFrame === true) record.onInvalidated();
    };
    record.onDestroyed = () => unregister(contents);
    owned.set(contents, record);
    contents.on("did-start-navigation", record.onNavigation);
    contents.on("render-process-gone", record.onInvalidated);
    contents.once("destroyed", record.onDestroyed);
  }

  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    // No persistent or silent grants, even on an owned main frame. Returning false
    // sends supported clipboard APIs through the explicit one-request consent path.
    try {
      if (!CLIPBOARD_PERMISSIONS.has(permission)
        || !contextFor(contents, details, requestingOrigin)) return false;
    } catch { return false; }
    return false;
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    let context;
    try { context = contextFor(contents, details); } catch { context = null; }
    if (!CLIPBOARD_PERMISSIONS.has(permission) || !context || pending) {
      callback(false);
      return;
    }
    const request = { contents, callback, controller: new AbortController() };
    pending = request;
    request.timer = setTimeout(() => {
      if (pending === request) finishPending(false);
    }, promptTimeoutMs);
    request.timer.unref?.();
    Promise.resolve().then(() => pending === request ? requestConsent({
      permission, origin: context.origin, signal: request.controller.signal,
    }) : false).then(granted => {
      if (pending !== request) return;
      const current = contextFor(contents, details);
      finishPending(granted === true && current !== null
        && current.record === context.record && current.generation === context.generation);
    }).catch(() => { if (pending === request) finishPending(false); });
  });
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  // Keep Chromium's restricted-path boundary intact. Standard <input type=file>,
  // user-initiated downloads and native copy/paste do not need broad fileSystem grants.
  const restrictedPath = (_event, _details, callback) => callback("deny");
  session.on("file-system-access-restricted", restrictedPath);

  return {
    register,
    unregister,
    refreshVisibility() {
      if (pending && !isVisible(pending.contents)) finishPending(false);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      finishPending(false);
      for (const contents of owned.keys()) unregister(contents);
      session.off("file-system-access-restricted", restrictedPath);
      // Do not reset to null: that restores Electron's permissive defaults. Replace
      // closures with inert deny handlers so a destroyed host is not retained.
      session.setPermissionCheckHandler(() => false);
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setDevicePermissionHandler(() => false);
      session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    },
  };
}

module.exports = { createRemotePermissionPolicy, httpsOrigin };
