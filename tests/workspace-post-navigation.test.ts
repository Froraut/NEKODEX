import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { BrowserWorkspaceWindows } = require("../launcher/electron/browser-workspace-windows.cjs");
const { BrowserHost } = require("../launcher/electron/browser-host.cjs");
const { AccountSessionMutationCoordinator } = require("../launcher/electron/browser-workspace-session-mutations.cjs");
const { openAiApiPanelUrl, allowedOpenAiApiPanelUrl, openAiApiSessionMutation } = require("../launcher/electron/openai-api-panel.cjs");

class WindowFixture extends EventEmitter {
  static nextId = 1;
  destroyed = false;
  loads: string[] = [];
  url = "";
  webContents: any;
  constructor(options: any) {
    super();
    this.webContents = Object.assign(new EventEmitter(), {
      id: WindowFixture.nextId++, session: options.session, isDestroyed: () => this.destroyed,
      getURL: () => this.url, setWindowOpenHandler() {},
    });
  }
  isDestroyed() { return this.destroyed; }
  loadURL(url: string) { this.loads.push(url); this.url = url; return Promise.resolve(); }
  setTitle() {} show() {} focus() {}
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } }
}

function fixture() {
  let beforeRequest!: (request: any, callback: (result: any) => void) => void;
  let beginCount = 0;
  const coordinator = new AccountSessionMutationCoordinator({ accountId: "default",
    canMutateAccountSession: () => ({ allowed: true }),
    verify: () => new Promise(() => {}),
  });
  const session = { webRequest: {
    onBeforeRequest(_filter: unknown, callback: typeof beforeRequest) { beforeRequest = callback; },
    onErrorOccurred() {},
  } };
  const host: any = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: { session } }, workspaceSessionMutation: coordinator,
    workspaceMetadata: new Map(), apiPanelContents: new Map(), workspaceMutationRequests: new Map(),
    logger: { warn() {} }, workspaceChanged() {},
  });
  const manager = new BrowserWorkspaceWindows({ BrowserWindow: WindowFixture, session,
    accountId: "default", label: "Fixture", persistLocations: false, manifestPath: "/unused/manifest.json",
    home: openAiApiPanelUrl(), allowedUrl: allowedOpenAiApiPanelUrl, isSessionMutation: openAiApiSessionMutation,
    beginSessionMutation: (request: any) => { beginCount++; return coordinator.begin(request); },
    ownsSessionMutation: (request: any) => coordinator.owns(request),
    register(contents: any, win: any, metadata: any) {
      host.workspaceMetadata.set(contents, metadata); host.apiPanelContents.set(contents, win);
    },
    unregister(contents: any) { host.workspaceMetadata.delete(contents); host.apiPanelContents.delete(contents); },
    external() {},
  });
  host.apiPanelBrowser = manager;
  host.bindWorkspaceSessionRequestGuard();
  const request = (win: WindowFixture, id = 1) => {
    let result: any;
    beforeRequest({ id, webContentsId: win.webContents.id, method: "POST", url: "https://auth.openai.com/log-in" },
      value => { result = value; });
    return result;
  };
  const navigate = (win: WindowFixture) => {
    let prevented = false;
    win.webContents.emit("will-navigate", { preventDefault() { prevented = true; } }, "https://auth.openai.com/log-in");
    return prevented;
  };
  return { host, manager, coordinator, request, navigate, begins: () => beginCount,
    cleanup() { coordinator.invalidate("fixture complete"); manager.destroy(); } };
}

test("a renderer form navigation keeps its original POST instead of replaying its URL", () => {
  const f = fixture();
  try {
    const win = f.manager.open();
    expect(f.navigate(win)).toBe(false);
    expect(f.begins()).toBe(1);
    expect(win.loads).toEqual([openAiApiPanelUrl()]);
    expect(f.request(win)).toEqual({});
    expect(f.begins()).toBe(1);
  } finally { f.cleanup(); }
});

test("request-first ownership is reused by the same source while verification is pending", async () => {
  const f = fixture();
  try {
    const win = f.manager.open();
    expect(f.request(win, 17)).toEqual({});
    const generation = f.coordinator.snapshot().generation;
    f.host.handleWorkspaceSessionMutationCompleted({ id: 17, statusCode: 200, url: "https://auth.openai.com/log-in" });
    await Promise.resolve();
    expect(f.coordinator.snapshot().admissionBlocked).toBe(true);
    expect(f.navigate(win)).toBe(false);
    expect(f.coordinator.snapshot().generation).toBe(generation);
    expect(f.begins()).toBe(0); // The request guard acquired the single owner directly.
    expect(win.loads).toEqual([openAiApiPanelUrl()]);
  } finally { f.cleanup(); }
});

test("another source cannot reuse the pending account mutation", () => {
  const f = fixture();
  try {
    const owner = f.manager.open();
    const other = f.manager.open();
    expect(f.request(owner, 1)).toEqual({});
    expect(f.navigate(other)).toBe(true);
    expect(f.request(other, 2)).toEqual({ cancel: true });
    expect(f.coordinator.snapshot().mutation.sourceId).toBe(f.manager.windowMeta.get(owner).id);
    expect(other.loads).toEqual([openAiApiPanelUrl()]);
  } finally { f.cleanup(); }
});
