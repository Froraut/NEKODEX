const { randomUUID } = require("node:crypto");
const {
  BrowserWorkspaceManifest,
  MAX_WORKSPACES,
  WORKSPACE_OVERFLOW_CODE,
  isTemporaryChat,
  normalizeBounds,
  safeWorkspaceLocation,
} = require("./browser-workspace-manifest.cjs");

const allWindows = new Set();
const HOME = "https://chatgpt.com/?temporary-chat=true";
const RESTORE_HOME = "https://chatgpt.com/";
const SESSION_MUTATION_PATH = /^\/(?:auth|login|logout|sign-in|signin|sign-up|signup|api\/auth)(?:\/|$)/i;
const abortedNavigation = error => error?.errno === -3 || error?.code === "ERR_ABORTED";

function potentialSessionMutation(value) {
  try {
    const location = new URL(value);
    return location.origin !== "https://chatgpt.com" || SESSION_MUTATION_PATH.test(location.pathname);
  } catch {
    return false;
  }
}

function visibleBounds(bounds, displays) {
  if (!bounds || !Array.isArray(displays) || displays.length === 0 || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
    return bounds;
  }
  const visible = displays.some(display => {
    const area = display?.workArea;
    return area && bounds.x < area.x + area.width && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height && bounds.y + bounds.height > area.y;
  });
  return visible ? bounds : { width: bounds.width, height: bounds.height };
}

function windowBounds(win) {
  const candidate = (win.isMaximized?.() || win.isFullScreen?.()) ? win.getNormalBounds?.() : win.getBounds?.();
  return normalizeBounds(candidate);
}

// User workspaces use the account's persistent session but never own task tabs.
// Session-changing actions are delegated to a per-account coordinator so the pool can
// gate new work without cancelling an unrelated task that already owns the account.
class BrowserWorkspaceWindows {
  constructor({
    BrowserWindow,
    session,
    accountId,
    label,
    allowedUrl,
    register,
    unregister,
    external,
    beginSessionMutation,
    ownsSessionMutation,
    onMutationBlocked,
    onNavigationState,
    onPersistenceError,
    getVerifiedPrincipal = () => null,
    onChanged,
    manifestPath,
    displays = () => [],
    platform = process.platform,
    home = HOME,
    restoreHome = RESTORE_HOME,
    persistLocations = true,
    isSessionMutation = potentialSessionMutation,
  }) {
    Object.assign(this, {
      BrowserWindow, session, accountId, label, allowedUrl, register, unregister, external,
      beginSessionMutation, ownsSessionMutation, onMutationBlocked, onNavigationState, onPersistenceError, getVerifiedPrincipal, onChanged, platform, home,
      restoreHome, displays, persistLocations, isSessionMutation,
    });
    this.windows = new Set();
    this.windowMeta = new Map();
    this.saved = new Map();
    this.lastWindow = null;
    this.manifest = new BrowserWorkspaceManifest(manifestPath, accountId);
    this.manifestLoaded = false;
    this.restoreAttempted = false;
    this.restorePrincipal = null;
    this.restoreResult = null;
    this.pendingPopupLeases = new Map();
    this.mutationLeasesByContents = new WeakMap();
    this.saveTimer = null;
    this.pendingCaptures = new Set();
    this.persistenceFailed = false;
  }

  ensureManifestLoaded() {
    if (this.manifestLoaded) return;
    if (!this.persistLocations) { this.manifestLoaded = true; return; }
    const manifest = this.manifest.read();
    this.saved = new Map(manifest.entries.map(entry => [entry.id, entry]));
    this.manifestLoaded = true;
  }

  options(groupId, bounds) {
    return {
      width: bounds?.width ?? 1_100,
      height: bounds?.height ?? 800,
      ...(Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y) ? { x: bounds.x, y: bounds.y } : {}),
      minWidth: 480,
      minHeight: 360,
      show: false,
      title: `${this.label} — NEKODEX Browser`,
      autoHideMenuBar: false,
      ...(this.platform === "darwin" && groupId ? { tabbingIdentifier: groupId } : {}),
      webPreferences: {
        session: this.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
      },
    };
  }

  open({ asTab = false, url = this.home, restored = null, anchorWindow = null } = {}) {
    this.ensureManifestLoaded();
    const target = restored?.location ?? url;
    if (!this.allowedUrl(target)) throw new Error("Browser destination is unavailable");
    if (asTab && this.platform !== "darwin") {
      throw new Error("Browser tabs are available on macOS. Open another browser window on this platform.");
    }
    if (allWindows.size >= MAX_WORKSPACES) {
      throw new Error(`Close an unused browser tab or window before opening another (limit ${MAX_WORKSPACES})`);
    }
    const anchor = anchorWindow && !anchorWindow.isDestroyed() ? anchorWindow
      : this.lastWindow && !this.lastWindow.isDestroyed() ? this.lastWindow : [...this.windows][0];
    const id = restored?.id ?? randomUUID();
    const groupId = restored?.groupId ?? (asTab && anchor
      ? this.windowMeta.get(anchor)?.groupId
      : `nekodex-browser-${this.accountId}-${randomUUID()}`);
    const bounds = visibleBounds(normalizeBounds(restored?.bounds), this.displays());
    let lease;
    if (this.isSessionMutation(target) && this.beginSessionMutation) {
      lease = this.beginSessionMutation({ sourceId: id, reason: "workspace-navigation", url: target });
    }
    let win;
    try {
      win = new this.BrowserWindow(this.options(groupId, bounds));
      this.bind(win, { id, groupId, preserveOnClose: false }, lease);
    } catch (error) {
      (win && this.mutationLeasesByContents.get(win.webContents) || lease)?.fail?.(error);
      if (win && !win.isDestroyed()) win.destroy();
      throw error;
    }
    if (asTab && anchor && this.platform === "darwin") anchor.addTabbedWindow(win);
    this.loadWindow(win, target).then(() => {
      if (restored?.maximized) win.maximize?.();
      if (restored?.fullscreen) win.setFullScreen?.(true);
    }).catch(() => {}); // loadWindow publishes the owned navigation failure.
    win.show();
    win.focus();
    this.capture(win);
    this.changed();
    return win;
  }

  bind(win, meta, mutationLease = null) {
    const contents = win.webContents;
    this.windows.add(win);
    allWindows.add(win);
    this.windowMeta.set(win, meta);
    meta.navigation = { status: "idle", revision: 0, errorCode: null };
    this.lastWindow = win;
    this.register(contents, win, { workspaceId: meta.id, accountId: this.accountId });
    if (mutationLease) this.bindMutationSettlement(contents, mutationLease);
    win.on("focus", () => {
      this.lastWindow = win;
      this.capture(win, true);
      this.changed();
    });
    for (const event of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
      win.on(event, () => this.scheduleCapture(win));
    }
    win.once("closed", () => {
      for (const pending of this.pendingPopupLeases.get(contents) ?? []) {
        clearTimeout(pending.timer);
        pending.lease?.fail?.(new Error("Browser workspace closed before popup opened"));
      }
      this.pendingPopupLeases.delete(contents);
      const mutationLease = this.mutationLeasesByContents.get(contents);
      if (mutationLease) {
        this.mutationLeasesByContents.delete(contents);
        mutationLease.fail?.(new Error("Browser workspace closed during account session change"));
      }
      this.unregister(contents);
      this.windows.delete(win);
      allWindows.delete(win);
      this.windowMeta.delete(win);
      this.pendingCaptures.delete(win);
      if (!meta.preserveOnClose) {
        meta.removalResult = this.removeSavedWorkspace(meta.id);
      }
      if (this.lastWindow === win) this.lastWindow = [...this.windows].at(-1) ?? null;
      this.changed();
    });
    contents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      meta.documentTitle = title;
      this.updateWindowTitle(win);
      this.changed();
    });
    contents.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) this.setNavigationState(win, "loading");
    });
    contents.on("did-finish-load", () => {
      // An error-page finish or a stale renderer event cannot revive a failed navigation.
      if (this.navigationState(win)?.status === "loading") this.setNavigationState(win, "loaded");
    });
    contents.on("did-stop-loading", () => {
      if (this.navigationState(win)?.status === "loading") this.setNavigationState(win, "idle");
    });
    contents.on("did-fail-load", (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.setNavigationState(win, "failed", code);
    });
    contents.on("render-process-gone", () => this.setNavigationState(win, "renderer-gone"));
    const navigation = (event, url) => {
      if (!this.allowedUrl(url)) {
        event.preventDefault();
        void this.external(contents, url);
        return;
      }
      if (!this.isSessionMutation(url) || !this.beginSessionMutation) return;
      // Redirects and provider hops remain inside the lease that already fenced this account.
      if (this.ownsContentsMutation(contents, meta.id)) return;
      // Keep the renderer's original method/body. Replacing this navigation with
      // loadURL(url) would turn an approved form POST into an unrelated GET.
      if (!this.beginMutationNavigation(contents, meta, url)) event.preventDefault();
    };
    contents.on("will-navigate", navigation);
    contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame) navigation(event, url);
    });
    contents.on("did-navigate", () => {
      this.capture(win);
      this.changed();
    });
    contents.on("did-navigate-in-page", () => {
      this.capture(win);
      this.changed();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (!this.allowedUrl(url)) {
        void this.external(contents, url);
        return { action: "deny" };
      }
      if (allWindows.size >= MAX_WORKSPACES) return { action: "deny" };
      let lease = null;
      if (this.isSessionMutation(url) && this.beginSessionMutation) {
        try {
          lease = this.beginSessionMutation({ sourceId: meta.id, reason: "workspace-popup", url });
        } catch (error) {
          this.onMutationBlocked?.(error, { sourceId: meta.id, url });
          return { action: "deny" };
        }
      }
      const pending = { lease, url, timer: null };
      const queue = this.pendingPopupLeases.get(contents) ?? [];
      this.pendingPopupLeases.set(contents, queue);
      pending.timer = setTimeout(() => {
        const index = queue.indexOf(pending);
        if (index >= 0) queue.splice(index, 1);
        if (queue.length === 0) this.pendingPopupLeases.delete(contents);
        lease?.fail?.(new Error("Browser workspace popup did not open"));
      }, 10_000);
      pending.timer.unref?.();
      queue.push(pending);
      return { action: "allow", overrideBrowserWindowOptions: this.options(meta.groupId) };
    });
    contents.on("did-create-window", (child, details) => {
      const queue = this.pendingPopupLeases.get(contents);
      const index = queue?.findIndex(candidate => candidate.url === details?.url) ?? -1;
      const pending = index >= 0 ? queue.splice(index, 1)[0] : null;
      if (queue?.length === 0) this.pendingPopupLeases.delete(contents);
      if (!pending) { child.destroy(); return; }
      if (pending?.timer) clearTimeout(pending.timer);
      const lease = pending?.lease ?? null;
      if (allWindows.size >= MAX_WORKSPACES) {
        lease?.fail?.(new Error("Workspace limit reached"));
        child.destroy();
        return;
      }
      const childMeta = { id: randomUUID(), groupId: meta.groupId, preserveOnClose: false };
      this.bind(child, childMeta, lease);
      // The popup's initial navigation can have started before did-create-window was delivered.
      this.setNavigationState(child, "loading");
      if (this.platform === "darwin" && !win.isDestroyed()) win.addTabbedWindow(child);
      child.show();
      child.focus();
      this.capture(child);
      this.changed();
    });
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.isAutoRepeat) return;
      const command = this.platform === "darwin" ? input.meta : input.control;
      if (command && !input.alt && input.key.toLowerCase() === "n") {
        event.preventDefault();
        try { this.open(); } catch {}
      } else if (command && !input.alt && input.key.toLowerCase() === "t" && this.platform === "darwin") {
        event.preventDefault();
        try { this.open({ asTab: true }); } catch {}
      } else if (command && !input.alt && input.key.toLowerCase() === "w") {
        event.preventDefault();
        if (!win.isDestroyed()) win.close();
      } else if (this.platform === "darwin" && input.control && input.key === "Tab") {
        event.preventDefault();
        input.shift ? win.selectPreviousTab() : win.selectNextTab();
      }
    });
  }

  ownsContents(contents) {
    return [...this.windows].some(win => !win.isDestroyed() && win.webContents === contents);
  }

  windowForContents(contents) {
    return [...this.windows].find(win => !win.isDestroyed() && win.webContents === contents) ?? null;
  }

  navigationState(win) {
    const state = this.windowMeta.get(win)?.navigation;
    return state ? { ...state } : null;
  }

  updateWindowTitle(win) {
    const meta = this.windowMeta.get(win);
    if (!meta || win.isDestroyed()) return;
    const label = { loading: "Loading…", failed: "Page unavailable", "renderer-gone": "Page stopped" }[meta.navigation?.status];
    win.setTitle?.(`${this.label} — ${label || meta.documentTitle || "NEKODEX Browser"}`);
  }

  setNavigationState(win, status, errorCode = null, failure = null) {
    const meta = this.windowMeta.get(win);
    if (!meta || win.isDestroyed()) return;
    const code = Number.isInteger(errorCode) ? errorCode : null;
    const resourceFailure = failure?.kind === "renderer-script" && Number.isInteger(failure.httpStatus)
      ? { kind: "renderer-script", httpStatus: failure.httpStatus } : null;
    if (meta.navigation.status === status && meta.navigation.errorCode === code
      && JSON.stringify(meta.navigation.failure ?? null) === JSON.stringify(resourceFailure)) return;
    meta.navigation = { status, revision: meta.navigation.revision + 1, errorCode: code,
      ...(resourceFailure ? { failure: resourceFailure } : {}) };
    this.updateWindowTitle(win);
    this.onNavigationState?.(win, this.navigationState(win));
    this.changed();
  }

  assertNavigationAvailable(contents) {
    if (!this.ownsContents(contents) || contents.isDestroyed()) throw new Error("Browser window is unavailable");
    if (this.mutationLeasesByContents.has(contents)) throw new Error("Wait for this account’s sign-in to finish before reloading");
  }

  ownsContentsMutation(contents, sourceId) {
    const lease = this.mutationLeasesByContents.get(contents);
    if (lease && !this.ownsSessionMutation) return true;
    if (lease && Number.isInteger(lease.generation)
      && this.ownsSessionMutation?.({ generation: lease.generation })) return true;
    return this.ownsSessionMutation?.({ sourceId }) === true;
  }

  async loadWindow(win, url) {
    if (!this.windows.has(win) || win.isDestroyed() || !this.allowedUrl(url)) throw new Error("Browser destination is unavailable");
    const meta = this.windowMeta.get(win);
    const generation = meta.loadGeneration = (meta.loadGeneration ?? 0) + 1;
    let settlement = this.mutationLeasesByContents.get(win.webContents);
    if (this.isSessionMutation(url) && this.beginSessionMutation && !this.ownsContentsMutation(win.webContents, meta.id)) {
      const lease = this.beginSessionMutation({ sourceId: meta.id, reason: "workspace-navigation", url });
      settlement = this.bindMutationSettlement(win.webContents, lease);
    }
    this.setNavigationState(win, "loading");
    try { await win.loadURL(url); }
    catch (error) {
      // ERR_ABORTED accompanies redirects and explicit navigation replacement, not a failed page.
      if (!abortedNavigation(error) && !win.isDestroyed() && meta.loadGeneration === generation) {
        settlement?.fail(error);
        this.setNavigationState(win, "failed", error?.errno);
      }
      throw error;
    }
  }

  reloadContents(contents, { ignoreCache = false } = {}) {
    this.assertNavigationAvailable(contents);
    const url = contents.getURL();
    if (!this.allowedUrl(url) || this.isSessionMutation(url)) throw new Error("Finish this account’s sign-in before reloading");
    this.setNavigationState(this.windowForContents(contents), "loading");
    ignoreCache ? contents.reloadIgnoringCache() : contents.reload();
    return true;
  }

  beginMutationNavigation(contents, meta, url) {
    let lease;
    try {
      lease = this.beginSessionMutation({ sourceId: meta.id, reason: "workspace-navigation", url });
    } catch (error) {
      this.onMutationBlocked?.(error, { sourceId: meta.id, url });
      return false;
    }
    this.bindMutationSettlement(contents, lease);
    return true;
  }

  bindMutationSettlement(contents, lease) {
    let settled = false;
    let owned;
    const cleanup = () => {
      contents.removeListener?.("did-finish-load", finish);
      contents.removeListener?.("did-fail-load", fail);
      contents.removeListener?.("render-process-gone", rendererGone);
    };
    const release = () => {
      if (this.mutationLeasesByContents.get(contents) === owned) this.mutationLeasesByContents.delete(contents);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      Promise.resolve().then(() => lease.finish?.({ contents, url: contents.getURL?.() ?? null }))
        .finally(release)
        .catch(error => this.onMutationBlocked?.(error, { sourceId: null, url: contents.getURL?.() ?? null }));
    };
    const failWith = error => {
      if (settled) return;
      settled = true;
      cleanup();
      try { lease.fail?.(error); }
      finally { release(); }
    };
    const fail = (_event, code, description, _url, mainFrame) => {
      if (!mainFrame || code === -3) return;
      failWith(new Error(`Session-changing page failed to load (${code}: ${description})`));
    };
    const rendererGone = () => failWith(new Error("Sign-in page renderer stopped before the account change completed"));
    // Window closure and renderer death share this terminal owner, so either releases
    // the exact lease once and removes the other pending terminal listeners.
    owned = { ...lease, fail: failWith };
    this.mutationLeasesByContents.set(contents, owned);
    contents.once("did-finish-load", finish);
    contents.on("did-fail-load", fail);
    contents.once("render-process-gone", rendererGone);
    return { fail: failWith };
  }

  capture(win, active = false) {
    if (!this.persistLocations) return;
    if (!win || win.isDestroyed()) return;
    const meta = this.windowMeta.get(win);
    if (!meta) return;
    const rawLocation = win.webContents.getURL?.() ?? win.url ?? this.home;
    const location = safeWorkspaceLocation(rawLocation);
    if (!location && !isTemporaryChat(rawLocation)) return;
    const previous = this.saved.get(meta.id);
    const verifiedPrincipal = this.getVerifiedPrincipal();
    const principalFingerprint = previous?.location === location && previous.principalFingerprint
      ? previous.principalFingerprint
      : typeof verifiedPrincipal === "string" && /^[a-f0-9]{64}$/.test(verifiedPrincipal)
        ? verifiedPrincipal : null;
    this.saved.set(meta.id, {
      id: meta.id,
      groupId: meta.groupId,
      location,
      restore: isTemporaryChat(rawLocation) ? "unsupported-temporary" : location ? "supported" : "unsupported-temporary",
      principalFingerprint,
      bounds: windowBounds(win),
      maximized: win.isMaximized?.() === true,
      fullscreen: win.isFullScreen?.() === true,
      lastActiveAt: active ? Date.now() : (previous?.lastActiveAt ?? Date.now()),
    });
    this.persist();
  }

  scheduleCapture(win) {
    this.pendingCaptures.add(win);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushCaptures(), 300);
    this.saveTimer.unref?.();
  }

  flushCaptures() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const pending = [...this.pendingCaptures];
    this.pendingCaptures.clear();
    for (const win of pending) this.capture(win);
  }

  persist() {
    if (!this.persistLocations) return { ok: true, overflow: false };
    if (!this.manifestLoaded) return;
    try {
      this.manifest.write([...this.saved.values()]);
      this.persistenceFailed = false;
      return { ok: true };
    } catch (error) {
      this.persistenceFailed = true;
      this.onPersistenceError?.(error);
      return { ok: false, error, overflow: error?.code === WORKSPACE_OVERFLOW_CODE };
    }
  }

  changed() { this.onChanged?.(this.snapshot()); }

  snapshot() {
    this.ensureManifestLoaded();
    const liveById = new Map([...this.windowMeta]
      .filter(([win]) => !win.isDestroyed()).map(([win, meta]) => [meta.id, win]));
    const values = [...this.saved.values()];
    // Loading and authentication windows consume real slots even before they have
    // a safe restore location. Keep these rows transient: never persist auth URLs.
    for (const [win, meta] of this.windowMeta) {
      if (win.isDestroyed() || this.saved.has(meta.id)) continue;
      values.push({ id: meta.id, groupId: meta.groupId, location: null, restore: null });
    }
    const items = values.map(entry => {
      const win = liveById.get(entry.id);
      const verifiedPrincipal = this.getVerifiedPrincipal();
      const principalMatches = typeof verifiedPrincipal === "string"
        && verifiedPrincipal === entry.principalFingerprint;
      return {
        id: entry.id,
        groupId: entry.groupId,
        state: win ? "open" : "saved",
        ...(win ? { navigation: this.navigationState(win) } : {}),
        kind: this.platform === "darwin"
          && values.some(other => other.id !== entry.id && other.groupId === entry.groupId) ? "tab" : "window",
        title: win && !win.isDestroyed() ? win.getTitle?.() ?? this.label : null,
        location: entry.location,
        restorable: entry.restore === "supported" && principalMatches,
        needsOriginalAccount: entry.restore === "supported" && !principalMatches,
        temporary: entry.restore === "unsupported-temporary",
        active: win === this.lastWindow,
      };
    });
    return {
      nativeTabs: this.platform === "darwin",
      items,
      restoreAttempted: this.restoreAttempted && this.restorePrincipal === this.getVerifiedPrincipal(),
      restoreResult: this.restorePrincipal === this.getVerifiedPrincipal() ? this.restoreResult : null,
      manifestStatus: this.manifest.lastReadStatus,
      persistenceFailed: this.persistenceFailed,
    };
  }

  restore() {
    this.ensureManifestLoaded();
    const currentPrincipal = this.getVerifiedPrincipal();
    this.restoreAttempted = true;
    this.restorePrincipal = currentPrincipal;
    let opened = 0;
    let skippedTemporary = 0;
    let skippedCapacity = 0;
    let skippedIdentity = 0;
    const entries = [...this.saved.values()];
    const restoredGroups = new Map();
    const liveIds = new Set();
    for (const [win, meta] of this.windowMeta) {
      if (win.isDestroyed()) continue;
      liveIds.add(meta.id);
      if (!restoredGroups.has(meta.groupId)) restoredGroups.set(meta.groupId, win);
    }
    for (const entry of entries) {
      // Capture stores live windows alongside dormant entries, including Temporary Chat.
      if (liveIds.has(entry.id)) continue;
      if (entry.restore !== "supported" || !entry.location) {
        skippedTemporary += 1;
        this.saved.delete(entry.id);
        continue;
      }
      const verifiedPrincipal = this.getVerifiedPrincipal();
      if (typeof verifiedPrincipal !== "string" || verifiedPrincipal !== entry.principalFingerprint) {
        skippedIdentity += 1;
        continue;
      }
      if (allWindows.size >= MAX_WORKSPACES) {
        skippedCapacity += 1;
        continue;
      }
      const anchor = restoredGroups.get(entry.groupId);
      const asTab = this.platform === "darwin" && Boolean(anchor);
      const win = this.open({ asTab, restored: entry, anchorWindow: anchor ?? null });
      restoredGroups.set(entry.groupId, anchor ?? win);
      opened += 1;
    }
    this.persist();
    this.restoreResult = { opened, skippedTemporary, skippedCapacity, skippedIdentity };
    this.changed();
    return this.restoreResult;
  }

  refreshIdentityBindings() {
    if (this.restorePrincipal !== this.getVerifiedPrincipal()) {
      this.restoreAttempted = false;
      this.restoreResult = null;
    }
    for (const win of this.windows) this.capture(win);
    this.changed();
  }

  focus(workspaceId) {
    for (const [win, meta] of this.windowMeta) {
      if (meta.id !== workspaceId || win.isDestroyed()) continue;
      win.show();
      win.focus();
      return true;
    }
    return false;
  }

  removeSavedWorkspace(workspaceId) {
    if (!this.persistLocations) return { ok: true, overflow: false };
    const previous = new Map(this.saved);
    this.saved.delete(workspaceId);
    const result = this.persist();
    // Overflow permits successive removals to reach capacity. A storage failure
    // keeps the saved retry row even when its native window has already closed.
    if (!result.ok && !result.overflow) this.saved = previous;
    return result;
  }

  async close(workspaceId) {
    this.ensureManifestLoaded();
    const match = [...this.windowMeta].find(([, meta]) => meta.id === workspaceId);
    if (!match) {
      if (!this.saved.has(workspaceId)) return false;
      const result = this.removeSavedWorkspace(workspaceId);
      this.changed();
      if (!result.ok && !result.overflow) throw result.error;
      return true;
    }
    await this.requestClose(match[0], false);
    return true;
  }

  requestClose(win, preserve) {
    if (win.isDestroyed()) return Promise.resolve();
    const meta = this.windowMeta.get(win);
    if (meta) {
      meta.preserveOnClose = preserve;
      meta.removalResult = null;
    }
    const contents = win.webContents;
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        win.removeListener("closed", closed);
        contents.removeListener("will-prevent-unload", blocked);
        if (error && meta) meta.preserveOnClose = false;
        error ? reject(error) : resolve();
      };
      // bind() registered its closed handler first, so durable removal has settled
      // before this observer resolves the manager's request.
      const closed = () => {
        const result = meta?.removalResult;
        finish(result && !result.ok && !result.overflow ? result.error : null);
      };
      const blocked = () => finish(new Error("Finish or save work in the browser window before closing it"));
      const timer = setTimeout(blocked, 5_000);
      win.once("closed", closed);
      contents.once("will-prevent-unload", blocked);
      win.close();
    });
  }

  async closeAll() {
    this.flushCaptures();
    for (const win of [...this.windows]) await this.requestClose(win, true);
  }

  destroy() {
    this.flushCaptures();
    for (const queue of this.pendingPopupLeases.values()) {
      for (const pending of queue) {
        clearTimeout(pending.timer);
        pending.lease?.fail?.(new Error("Browser workspace closed"));
      }
    }
    this.pendingPopupLeases.clear();
    for (const win of [...this.windows]) {
      const meta = this.windowMeta.get(win);
      if (meta) meta.preserveOnClose = true;
      if (!win.isDestroyed()) win.destroy();
    }
  }
}

module.exports = {
  BrowserWorkspaceWindows,
  HOME,
  RESTORE_HOME,
  potentialSessionMutation,
};
