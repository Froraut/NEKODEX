import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { BrowserHost, TEMPORARY_CHAT_URL } = require("../launcher/electron/browser-host.cjs");

function fixture() {
  const throttling: boolean[] = [];
  const contents: any = Object.assign(new EventEmitter(), {
    getURL: () => TEMPORARY_CHAT_URL, isDestroyed: () => false, isLoadingMainFrame: () => false,
    setWindowOpenHandler: () => {}, stop: () => {},
    setBackgroundThrottling: (value: boolean) => { throttling.push(value); },
  });
  const host: any = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: contents }, getBrowserInteractionMode: () => "automatic",
    state: { authenticated: true, authenticationStatus: "verified", status: "ready", message: "ready" },
    authGeneration: 0, authProbeRevision: 0, turnTabs: new Map(), manualOperation: null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    snapshot() { return { ...this.state }; }, publishState() {}, syncViewVisibility() {}, activateHomeSurface() {},
    clearHomeNavigationTimeout() {}, armHomeNavigationTimeout() {},
  });
  host.bindWebContents();
  return { host, contents, throttling };
}

test("a page a check reloads keeps rendering frames: its throttling is turned off again", async () => {
  const { host, contents, throttling } = fixture();
  await host.withManualOperation("session inspection", async () => {
    // The hard refresh commits a new document, which comes up throttled again.
    contents.emit("did-navigate", {}, TEMPORARY_CHAT_URL, 200);
  });
  expect(throttling).toEqual([false, false, true]);
  // Outside a check the page is throttled, and a navigation leaves it so.
  contents.emit("did-navigate", {}, TEMPORARY_CHAT_URL, 200);
  expect(throttling).toEqual([false, false, true]);
});

test("a read-only check and a security refresh keep the reloaded page unthrottled too", () => {
  const { host, contents, throttling } = fixture();
  host.setHomeThrottling(contents, false);
  contents.emit("did-navigate", {}, TEMPORARY_CHAT_URL, 200);
  host.setHomeThrottling(contents, true);
  contents.emit("did-navigate", {}, TEMPORARY_CHAT_URL, 200);
  expect(throttling).toEqual([false, false, true]);
});
