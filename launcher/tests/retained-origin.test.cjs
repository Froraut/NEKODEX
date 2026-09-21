const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { BrowserHost, IDLE_BROWSER_URL } = require("../electron/browser-host.cjs");

function fixture() {
  const state = { url: "https://chatgpt.com/c/retained", loading: false, destroyed: false, marks: 0, stops: 0 };
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => state.destroyed,
    isLoadingMainFrame: () => state.loading,
    getURL: () => state.url,
    setWindowOpenHandler() {},
    setBackgroundThrottling() {},
    stop: () => { state.stops += 1; },
    insertCSS: async () => {},
  });
  const tab = {
    id: "retained", traceId: "previous", surfaceId: "synthetic-surface", helperPid: process.pid,
    conversationKey: "synthetic-key", connectorIdentity: "Codex Native6", connectorBound: true,
    interactionMode: "automatic", status: "ready", bootstrapReady: true, rendererReady: true,
    // Cached metadata is deliberately trusted-looking even when the live URL changes.
    url: "https://chatgpt.com/c/retained", view: { webContents: contents },
  };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    turnTabs: new Map([[tab.id, tab]]), userCancelledTurnOwners: new Map(), closedTurnOwners: new Map(),
    logger: { info() {}, warn() {}, error() {} }, snapshot: () => ({}),
    publishState() {}, syncViewVisibility() {}, syncPowerSaveBlocker() {}, writeDescriptor() {},
    markTurnTabSurface: async () => { state.marks += 1; },
    removeTurnTab: candidate => host.turnTabs.delete(candidate.id),
    createTurnTab: async () => { throw new Error("Must not replace a required continuation"); },
  });
  host.bindTurnContents(tab);
  return { host, tab, contents, state };
}

test("retained leases require a live settled ChatGPT document, regardless of cached metadata", async () => {
  const { host, tab, state } = fixture();
  assert.equal(host.exactRetainedTurnTab(tab.conversationKey, tab.connectorIdentity), tab);
  for (const url of ["https://example.test/", "https://chatgpt.com.example.test/", "http://chatgpt.com/",
    "https://chatgpt.com:8443/", "https://user@chatgpt.com/", "https://chatgpt.com/auth/login", IDLE_BROWSER_URL]) {
    state.url = url;
    assert.equal(host.exactRetainedTurnTab(tab.conversationKey, tab.connectorIdentity), null, url);
    await assert.rejects(host.beginTurn("next", false, process.pid, tab.conversationKey, tab.connectorIdentity, true),
      error => error.code === "retained_conversation_unavailable");
  }
  state.url = "https://chatgpt.com/c/retained";
  state.loading = true;
  assert.equal(host.exactRetainedTurnTab(tab.conversationKey, tab.connectorIdentity), null);
  state.loading = false;
  state.destroyed = true;
  assert.equal(host.exactRetainedTurnTab(tab.conversationKey, tab.connectorIdentity), null);
});

test("automatic navigation blocks foreign destinations and committed changes retire binding", async () => {
  const { host, tab, contents, state } = fixture();
  for (const event of ["will-navigate", "will-redirect"]) {
    let prevented = false;
    contents.emit(event, { preventDefault() { prevented = true; } }, "https://example.test/");
    assert.equal(prevented, true);
    assert.equal(host.exactRetainedTurnTab(tab.conversationKey, tab.connectorIdentity), tab);
  }
  // Subframes and ordinary ChatGPT history routes do not invalidate the retained conversation.
  contents.emit("did-start-navigation", {}, "https://example.test/frame", false, false);
  state.url = "https://chatgpt.com/c/retained#answer";
  contents.emit("did-start-navigation", {}, state.url, true, true);
  contents.emit("did-navigate-in-page", {}, state.url, true);
  assert.equal(host.exactRetainedTurnTab(tab.conversationKey, tab.connectorIdentity), tab);

  state.url = "https://example.test/";
  contents.emit("did-start-navigation", {}, state.url, false, true);
  contents.emit("did-finish-load");
  assert.equal(tab.conversationKey, undefined);
  assert.equal(tab.connectorBound, false);
  assert.equal(tab.bootstrapReady, false);
  assert.equal(tab.rendererReady, false);
  assert.equal(state.marks, 0);
  assert.ok(state.stops > 0);
  state.url = "https://chatgpt.com/c/retained";
  contents.emit("did-finish-load");
  await Promise.resolve();
  assert.equal(host.exactRetainedTurnTab("synthetic-key", tab.connectorIdentity), null);
});

test("foreign completion cannot retain a binding even if a navigation event was missed", async () => {
  const { host, tab, state } = fixture();
  state.url = "https://example.test/";
  await host.endTurn(tab.traceId, tab.helperPid, "completed", false, undefined, true, true);
  assert.equal(host.turnTabs.size, 0);
});

test("surface marking rechecks the receiving document and permits only the initial exact idle page", async () => {
  const { host, tab, contents, state } = fixture();
  let world;
  contents.executeJavaScript = async program => {
    world = { location: { origin: new URL(state.url).origin, href: state.url },
      document: { documentElement: { dataset: {} } } };
    return vm.runInNewContext(program, world);
  };
  await BrowserHost.prototype.markTurnTabSurface.call(host, tab);
  assert.equal(world.__CODEX_WEB_GPT_SURFACE_ID__, tab.surfaceId);
  state.url = "https://chatgpt.com.example.test/";
  await assert.rejects(BrowserHost.prototype.markTurnTabSurface.call(host, tab), /foreign document/);
  assert.equal(world.__CODEX_WEB_GPT_SURFACE_ID__, undefined);
  state.url = IDLE_BROWSER_URL;
  await assert.rejects(BrowserHost.prototype.markTurnTabSurface.call(host, tab), /foreign document/);
  tab.initializingSurface = true;
  contents.emit("did-start-navigation", {}, state.url, false, true);
  contents.emit("did-finish-load");
  assert.equal(tab.conversationKey, "synthetic-key");
  await BrowserHost.prototype.markTurnTabSurface.call(host, tab);
  assert.equal(world.__CODEX_WEB_GPT_SURFACE_ID__, tab.surfaceId);
});
