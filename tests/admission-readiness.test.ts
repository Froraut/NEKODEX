import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicChatError } from "../src/chat-completions/http";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";

const require = createRequire(import.meta.url);
const { BrowserAdmissionQueue, ACCOUNT_NOT_READY_GRACE_MS } = require("../launcher/electron/browser-admission-queue.cjs");
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { BrowserControlServer } = require("../launcher/electron/control-server.cjs");
const { admissionFailureMessage, READINESS_CODES } = require("../launcher/electron/admission-failure-copy.cjs");

const owner = {
  traceId: "trace_unready01", helperPid: process.pid, reveal: false, key: null, connector: "Codex Native6",
  retained: false, effort: "low", routingKey: null, taskProgressVersion: 1, requestedAccountId: "default",
  requestedModel: "chatgpt-web/gpt-5.6-sol-instant",
};

function queueWith(inspect: () => unknown, options: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-admission-"));
  let now = 1_000_000;
  let dispatched = 0;
  const file = join(dir, "admission-queue.json");
  const make = (extra: Record<string, unknown> = {}) => new BrowserAdmissionQueue({
    file, inspect,
    dispatch: async () => { dispatched += 1; return { surfaceId: "s".repeat(32) }; },
    releaseUnsent: async () => true, clock: () => now, alive: () => true, autoPump: false,
    accountLabel: (id: string) => id === "default" ? "Primary account" : undefined, ...options, ...extra,
  });
  const queue = make();
  return {
    queue, file, make, dispatched: () => dispatched,
    advance: (ms: number) => { now += ms; },
    // The live helper polls every 500 ms; keep the owner fresh across a long hold.
    poll: (q = queue) => q.request({ ...owner }),
    cleanup: () => { queue.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

async function holdFor(q: ReturnType<typeof queueWith>, ms: number) {
  for (let held = 0; held < ms; held += 5_000) { q.advance(5_000); q.poll(); await q.queue.pump(); }
}

test("an account without its tool tunnel fails the queued task with that cause, naming the account", async () => {
  const q = queueWith(() => ({ reason: "account-not-ready", blocker: "account_tunnel_unconfigured", accountId: "default" }));
  try {
    expect(q.poll()).toMatchObject({ queued: true, notSent: true });
    await q.queue.pump();
    await holdFor(q, ACCOUNT_NOT_READY_GRACE_MS - 5_000);
    const waiting = q.queue.snapshot().entries[0];
    expect(waiting).toMatchObject({ status: "waiting", reason: "account-not-ready", cause: "account_tunnel_unconfigured", causeAccountId: "default" });
    expect(waiting.failsAt).toBeGreaterThan(0);
    await holdFor(q, 5_000);
    expect(q.queue.snapshot().entries[0]).toMatchObject({ status: "failed", cause: "account_tunnel_unconfigured" });
    let error: any;
    try { q.poll(); } catch (caught) { error = caught; }
    expect(error.message).toContain("“Primary account” has no tool tunnel");
    expect(error).toMatchObject({ code: "account_tunnel_unconfigured", workStarted: false });
    await expect(q.queue.cancelOwner(owner.traceId, owner.helperPid)).resolves.toEqual({ cancelled: true, notSent: true });
    expect(q.dispatched()).toBe(0);
  } finally { q.cleanup(); }
});

test("the cause is written in the launcher language", () => {
  expect(admissionFailureMessage("account_tunnel_unconfigured", "ru", "Основной")).toContain("Настроить туннель этого аккаунта");
  expect(admissionFailureMessage("account_unchecked", "ja", undefined)).toContain("コネクター確認");
  expect(admissionFailureMessage("account_disabled", "en", "Team $& $' $$")).toContain("“Team $& $' $$” is disabled");
  for (const language of ["en", "ru", "zh-CN", "zh-TW", "ja", "ko"]) {
    for (const code of READINESS_CODES) expect(admissionFailureMessage(code, language, "A")).not.toContain("{");
  }
});

test("a later attempt for the same never-sent execution gets a fresh check after the cause was reported", async () => {
  let held: unknown = { reason: "account-not-ready", blocker: "account_signed_out", accountId: "default" };
  const q = queueWith(() => held);
  try {
    q.poll(); await q.queue.pump();
    await holdFor(q, ACCOUNT_NOT_READY_GRACE_MS);
    expect(() => q.poll()).toThrow("not signed in");
    held = null; // the user signed in
    expect(q.poll()).toMatchObject({ queued: true });
    await q.queue.pump();
    expect(q.dispatched()).toBe(1);
  } finally { q.cleanup(); }
});

test("capacity holds neither start nor reset the readiness deadline", async () => {
  let held: unknown = { reason: "account-not-ready", blocker: "account_tunnel_not_ready" };
  const q = queueWith(() => held);
  try {
    q.poll(); await q.queue.pump();
    const deadline = q.queue.snapshot().entries[0].failsAt;
    held = { reason: "capacity" };
    await holdFor(q, ACCOUNT_NOT_READY_GRACE_MS + 5_000);
    // The running deadline and its cause stay visible beside the capacity reason.
    expect(q.queue.snapshot().entries[0]).toMatchObject({ status: "waiting", reason: "capacity",
      cause: "account_tunnel_not_ready", failsAt: deadline });
    held = { reason: "account-not-ready", blocker: "account_tunnel_not_ready" };
    q.advance(1_000); q.poll(); await q.queue.pump();
    expect(q.queue.snapshot().entries[0].status).toBe("failed");
  } finally { q.cleanup(); }
});

test("checking, busy and paused accounts hold without a deadline; a recovered account is admitted", async () => {
  let held: unknown = { reason: "account-checking" };
  const q = queueWith(() => held);
  try {
    q.poll();
    for (const reason of ["account-checking", "account-busy", "paused-account"]) {
      held = { reason };
      await holdFor(q, ACCOUNT_NOT_READY_GRACE_MS * 2);
      expect(q.queue.snapshot().entries[0]).toMatchObject({ status: "waiting", reason, cause: null, failsAt: null });
    }
    held = { reason: "account-not-ready", blocker: "account_signed_out" };
    await holdFor(q, 5_000);
    held = null;
    await holdFor(q, 5_000);
    expect(q.dispatched()).toBe(1);
  } finally { q.cleanup(); }
});

test("a retained conversation without an owner fails at once with its recoverable code", async () => {
  const q = queueWith(() => ({ reason: "predispatch-failure", failure: "retained_conversation_unavailable" }));
  try {
    q.poll(); await q.queue.pump();
    expect(() => q.poll()).toThrow("retained ChatGPT conversation");
    expect(q.queue.snapshot().entries[0]).toMatchObject({ status: "failed", cause: null, failure: "retained_conversation_unavailable" });
    expect(q.dispatched()).toBe(0);
  } finally { q.cleanup(); }
});

test("a dispatch-time tunnel cause waits out the grace instead of failing without a cause", async () => {
  const q = queueWith(() => null, {
    dispatch: async () => { throw Object.assign(new Error("tunnel"), { code: "account_tunnel_unavailable", workStarted: false, blocker: "account_tunnel_not_ready", accountId: "default" }); },
  });
  try {
    q.poll(); await q.queue.pump();
    expect(q.queue.snapshot().entries[0]).toMatchObject({ status: "waiting", reason: "account-not-ready", cause: "account_tunnel_not_ready" });
    await holdFor(q, ACCOUNT_NOT_READY_GRACE_MS);
    expect(() => q.poll()).toThrow("tool tunnel that is not running");
  } finally { q.cleanup(); }
});

test("a live owner that missed polls continues; a stale deadline never survives a pause", async () => {
  const q = queueWith(() => ({ reason: "account-not-ready", blocker: "account_signed_out" }));
  try {
    q.poll(); await q.queue.pump();
    q.advance(60_000); await q.queue.pump(); // the Mac slept: no polls for a minute
    expect(q.queue.snapshot().entries[0]).toMatchObject({ status: "paused", reason: "owner-reconnect-required" });
    q.poll(); // same helper process polls again
    expect(q.queue.snapshot().entries[0].status).toBe("waiting");
    await q.queue.pump();
    expect(q.queue.snapshot().entries[0].status).toBe("waiting"); // fresh grace, not the minute-old one
  } finally { q.cleanup(); }
});

test("work restored after a restart still waits for Resume, and Resume starts a fresh grace", async () => {
  const q = queueWith(() => ({ reason: "account-not-ready", blocker: "account_signed_out" }));
  try {
    q.poll(); await q.queue.pump();
    await holdFor(q, 30_000);
    q.queue.close();
    const restarted = q.make();
    try {
      q.poll(restarted);
      expect(restarted.snapshot().entries[0]).toMatchObject({ status: "paused", ownerConnected: true, canResume: true });
      await restarted.action(restarted.snapshot().entries[0].id, "resume");
      q.poll(restarted); await restarted.pump();
      expect(restarted.snapshot().entries[0].status).toBe("waiting");
    } finally { restarted.close(); }
  } finally { q.cleanup(); }
});

test("journal: readiness causes stay out of terminalFailure, old 6.1.18 rows load, unknown codes do not disable the queue", async () => {
  const q = queueWith(() => ({ reason: "account-not-ready", blocker: "account_unchecked", accountId: "default" }));
  try {
    q.poll(); await q.queue.pump();
    await holdFor(q, ACCOUNT_NOT_READY_GRACE_MS);
    const saved = JSON.parse(readFileSync(q.file, "utf8"));
    expect(saved.entries[0].terminalFailure).toBeUndefined();
    expect(saved.entries[0]).toMatchObject({ status: "failed", admissionBlocker: "account_unchecked", blockerAccountId: "default" });
    // A 6.1.18 journal row and a row from a newer launcher.
    saved.entries[0] = { ...saved.entries[0], admissionBlocker: undefined, terminalFailure: { code: "account_signed_out", workStarted: false } };
    saved.entries.push({ ...saved.entries[0], id: "00000000-0000-4000-8000-000000000001",
      request: { ...saved.entries[0].request, traceId: "trace_future01" }, terminalFailure: { code: "future_code", workStarted: false } });
    writeFileSync(q.file, JSON.stringify(saved));
    q.queue.close();
    const reloaded = q.make();
    try {
      expect(reloaded.storageIssue).toBeNull();
      expect(reloaded.snapshot().entries.map((row: { cause: string | null }) => row.cause)).toEqual(["account_signed_out", null]);
      // The cause was reported before the restart, so the next attempt gets a fresh check.
      expect(q.poll(reloaded)).toMatchObject({ queued: true });
    } finally { reloaded.close(); }
  } finally { q.cleanup(); }
});

// A minimal account pool exercising the real previewAdmission/chooseAccount code.
function poolWith({ mode = "selected", accounts = ["default"], tunnels = {}, connectors = {}, caps = {}, authenticated = {},
  operations = {}, paused = [] as string[], affinity = {}, refreshing = [] as string[], getAccountTunnel = undefined as any, tabs = {} as Record<string, any[]> } = {}) {
  const fullCaps = { solAvailable: true, proAvailable: true, extraHighAvailable: true, modelCapabilities: { families: { "5.6": ["low", "medium", "high", "xhigh", "max"], "6": ["max"] }, names: {} } };
  const pool = Object.create(AccountBrowserPool.prototype);
  const hosts = new Map(accounts.map(id => [id, {
    state: { authenticated: (authenticated as any)[id] ?? true },
    turnTabs: new Map((tabs[id] ?? []).map((tab, index) => [`tab-${index}`, tab])),
    exactRetainedTurnTab: (key: string) => (tabs[id] ?? []).find(tab => tab.conversationKey === key && tab.status === "ready"),
  }]));
  Object.assign(pool, {
    registry: { snapshot: () => ({ mode, selectedId: accounts[0], accounts: accounts.map(id => ({ id, label: id, enabled: true })) }) },
    hosts, getHost: (id: string) => hosts.get(id),
    capabilities: new Map(accounts.filter(id => (caps as any)[id] !== null).map(id => [id, (caps as any)[id] ?? fullCaps])),
    connectors: new Map(accounts.filter(id => (connectors as any)[id] !== false).map(id => [id, "Codex Native6"])),
    traceOwners: new Map(), affinity: new Map(Object.entries(affinity)), pendingAffinity: new Map(), reservations: new Map(),
    lastAssigned: new Map(), taskLedgers: new Map(), turnAdmission: { open: true }, destroyed: false,
    evidenceRefreshing: new Set(refreshing), authenticationRefreshOperations: new Map(), initializingHosts: false,
    accountOperationLabel: (id: string) => (operations as any)[id] ?? null,
    admissionQueue: { accountPaused: (id: string) => paused.includes(id) },
    safety: { availability: () => ({ eligible: true }) },
    options: { maxTabs: 16, getAccountTunnel: getAccountTunnel ?? ((id: string) => {
      const status = (tunnels as any)[id] ?? "ready";
      return { accountId: id, status, ready: status === "ready", required: true };
    }) },
  });
  const request = (extra: Record<string, unknown> = {}) => ({ traceId: "trace_pool01", key: null, retained: false,
    requestedModel: "chatgpt-web/gpt-5.6-sol-instant", effort: "low", connector: "Codex Native6", routingKey: null,
    requestedAccountId: mode === "selected" ? accounts[0] : null, ...extra });
  return { preview: (extra?: Record<string, unknown>) => pool.previewAdmission(request(extra)) };
}

test("pool: names the concrete cause of the account the task would use", () => {
  expect(poolWith().preview()).toBeNull();
  expect(poolWith({ tunnels: { default: "unconfigured" } }).preview()).toEqual({ reason: "account-not-ready", blocker: "account_tunnel_unconfigured", accountId: "default" });
  expect(poolWith({ tunnels: { default: "starting" } }).preview()).toMatchObject({ blocker: "account_tunnel_not_ready" });
  expect(poolWith({ authenticated: { default: false } }).preview()).toMatchObject({ blocker: "account_signed_out" });
  expect(poolWith({ caps: { default: null } }).preview()).toMatchObject({ blocker: "account_unchecked" });
  expect(poolWith({ caps: { default: { solAvailable: true, modelCapabilities: { families: { "5.6": ["high"] }, names: {} } } } }).preview())
    .toMatchObject({ blocker: "account_model_unavailable" });
  expect(poolWith({ connectors: { default: false } }).preview()).toMatchObject({ blocker: "account_connector_unverified" });
});

test("pool: a task pinned to another account reports that account, not the selected one", () => {
  const routingKey = "a".repeat(64);
  const pool = poolWith({ accounts: ["default", "b2c3d4e5-0000-4000-8000-000000000000"], tunnels: { "b2c3d4e5-0000-4000-8000-000000000000": "unconfigured" },
    affinity: { [routingKey]: "b2c3d4e5-0000-4000-8000-000000000000" } });
  expect(pool.preview({ routingKey })).toEqual({ reason: "account-not-ready", blocker: "account_tunnel_unconfigured", accountId: "b2c3d4e5-0000-4000-8000-000000000000" });
});

test("pool: balanced mode names a cause only when every account shares it", () => {
  const b = "b2c3d4e5-0000-4000-8000-000000000000";
  expect(poolWith({ mode: "balanced", accounts: ["default", b], tunnels: { default: "unconfigured", [b]: "unconfigured" } }).preview())
    .toMatchObject({ reason: "account-not-ready", blocker: "account_tunnel_unconfigured" });
  expect(poolWith({ mode: "balanced", accounts: ["default", b], tunnels: { default: "unconfigured" }, authenticated: { [b]: false } }).preview())
    .toMatchObject({ reason: "account-not-ready", blocker: "account_not_ready" });
});

test("pool: startup checks, account operations and per-account pauses are transient holds", () => {
  const b = "b2c3d4e5-0000-4000-8000-000000000000";
  expect(poolWith({ refreshing: ["default"], authenticated: { default: false } }).preview()).toEqual({ reason: "account-checking" });
  expect(poolWith({ operations: { default: "Codex account sign-in" } }).preview()).toEqual({ reason: "account-busy" });
  expect(poolWith({ mode: "balanced", accounts: ["default", b], paused: ["default"], tunnels: { [b]: "unconfigured" } }).preview())
    .toEqual({ reason: "paused-account" });
});

test("pool: an exact retained page still needs its tunnel, and a failing diagnosis never escapes", () => {
  const key = "c".repeat(64);
  expect(poolWith({ tunnels: { default: "error" }, tabs: { default: [{ traceId: "older", conversationKey: key, status: "ready", interactionMode: "automatic", connectorIdentity: "Codex Native6" }] } })
    .preview({ key })).toMatchObject({ reason: "account-not-ready", blocker: "account_tunnel_not_ready" });
  const throwing = poolWith({ getAccountTunnel: () => { throw new Error("Account tunnel bindings are invalid"); } });
  expect(throwing.preview()).toMatchObject({ reason: "account-not-ready", blocker: "account_not_ready" });
});

test("pool: a retained conversation with no owner is a predispatch failure", () => {
  expect(poolWith({ mode: "balanced" }).preview({ retained: true, key: "d".repeat(64) }))
    .toEqual({ reason: "predispatch-failure", failure: "retained_conversation_unavailable" });
});

test("control server answers a readiness failure with 409 account_not_ready and its cause", async () => {
  const host = { browserInteractionMode: () => "automatic", queueTurn() {
    throw Object.assign(new Error("No request was sent: cause"), { code: "account_unchecked", workStarted: false });
  } };
  const logger = { info() {}, warn() {}, error() {} };
  const server = new BrowserControlServer({ logger, getBrowserHost: () => host, getPreferences: () => ({}), resolveNativeProxy: () => null });
  await server.start();
  try {
    const { endpoint, token } = server.descriptor();
    const response = await fetch(`${endpoint}/v1/turn/start`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ phase: "start", taskProgressVersion: 1, requestedModel: "chatgpt-web/gpt-5.6-sol-instant", requestedEffort: "low",
        traceId: "trace_server01", helperPid: process.pid, mutationId: "0b1c2d3e-4f50-4617-8899-aabbccddeeff" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "No request was sent: cause", code: "account_not_ready", reason: "account_unchecked", workStarted: false });
  } finally { await server.close(); }
});

test("Chat Completions reports an unready account as a 400 with its cause, not an uncertain 502", () => {
  const error = new ChatGptWebAdapterError("No request was sent: cause", { status: 409, errorType: "invalid_request_error", code: "account_not_ready", retryable: false });
  expect(publicChatError(error)).toEqual({ status: 400, body: { error: { message: "No request was sent: cause", type: "invalid_request_error", code: "account_not_ready", param: null } } });
});
