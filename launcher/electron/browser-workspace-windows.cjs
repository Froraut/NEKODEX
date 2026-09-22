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
    onAuthNavigation,
    beginSessionMutation,
    onMutationBlocked,
    onPersistenceError,
    getVerifiedPrincipal = () => null,
    onChanged,
    manifestPath,
    displays = () => [],
    platform = process.platform,
    home = HOME,
    restoreHome = RESTORE_HOME,
  }) {
    Object.assign(this, {
      BrowserWindow, session, accountId, label, allowedUrl, register, unregister, external,
      onAuthNavigation, beginSessionMutation, onMutationBlocked, onPersistenceError, getVerifiedPrincipal, onChanged, platform, home,
      restoreHome, displays,
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
    this.pendingPopupLeases = [];
    this.mutationLeasesByContents = new WeakMap();
    this.saveTimer = null;
    this.pendingCaptures = new Set();
    this.persistenceFailed = false;
  }

  ensureManifestLoaded() {
    if (this.manifestLoaded) return;
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
    const win = new this.BrowserWindow(this.options(groupId, bounds));
    this.bind(win, { id, groupId, preserveOnClose: false });
    if (asTab && anchor && this.platform === "darwin") anchor.addTabbedWindow(win);
    const target = restored?.location ?? url;
    win.loadURL(target).then(() => {
      if (restored?.maximized) win.maximize?.();
      if (restored?.fullscreen) win.setFullScreen?.(true);
    }).catch(() => {
      if (!win.isDestroyed()) win.setTitle(`${this.label} — Page unavailable`);
    });
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
        this.saved.delete(meta.id);
        this.persist();
      }
      if (this.lastWindow === win) this.lastWindow = [...this.windows].at(-1) ?? null;
      this.changed();
    });
    contents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      win.setTitle(`${this.label} — ${title || "NEKODEX Browser"}`);
      this.changed();
    });
    const navigation = (event, url) => {
      if (!this.allowedUrl(url)) {
        event.preventDefault();
        void this.external(contents, url);
        return;
      }
      if (!potentialSessionMutation(url) || !this.beginSessionMutation) return;
      // Redirects and provider hops remain inside the lease that already fenced this account.
      if (this.mutationLeasesByContents.has(contents)) return;
      event.preventDefault();
      this.resumeMutationNavigation(contents, meta, url);
    };
    contents.on("will-navigate", navigation);
    contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame) navigation(event, url);
    });
    contents.on("did-navigate", (_event, url) => {
      this.capture(win);
      this.changed();
      // Legacy callers may still observe navigation. Coordinated callers verify only through
      // the generation-bound lease; running the old callback here would reintroduce the early probe.
      if (!this.beginSessionMutation) void this.onAuthNavigation?.(url);
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
      if (potentialSessionMutation(url) && this.beginSessionMutation) {
        try {
          lease = this.beginSessionMutation({ sourceId: meta.id, reason: "workspace-popup", url });
        } catch (error) {
          this.onMutationBlocked?.(error, { sourceId: meta.id, url });
          return { action: "deny" };
        }
      }
      const pending = { lease, timer: null };
      if (lease) {
        pending.timer = setTimeout(() => {
          const index = this.pendingPopupLeases.indexOf(pending);
          if (index >= 0) this.pendingPopupLeases.splice(index, 1);
          lease.fail?.(new Error("Session-changing popup did not open"));
        }, 10_000);
        pending.timer.unref?.();
      }
      this.pendingPopupLeases.push(pending);
      return { action: "allow", overrideBrowserWindowOptions: this.options(meta.groupId) };
    });
    contents.on("did-create-window", child => {
      const pending = this.pendingPopupLeases.shift() ?? null;
      if (pending?.timer) clearTimeout(pending.timer);
      const lease = pending?.lease ?? null;
      if (allWindows.size >= MAX_WORKSPACES) {
        lease?.fail?.(new Error("Workspace limit reached"));
        child.destroy();
        return;
      }
      const childMeta = { id: randomUUID(), groupId: meta.groupId, preserveOnClose: false };
      this.bind(child, childMeta, lease);
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

  resumeMutationNavigation(contents, meta, url) {
    let lease;
    try {
      lease = this.beginSessionMutation({ sourceId: meta.id, reason: "workspace-navigation", url });
    } catch (error) {
      this.onMutationBlocked?.(error, { sourceId: meta.id, url });
      return;
    }
    const settlement = this.bindMutationSettlement(contents, lease);
    Promise.resolve(contents.loadURL(url)).catch(error => settlement.fail(error));
  }

  bindMutationSettlement(contents, lease) {
    let settled = false;
    this.mutationLeasesByContents.set(contents, lease);
    const release = () => {
      if (this.mutationLeasesByContents.get(contents) === lease) this.mutationLeasesByContents.delete(contents);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      contents.removeListener?.("did-fail-load", fail);
      Promise.resolve(lease.finish?.({ contents, url: contents.getURL?.() ?? null }))
        .finally(release)
        .catch(error => this.onMutationBlocked?.(error, { sourceId: null, url: contents.getURL?.() ?? null }));
    };
    const failWith = error => {
      if (settled) return;
      settled = true;
      contents.removeListener?.("did-finish-load", finish);
      contents.removeListener?.("did-fail-load", fail);
      lease.fail?.(error);
      release();
    };
    const fail = (_event, code, description) => failWith(
      new Error(`Session-changing page failed to load (${code}: ${description})`),
    );
    contents.once("did-finish-load", finish);
    contents.once("did-fail-load", fail);
    return { fail: failWith };
  }

  capture(win, active = false) {
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

  async close(workspaceId) {
    this.ensureManifestLoaded();
    const match = [...this.windowMeta].find(([, meta]) => meta.id === workspaceId);
    if (!match) {
      if (!this.saved.has(workspaceId)) return false;
      const previous = new Map(this.saved);
      this.saved.delete(workspaceId);
      const result = this.persist();
      // Overflow must allow successive removals to reach capacity. Storage errors
      // instead retain the target so the same explicit action can be retried.
      if (!result.ok && !result.overflow) {
        this.saved = previous;
        this.changed();
        throw result.error;
      }
      this.changed();
      return true;
    }
    await this.requestClose(match[0], false);
    return true;
  }

  requestClose(win, preserve) {
    if (win.isDestroyed()) return Promise.resolve();
    const meta = this.windowMeta.get(win);
    if (meta) meta.preserveOnClose = preserve;
    const contents = win.webContents;
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        win.removeListener("closed", closed);
        contents.removeListener("will-prevent-unload", blocked);
        if (error && meta) meta.preserveOnClose = false;
        error ? reject(error) : resolve();
      };
      const closed = () => finish();
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
    for (const pending of this.pendingPopupLeases.splice(0)) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.lease?.fail?.(new Error("Browser workspace closed"));
    }
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
