const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BrowserWorkspaceManifest, MAX_WORKSPACES } = require("../electron/browser-workspace-manifest.cjs");
const { BrowserWorkspaceWindows } = require("../electron/browser-workspace-windows.cjs");
const PRINCIPAL_A = "a".repeat(64);

class Contents extends EventEmitter {
  constructor() { super(); this.url = "about:blank"; }
  setWindowOpenHandler(handler) { this.popup = handler; }
  getURL() { return this.url; }
  loadURL(url) { this.url = url; this.emit("did-navigate", {}, url); this.emit("did-finish-load"); return Promise.resolve(); }
}

class Window extends EventEmitter {
  constructor(options) {
    super(); this.options = options; this.tabbingIdentifier = options.tabbingIdentifier;
    this.webContents = new Contents(); this.destroyed = false; this.tabs = [];
    this.bounds = { x: options.x ?? 10, y: options.y ?? 20, width: options.width, height: options.height };
  }
  loadURL(url) { return this.webContents.loadURL(url); }
  getBounds() { return this.bounds; }
  getTitle() { return this.title ?? "ChatGPT"; }
  isMaximized() { return false; } isFullScreen() { return false; }
  show() {} focus() { this.emit("focus"); } setTitle(value) { this.title = value; } isDestroyed() { return this.destroyed; }
  addTabbedWindow(child) { this.tabs.push(child); } selectNextTab() {} selectPreviousTab() {}
  close() { if (this.preventClose) this.webContents.emit("will-prevent-unload"); else this.destroy(); }
  destroy() { this.destroyed = true; this.emit("closed"); }
}

function manager({ file, platform = "darwin", beginSessionMutation, onMutationBlocked,
  principal = PRINCIPAL_A, accountId = "a" } = {}) {
  return new BrowserWorkspaceWindows({
    BrowserWindow: Window,
    session: { account: accountId },
    accountId,
    label: "Account A",
    platform,
    manifestPath: file,
    getVerifiedPrincipal: () => typeof principal === "function" ? principal() : principal,
    displays: () => [{ workArea: { x: 0, y: 0, width: 1600, height: 1000 } }],
    allowedUrl: url => url.startsWith("https://chatgpt.com/") || url.startsWith("https://auth.openai.com/"),
    register() {}, unregister() {}, external: async () => {}, beginSessionMutation, onMutationBlocked,
  });
}

for (const temporary of [false, true]) {
  test(`restore preserves a live ${temporary ? 'temporary' : 'normal'} workspace and its native group`, async () => {
    const workspaces = manager();
    try {
      const live = workspaces.open(temporary ? {} : { url: 'https://chatgpt.com/c/live' });
      const meta = workspaces.windowMeta.get(live);
      workspaces.saved.set('dormant', {
        id: 'dormant', groupId: meta.groupId, location: 'https://chatgpt.com/c/dormant',
        restore: 'supported', principalFingerprint: PRINCIPAL_A,
      });
      assert.deepEqual(workspaces.restore(), { opened: 1, skippedTemporary: 0, skippedCapacity: 0, skippedIdentity: 0 });
      const restored = [...workspaces.windows].find(win => win !== live);
      assert.deepEqual(live.tabs, [restored]);
      assert.equal(workspaces.windows.size, 2);
      const rows = workspaces.snapshot().items;
      assert.equal(rows.filter(item => item.state === 'open').length, 2);
      assert.equal(rows.find(item => item.id === meta.id).temporary, temporary);
      assert.equal(workspaces.restore().opened, 0);
      assert.equal(new Set([...workspaces.windowMeta.values()].map(item => item.id)).size, 2);
      assert.equal(await workspaces.close('dormant'), true);
      assert.deepEqual(workspaces.snapshot().items.map(item => item.id), [meta.id]);
      assert.equal(live.isDestroyed(), false);
    } finally { workspaces.destroy(); }
  });
}

test('explicit retry restores only capacity-skipped IDs, rejoins live groups and rechecks original identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-workspace-retry-'));
  const file = path.join(root, 'a.json');
  let principal = PRINCIPAL_A;
  const other = manager({ accountId: 'other' });
  const workspaces = manager({ file, principal: () => principal });
  try {
    new BrowserWorkspaceManifest(file, 'a').write([
      { id: 'first', groupId: 'shared', location: 'https://chatgpt.com/c/first', restore: 'supported', principalFingerprint: PRINCIPAL_A, lastActiveAt: 1 },
      { id: 'remaining', groupId: 'shared', location: 'https://chatgpt.com/c/remaining', restore: 'supported', principalFingerprint: PRINCIPAL_A, lastActiveAt: 2 },
      { id: 'foreign', groupId: 'shared', location: 'https://chatgpt.com/c/foreign', restore: 'supported', principalFingerprint: 'b'.repeat(64), lastActiveAt: 3 },
    ]);
    for (let index = 0; index < MAX_WORKSPACES - 1; index += 1) other.open();
    assert.deepEqual(workspaces.restore(), { opened: 1, skippedTemporary: 0, skippedCapacity: 1, skippedIdentity: 1 });
    const first = [...workspaces.windows][0];
    assert.deepEqual(workspaces.restore(), { opened: 0, skippedTemporary: 0, skippedCapacity: 1, skippedIdentity: 1 });
    await other.close(other.windowMeta.values().next().value.id);
    assert.equal(workspaces.windows.size, 1, 'free capacity must not auto-open saved work');
    principal = null;
    assert.deepEqual(workspaces.restore(), { opened: 0, skippedTemporary: 0, skippedCapacity: 0, skippedIdentity: 2 });
    principal = PRINCIPAL_A;
    assert.deepEqual(workspaces.restore(), { opened: 1, skippedTemporary: 0, skippedCapacity: 0, skippedIdentity: 1 });
    const remaining = [...workspaces.windows].find(win => win !== first);
    assert.equal(workspaces.windowMeta.get(remaining).id, 'remaining');
    assert.deepEqual(first.tabs, [remaining]);
    const rows = workspaces.snapshot().items;
    assert.deepEqual(rows.filter(item => item.state === 'open').map(item => item.id).sort(), ['first', 'remaining']);
    assert.equal(new Set([...workspaces.windowMeta.values()].map(item => item.id)).size, 2);
    assert.equal(rows.find(item => item.id === 'foreign').needsOriginalAccount, true);
    assert.equal(new BrowserWorkspaceManifest(file, 'a').read().entries.find(item => item.id === 'foreign').principalFingerprint, 'b'.repeat(64));
    assert.equal(workspaces.snapshot().restoreResult.skippedCapacity, 0);
  } finally {
    workspaces.destroy();
    other.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restore opens only safe locations in the matching account and consumes Temporary Chat placeholders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-workspace-restore-"));
  const file = path.join(root, "a.json");
  try {
    new BrowserWorkspaceManifest(file, "a").write([
      { id: "conversation", groupId: "group", location: "https://chatgpt.com/c/abc", restore: "supported", principalFingerprint: PRINCIPAL_A, bounds: { x: 40, y: 50, width: 900, height: 700 } },
      { id: "temporary", groupId: "temporary", location: null, restore: "unsupported-temporary" },
    ]);
    const workspaces = manager({ file });
    const before = workspaces.snapshot();
    assert.equal(before.items.length, 2);
    assert.equal(workspaces.windows.size, 0);
    assert.deepEqual(workspaces.restore(), { opened: 1, skippedTemporary: 1, skippedCapacity: 0, skippedIdentity: 0 });
    assert.equal(workspaces.windows.size, 1);
    assert.equal([...workspaces.windows][0].webContents.getURL(), "https://chatgpt.com/c/abc");
    workspaces.destroy();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a skipped workspace can restore after the original principal returns", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-workspace-returned-identity-"));
  const file = path.join(root, "a.json");
  let principal = "b".repeat(64);
  try {
    new BrowserWorkspaceManifest(file, "a").write([
      { id: "private", groupId: "a", location: "https://chatgpt.com/c/private", restore: "supported", principalFingerprint: PRINCIPAL_A },
    ]);
    const workspaces = manager({ file, principal: () => principal });
    assert.equal(workspaces.restore().skippedIdentity, 1);
    principal = PRINCIPAL_A;
    assert.equal(workspaces.snapshot().restoreAttempted, false);
    assert.equal(workspaces.restore().opened, 1);
    workspaces.destroy();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restored native tabs return to their own group even when saved groups are interleaved", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-workspace-groups-"));
  const file = path.join(root, "a.json");
  try {
    new BrowserWorkspaceManifest(file, "a").write([
      { id: "a1", groupId: "a", location: "https://chatgpt.com/c/a1", restore: "supported", principalFingerprint: PRINCIPAL_A, lastActiveAt: 1 },
      { id: "b1", groupId: "b", location: "https://chatgpt.com/c/b1", restore: "supported", principalFingerprint: PRINCIPAL_A, lastActiveAt: 2 },
      { id: "a2", groupId: "a", location: "https://chatgpt.com/c/a2", restore: "supported", principalFingerprint: PRINCIPAL_A, lastActiveAt: 3 },
    ]);
    const workspaces = manager({ file });
    workspaces.restore();
    const byUrl = new Map([...workspaces.windows].map(win => [win.webContents.getURL(), win]));
    assert.deepEqual(byUrl.get("https://chatgpt.com/c/a1").tabs, [byUrl.get("https://chatgpt.com/c/a2")]);
    assert.deepEqual(byUrl.get("https://chatgpt.com/c/b1").tabs, []);
    workspaces.destroy();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("saved conversations remain bound to their original verified ChatGPT principal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-workspace-identity-"));
  const file = path.join(root, "a.json");
  try {
    new BrowserWorkspaceManifest(file, "a").write([
      { id: "private", groupId: "a", location: "https://chatgpt.com/c/private", restore: "supported", principalFingerprint: PRINCIPAL_A },
    ]);
    const workspaces = manager({ file, principal: "b".repeat(64) });
    const saved = workspaces.snapshot().items[0];
    assert.equal(saved.restorable, false);
    assert.equal(saved.needsOriginalAccount, true);
    assert.deepEqual(workspaces.restore(), { opened: 0, skippedTemporary: 0, skippedCapacity: 0, skippedIdentity: 1 });
    assert.equal(workspaces.windows.size, 0);
    assert.equal(new BrowserWorkspaceManifest(file, "a").read().entries[0].principalFingerprint, PRINCIPAL_A);
    assert.equal(await workspaces.close("private"), true);
    assert.deepEqual(new BrowserWorkspaceManifest(file, "a").read().entries, []);
    workspaces.destroy();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("explicitly closed windows stay closed while shutdown closure remains restorable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-workspace-close-"));
  const file = path.join(root, "a.json");
  try {
    const first = manager({ file });
    const explicitlyClosed = first.open({ url: "https://chatgpt.com/c/closed" });
    const preserved = first.open({ url: "https://chatgpt.com/c/preserved" });
    const closedId = [...first.windowMeta].find(([win]) => win === explicitlyClosed)[1].id;
    await first.close(closedId);
    await first.closeAll();
    const saved = new BrowserWorkspaceManifest(file, "a").read().entries;
    assert.equal(saved.some(entry => entry.location?.endsWith("/c/closed")), false);
    assert.equal(saved.some(entry => entry.location?.endsWith("/c/preserved")), true);
    assert.equal(preserved.destroyed, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Cmd-W removes the closed workspace from the durable manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-workspace-cmdw-"));
  const file = path.join(root, "a.json");
  try {
    const workspaces = manager({ file });
    const win = workspaces.open({ url: "https://chatgpt.com/c/close-with-shortcut" });
    assert.equal(new BrowserWorkspaceManifest(file, "a").read().entries.length, 1);
    win.webContents.emit("before-input-event", { preventDefault() {} }, { type: "keyDown", key: "w", meta: true });
    assert.equal(win.destroyed, true);
    assert.deepEqual(new BrowserWorkspaceManifest(file, "a").read().entries, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("non-macOS tab requests are rejected instead of silently creating a window", () => {
  const workspaces = manager({ platform: "linux" });
  try { assert.throws(() => workspaces.open({ asTab: true }), /available on macOS/); }
  finally { workspaces.destroy(); }
});

test("session-changing navigation uses a lease and reports an in-use account without navigating", () => {
  const blocked = [];
  const workspaces = manager({
    beginSessionMutation() { throw new Error("Finish the active task first"); },
    onMutationBlocked: error => blocked.push(error.message),
  });
  try {
    const win = workspaces.open({ url: "https://chatgpt.com/c/one" });
    let prevented = false;
    win.webContents.emit("will-navigate", { preventDefault() { prevented = true; } }, "https://auth.openai.com/login");
    assert.equal(prevented, true);
    assert.deepEqual(blocked, ["Finish the active task first"]);
    assert.equal(win.webContents.getURL(), "https://chatgpt.com/c/one");
  } finally { workspaces.destroy(); }
});

test("one mutation lease covers provider redirects and settles once", async () => {
  const events = [];
  let settle;
  const workspaces = manager({
    beginSessionMutation({ url }) {
      events.push(["begin", url]);
      return {
        finish(context) {
          events.push(["finish", context.url]);
          return new Promise(resolve => { settle = resolve; });
        },
        fail(error) { events.push(["fail", error.message]); },
      };
    },
  });
  try {
    const win = workspaces.open({ url: "https://chatgpt.com/c/one" });
    win.webContents.emit("will-navigate", { preventDefault() {} }, "https://auth.openai.com/login");
    win.webContents.emit("will-redirect", { preventDefault() { assert.fail("redirect should remain in the active lease"); } }, "https://chatgpt.com/auth/callback", false, true);
    settle();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, [
      ["begin", "https://auth.openai.com/login"],
      ["finish", "https://auth.openai.com/login"],
    ]);
  } finally { workspaces.destroy(); }
});
