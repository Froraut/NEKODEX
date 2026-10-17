import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { BrowserHost, IDLE_BROWSER_URL, TEMPORARY_CHAT_URL } = require("../launcher/electron/browser-host.cjs");
const { BrowserAdmissionQueue } = require("../launcher/electron/browser-admission-queue.cjs");

const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

function fixture(url = TEMPORARY_CHAT_URL) {
  const events: string[] = [];
  let crashed = false;
  let reloads = 0;
  const loads: string[] = [];
  const contents: any = Object.assign(new EventEmitter(), {
    getURL: () => url, isDestroyed: () => false, isLoadingMainFrame: () => false, isCrashed: () => crashed,
    setWindowOpenHandler: () => {}, stop: () => {}, setBackgroundThrottling: () => {},
    reload: () => { reloads += 1; },
    loadURL: async (next: string) => { loads.push(next); url = next; },
  });
  const log = (event: string) => { events.push(event); };
  const host: any = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: contents }, getBrowserInteractionMode: () => "manual",
    state: { authenticated: true, authenticationStatus: "verified", status: "ready", message: "ready" },
    authGeneration: 0, authProbeRevision: 0, turnTabs: new Map(), manualOperation: null,
    logger: { info: log, warn: log, error: log, debug() {} },
    snapshot() { return { ...this.state }; }, publishState() {}, syncViewVisibility() {},
    clearHomeNavigationTimeout() {}, armHomeNavigationTimeout() {},
  });
  host.bindWebContents();
  return {
    host, contents, events, loads,
    crash: () => { crashed = true; },
    heal: () => { crashed = false; },
    reloads: () => reloads,
  };
}

test("a crashed primary ChatGPT page is reloaded automatically and reported recovered", async () => {
  const f = fixture();
  f.crash();
  f.contents.emit("render-process-gone", {}, { reason: "killed", exitCode: 15 });
  expect(f.events).toContain("browser.renderer_gone");
  expect(f.host.primaryRendererRecoveryPending()).toBe(true);
  // Skip the backoff delay; the scheduled reload is the same operation.
  expect(f.host.schedulePrimaryRendererRecovery("test", true)).toBe(true);
  await tick();
  expect(f.reloads()).toBe(1);
  expect(f.events).toContain("browser.renderer_recovery_started");
  f.heal();
  f.contents.emit("did-finish-load");
  expect(f.host.primaryRendererRecoveryPending()).toBe(false);
  expect(f.events).toContain("browser.renderer_recovered");
});

test("a crashed idle surface reloads in place and an unknown document loads the idle surface", async () => {
  const idle = fixture(IDLE_BROWSER_URL);
  idle.crash();
  idle.host.recoverPrimaryRenderer("test");
  expect(idle.reloads()).toBe(1);
  const foreign = fixture("about:blank");
  foreign.crash();
  foreign.host.recoverPrimaryRenderer("test");
  await tick();
  expect(foreign.reloads()).toBe(0);
  expect(foreign.loads).toEqual([IDLE_BROWSER_URL]);
});

test("the watchdog recovers a crash whose renderer-gone event was missed", async () => {
  const f = fixture();
  f.host.checkPrimaryRendererLiveness();
  expect(f.host.primaryRendererRecoveryPending()).toBe(false);
  f.crash();
  f.host.checkPrimaryRendererLiveness();
  expect(f.host.primaryRendererRecoveryPending()).toBe(true);
  clearTimeout(f.host.primaryRendererRecoveryTimer);
});

test("a turn waits for a crashed page to recover before it starts", async () => {
  const f = fixture();
  f.crash();
  f.contents.reload = () => { setTimeout(() => { f.heal(); f.contents.emit("did-finish-load"); }, 20); };
  await f.host.ensurePrimaryRendererLive(undefined, 2_000);
  expect(f.host.primaryRendererCrashed()).toBe(false);
  expect(f.events).toContain("browser.renderer_recovery_before_turn");
  expect(f.events).toContain("browser.renderer_recovered");
  // A live page adds no wait and no log.
  const before = f.events.length;
  await f.host.ensurePrimaryRendererLive(undefined, 2_000);
  expect(f.events.length).toBe(before);
});

test("a page that keeps crashing stops reloading and fails the turn before sending", async () => {
  const f = fixture();
  f.crash();
  f.host.primaryRendererRecoveryAttempts = Array.from({ length: 6 }, () => Date.now());
  expect(f.host.schedulePrimaryRendererRecovery("test")).toBe(false);
  expect(f.events).toContain("browser.renderer_recovery_exhausted");
  expect(f.host.state.status).toBe("error");
  await expect(f.host.ensurePrimaryRendererLive(undefined, 2_000)).rejects.toThrow("this prompt was not sent");
});

test("a reload that never settles does not block admission forever", () => {
  const f = fixture();
  f.host.primaryRendererRecovering = true;
  f.host.primaryRendererRecoveryAttempts = [Date.now() - 10 * 60_000];
  expect(f.host.primaryRendererRecoveryPending()).toBe(false);
});

const owner = {
  traceId: "trace_selfheal01", helperPid: process.pid, reveal: false, key: null, connector: "Codex Native6",
  retained: false, effort: "low", routingKey: null, taskProgressVersion: 1, requestedAccountId: "default",
  requestedModel: "chatgpt-web/gpt-5.6-sol-instant",
};

function queue() {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-selfheal-"));
  let dispatched = 0;
  const q = new BrowserAdmissionQueue({
    file: join(dir, "admission-queue.json"), inspect: () => null,
    dispatch: async () => { dispatched += 1; return { surfaceId: "s".repeat(32) }; },
    releaseUnsent: async () => true, clock: () => 1_000_000, alive: () => true, autoPump: false,
    leaseCurrent: () => true, accountLabel: () => undefined,
  });
  return { q, dispatched: () => dispatched, cleanup: () => { q.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a never-sent failure lets Codex retry the same execution instead of poisoning it", async () => {
  const { q, dispatched, cleanup } = queue();
  try {
    expect(q.request({ ...owner })).toMatchObject({ queued: true });
    await q.pump();
    expect(q.request({ ...owner })).toMatchObject({ surfaceId: "s".repeat(32) });
    q.retire(owner.traceId, owner.helperPid, true);
    // Cleaning up after the failed attempt finds nothing to cancel and journals nothing.
    await expect(q.cancelOwner(owner.traceId, owner.helperPid)).resolves.toMatchObject({ terminal: true, notSent: true });
    expect(q.request({ ...owner })).toMatchObject({ queued: true, notSent: true });
    await q.pump();
    expect(dispatched()).toBe(2);
  } finally { cleanup(); }
});

test("a sent execution stays ended and its cleanup does not mark the owner cancelled", async () => {
  const { q, cleanup } = queue();
  try {
    q.request({ ...owner });
    await q.pump();
    q.request({ ...owner });
    q.retire(owner.traceId, owner.helperPid);
    await expect(q.cancelOwner(owner.traceId, owner.helperPid)).resolves.toMatchObject({ terminal: true, notSent: false });
    expect(() => q.request({ ...owner })).toThrow("Queued task ended before a new submission");
    expect(() => q.request({ ...owner })).not.toThrow("cancelled before admission");
  } finally { cleanup(); }
});
