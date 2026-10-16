import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { BrowserWorkspaceWindows } = require("../launcher/electron/browser-workspace-windows.cjs");
const { BrowserHost } = require("../launcher/electron/browser-host.cjs");
const { openAiApiPanelUrl, allowedOpenAiApiPanelUrl, openAiApiSessionMutation } = require("../launcher/electron/openai-api-panel.cjs");

class TestWindow extends EventEmitter {
  destroyed = false;
  url = "";
  title = "";
  loads: string[] = [];
  webContents: any;
  constructor(public options: any) {
    super();
    this.webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, isDestroyed: () => this.destroyed,
      setWindowOpenHandler() {}, reload() {}, reloadIgnoringCache() {},
      loadURL: (url: string) => this.loadURL(url),
    });
  }
  loadURL(url: string) { this.loads.push(url); this.url = url; return Promise.resolve(); }
  isDestroyed() { return this.destroyed; }
  show() {} focus() {} setTitle(title: string) { this.title = title; }
  getTitle() { return this.title; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
}

function windows(overrides: Record<string, unknown> = {}) {
  const session = {};
  const states: any[] = [];
  const manager = new BrowserWorkspaceWindows({ BrowserWindow: TestWindow, session,
    accountId: "default", label: "Account — OpenAI API", manifestPath: "/unused/manifest.json",
    persistLocations: false, home: openAiApiPanelUrl(), allowedUrl: allowedOpenAiApiPanelUrl,
    isSessionMutation: openAiApiSessionMutation, register() {}, unregister() {}, external() {},
    onNavigationState: (_window: unknown, state: unknown) => states.push(state), ...overrides });
  return { manager, session, states };
}

test("a failed auxiliary page keeps its session and window, and explicit retry settles navigation", async () => {
  const { manager, session, states } = windows();
  try {
    const win = manager.open();
    expect(win.options.webPreferences.session).toBe(session);
    win.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "private", true);
    win.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "private", false);
    expect(manager.navigationState(win).status).toBe("loading");
    win.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "private", true);
    expect(manager.navigationState(win)).toMatchObject({ status: "failed", errorCode: -105 });
    win.webContents.emit("did-finish-load");
    expect(manager.navigationState(win).status).toBe("failed");
    expect(JSON.stringify(states)).not.toContain("private");
    await manager.loadWindow(win, openAiApiPanelUrl());
    win.webContents.emit("did-finish-load");
    expect(manager.navigationState(win).status).toBe("loaded");
    expect(manager.windows.size).toBe(1);
    expect(win.destroyed).toBe(false);
    win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    win.webContents.emit("did-finish-load");
    expect(manager.navigationState(win).status).toBe("renderer-gone");
    await manager.loadWindow(win, openAiApiPanelUrl());
    win.webContents.id = 12;
    const host = Object.assign(Object.create(BrowserHost.prototype), {
      apiPanelBrowser: manager, apiPanelContents: new Map([[win.webContents, win]]),
    });
    const resource = { webContentsId: 12, resourceType: "script", statusCode: 403,
      url: "https://platform.openai.com/static/index-fixture.js?private=not-for-logs" };
    expect(host.handleApiPanelResourceResponse({ ...resource, webContentsId: 13 })).toBe(false);
    expect(host.handleApiPanelResourceResponse(resource)).toBe(true);
    win.webContents.emit("did-finish-load");
    expect(manager.navigationState(win)).toMatchObject({ status: "failed", failure: { kind: "renderer-script", httpStatus: 403 } });
    expect(JSON.stringify(states)).not.toContain("not-for-logs");
    await manager.loadWindow(win, openAiApiPanelUrl());
    expect(host.handleApiPanelResourceResponse({ ...resource, url: "https://platform.openai.com/static/lazy-optional.js" })).toBe(false);
    win.webContents.emit("did-finish-load");
    expect(host.handleApiPanelResourceResponse(resource)).toBe(false);
    expect(manager.navigationState(win).status).toBe("loaded");
  } finally { manager.destroy(); }
});

test("initial programmatic sign-in acquires its lease before navigating, while ordinary pages remain available", () => {
  const events: string[] = [];
  let blocked = false;
  class ObservedWindow extends TestWindow {
    loadURL(url: string) { events.push("load"); return super.loadURL(url); }
  }
  const { manager } = windows({ BrowserWindow: ObservedWindow, beginSessionMutation: () => {
    if (blocked) throw new Error("live account mutation");
    events.push("begin"); return { fail() {}, finish() {} };
  } });
  try {
    manager.open();
    expect(events).toEqual(["load"]);
    const win = manager.open({ url: "https://auth.openai.com/log-in" });
    expect(events).toEqual(["load", "begin", "load"]);
    expect(manager.mutationLeasesByContents.has(win.webContents)).toBe(true);
    blocked = true;
    const count = manager.windows.size;
    expect(() => manager.open({ url: "https://auth.openai.com/log-in" })).toThrow("live account mutation");
    expect(manager.windows.size).toBe(count);
    expect(events).toEqual(["load", "begin", "load"]);
  } finally { manager.destroy(); }
});

test("a session mutation retains its lease across aborted and subframe failures", async () => {
  const { manager } = windows();
  try {
    const win = manager.open();
    let failed = 0, finished = 0;
    const lease = { fail: () => { failed++; }, finish: () => { finished++; } };
    manager.bindMutationSettlement(win.webContents, lease);
    win.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", "private", true);
    win.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "private", false);
    expect(manager.mutationLeasesByContents.has(win.webContents)).toBe(true);
    expect(() => manager.reloadContents(win.webContents)).toThrow("sign-in");
    win.webContents.emit("did-finish-load");
    await new Promise(resolve => setImmediate(resolve));
    expect(finished).toBe(1); expect(failed).toBe(0);
    expect(manager.mutationLeasesByContents.has(win.webContents)).toBe(false);
    manager.bindMutationSettlement(win.webContents, lease);
    win.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "private", true);
    expect(failed).toBe(1);
    expect(manager.mutationLeasesByContents.has(win.webContents)).toBe(false);
  } finally { manager.destroy(); }
});

test("API panel retry uses its fixed section and preserves the mutation fence", async () => {
  const { manager } = windows();
  try {
    const win = manager.open({ url: openAiApiPanelUrl("keys") });
    win.url = "https://auth.openai.com/log-in?private=not-for-replay";
    const host = Object.assign(Object.create(BrowserHost.prototype), {
      apiPanelBrowser: manager, apiPanelWindows: new Map([["keys", win]]),
    });
    await host.reloadApiPanelContents(win.webContents);
    expect(win.loads.at(-1)).toBe(openAiApiPanelUrl("keys"));
    const count = win.loads.length;
    manager.bindMutationSettlement(win.webContents, { fail() {}, finish() {} });
    await expect(host.reloadApiPanelContents(win.webContents)).rejects.toThrow("sign-in");
    expect(win.loads).toHaveLength(count);
  } finally { manager.destroy(); }
});

test("renderer death settles a sign-in lease once and leaves explicit retry available", async () => {
  const { manager } = windows();
  try {
    const win = manager.open();
    const failures: Error[] = [];
    const before = ["did-finish-load", "did-fail-load", "render-process-gone"].map(name => win.webContents.listenerCount(name));
    manager.bindMutationSettlement(win.webContents, { fail: (error: Error) => failures.push(error), finish() {} });
    win.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("renderer stopped");
    expect(manager.mutationLeasesByContents.has(win.webContents)).toBe(false);
    expect(["did-finish-load", "did-fail-load", "render-process-gone"].map(name => win.webContents.listenerCount(name))).toEqual(before);
    await manager.loadWindow(win, openAiApiPanelUrl());
    win.destroy();
    expect(failures).toHaveLength(1);
  } finally { manager.destroy(); }
});

test("security recovery preserves a human draft and refuses a changed page owner", async () => {
  const loads: string[] = [];
  let observations = 0;
  const contents = { getURL: () => "https://chatgpt.com/?temporary-chat=true", isDestroyed: () => false,
    executeJavaScript: async () => { observations++; return { draft: true, running: false }; },
    loadURL: async (url: string) => { loads.push(url); } };
  const host = Object.assign(Object.create(BrowserHost.prototype), { view: { webContents: contents },
    turnTabs: new Map(), authGeneration: 1, setState() {} });
  await expect(host.reloadHomeAfterCloudflareChallenge()).rejects.toThrow("browser work");
  expect(observations).toBe(1);
  contents.executeJavaScript = async () => { observations++; host.authGeneration++; return { draft: false, running: false }; };
  await expect(host.reloadHomeAfterCloudflareChallenge()).rejects.toMatchObject({ code: "CHALLENGE_RECOVERY_SUPERSEDED" });
  expect(observations).toBe(2);
  expect(loads).toEqual([]);
}, 5_000);

test("a challenged owned turn is reported without reloading or terminating its owner", () => {
  const logs: unknown[] = [];
  const tab = { view: { webContents: { id: 2, isDestroyed: () => false } }, message: "", status: "running" };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: { id: 1, isDestroyed: () => false } }, turnTabs: new Map([["owned", tab]]),
    logger: { warn: (...args: unknown[]) => logs.push(args) }, scheduleNetworkEgressCheck() {},
    snapshot: () => ({}), publishState() {},
  });
  expect(host.handleChatGptBackendResponse({ webContentsId: 2, url: "https://chatgpt.com/backend-api/conversation",
    statusCode: 403, responseHeaders: { "cf-mitigated": ["challenge"] } })).toBe(true);
  expect(tab.status).toBe("running");
  expect(tab.message).toContain("will not be reloaded");
  expect(JSON.stringify(logs)).not.toContain("backend-api");
});

test("explicit reload drains background inspection and still refuses a live login", async () => {
  const calls: string[] = [];
  const contents = { reload: () => calls.push("reload"), isDestroyed: () => false,
    getURL: () => "https://chatgpt.com/", getTitle: () => "ChatGPT", isLoading: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false } };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: contents }, state: { status: "idle" }, turnTabs: new Map(), selectedTabId: "home",
    getBrowserInteractionMode: () => "automatic", readOnlyInspection: { name: "session verification retry" },
    manualOperation: "session verification retry",
    async cancelReadOnlyInspection() {
      calls.push("cancel"); await Promise.resolve(); this.readOnlyInspection = null; this.manualOperation = null;
    },
  });
  expect(host.snapshot().navigationLocked).toBe(false);
  await host.navigate("reload");
  expect(calls).toEqual(["cancel", "reload"]);
  host.loginOperation = {};
  await expect(host.navigate("reload")).rejects.toThrow("ChatGPT login");
  expect(calls).toEqual(["cancel", "reload"]);
});

test("API sign-in verifies the same account's existing ChatGPT page without requiring Platform to redirect there", async () => {
  const session = {};
  let reads = 0;
  const apiContents = { session, getURL: () => openAiApiPanelUrl(), isDestroyed: () => false,
    executeJavaScript: () => { throw new Error("Must not read Platform as ChatGPT identity"); } };
  const page = { session, getURL: () => "https://chatgpt.com/", isDestroyed: () => false,
    executeJavaScript: async () => { reads++; return { payload: { user: { id: "fixture-account", name: "Fixture" } } }; } };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    apiPanelContents: new Map([[apiContents, {}]]), view: { webContents: page }, turnTabs: new Map(),
  });
  const evidence = await host.observeWorkspaceSessionMutation({ context: { contents: apiContents } });
  expect(evidence.status).toBe("authenticated");
  expect(reads).toBe(2);
  host.view = null;
  await expect(host.observeWorkspaceSessionMutation({ context: { contents: apiContents } })).rejects.toThrow("this account's ChatGPT page");
}, 5_000);
