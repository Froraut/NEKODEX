import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BrowserHost } = require("../launcher/electron/browser-host.cjs");
const { AccountBrowserPool, accountScopedLogger } = require("../launcher/electron/account-pool.cjs");

const TEMPORARY_CHAT = "https://chatgpt.com/?temporary-chat=true";
const challenge = (webContentsId: number) => ({ webContentsId, statusCode: 403,
  url: "https://chatgpt.com/backend-api/me", responseHeaders: { "cf-mitigated": ["challenge"] } });
const success = (webContentsId: number) => ({ webContentsId, statusCode: 200, url: "https://chatgpt.com/backend-api/me" });

function homeHost(overrides: Record<string, unknown> = {}) {
  const logs: any[] = [];
  const throttling: boolean[] = [];
  const loads: string[] = [];
  const contents = { id: 7, getURL: () => TEMPORARY_CHAT, isDestroyed: () => false,
    setBackgroundThrottling: (value: boolean) => { throttling.push(value); },
    loadURL: async (url: string) => { loads.push(url); } };
  const record = (event: string, detail: unknown) => logs.push([event, detail]);
  const host: any = Object.assign(Object.create(BrowserHost.prototype), {
    view: { webContents: contents }, turnTabs: new Map(), authGeneration: 1, destroyed: false,
    cloudflareChallengeRecovery: null, cloudflareChallengeRecoveryArmed: true,
    cloudflareChallengeDeferred: false, cloudflareChallengeDeferredTimer: null,
    networkEgressCheckedAt: Date.now(), setState() {},
    logger: { info: record, warn: record, error: record },
    ...overrides,
  });
  return { host, contents, logs, throttling, loads };
}

test("a challenge during browser work is deferred once and recovered after the work ends", async () => {
  const { host, logs } = homeHost({ manualOperation: "connector verification" });
  let recoveries = 0;
  host.reloadHomeAfterCloudflareChallenge = async () => { recoveries++; };
  expect(host.handleChatGptBackendResponse(challenge(7))).toBe(true);
  expect(host.handleChatGptBackendResponse(challenge(7))).toBe(true);
  expect(host.cloudflareChallengeDeferred).toBe(true);
  expect(logs.filter(([event]) => event === "browser.cloudflare_challenge_not_reloaded")).toHaveLength(1);
  // Still owned: nothing reloads.
  host.resumeDeferredCloudflareChallenge();
  expect(recoveries).toBe(0);
  host.manualOperation = null;
  host.resumeDeferredCloudflareChallenge();
  await host.cloudflareChallengeRecovery;
  expect(recoveries).toBe(1);
  expect(host.cloudflareChallengeDeferred).toBe(false);
  expect(logs.map(([event]) => event)).toContain("browser.cloudflare_challenge_detected");
  clearInterval(host.cloudflareChallengeDeferredTimer);
});

test("a later successful backend response cancels the deferred recovery", () => {
  const { host } = homeHost({ readOnlyInspection: { name: "session verification retry" } });
  let recoveries = 0;
  host.reloadHomeAfterCloudflareChallenge = async () => { recoveries++; };
  host.handleChatGptBackendResponse(challenge(7));
  expect(host.cloudflareChallengeDeferred).toBe(true);
  host.handleChatGptBackendResponse(success(7));
  host.readOnlyInspection = null;
  host.resumeDeferredCloudflareChallenge();
  expect(recoveries).toBe(0);
  clearInterval(host.cloudflareChallengeDeferredTimer);
});

test("sign-in waiting reloads a challenged ChatGPT page at a bounded rate, never an auth page", async () => {
  const { host, loads } = homeHost({ cloudflareChallengeDeferred: true });
  let probes = 0;
  host.probeAuthentication = async () => {
    probes++;
    host.lastAuthenticationSurfaceObservation = { composer: probes > 1, readyState: "complete" };
    return { authenticated: probes > 1 };
  };
  await expect(host.waitForAuthenticated(5_000)).resolves.toMatchObject({ authenticated: true });
  expect(loads).toEqual([TEMPORARY_CHAT]);

  const auth = homeHost({ cloudflareChallengeDeferred: true });
  auth.contents.getURL = () => "https://auth.openai.com/log-in";
  auth.host.probeAuthentication = async () => {
    auth.host.lastAuthenticationSurfaceObservation = { composer: false, readyState: "complete" };
    return { authenticated: false };
  };
  await expect(auth.host.waitForAuthenticated(1_000)).rejects.toThrow("before the timeout");
  expect(auth.loads).toEqual([]);
}, 15_000);

test("a read-only check unthrottles the hidden page for its duration", async () => {
  const { host, throttling } = homeHost({ readOnlyInspection: null, manualOperation: null, ready: async () => {} });
  let throttledDuringAction: boolean | undefined;
  await host.withReadOnlyInspection("session verification retry", async () => {
    throttledDuringAction = throttling.at(-1);
    return true;
  }, { preserveSelection: true });
  expect(throttledDuringAction).toBe(false);
  expect(throttling).toEqual([false, true]);
});

test("account logs carry the account id unless the event already names one", () => {
  const events: any[] = [];
  const base = { info: (event: string, detail: unknown) => events.push([event, detail]), recent: () => "kept" };
  const logger = accountScopedLogger(base, "875bc05d");
  logger.info("browser.authenticated", { origin: "https://chatgpt.com" });
  logger.info("browser.login_opened");
  logger.info("browser.account_refresh_failed", { accountId: "default" });
  expect(events).toEqual([
    ["browser.authenticated", { accountId: "875bc05d", origin: "https://chatgpt.com" }],
    ["browser.login_opened", { accountId: "875bc05d" }],
    ["browser.account_refresh_failed", { accountId: "default" }],
  ]);
  expect(logger.recent()).toBe("kept");
});

test("startup checks the selected account first, then every other session before their probes", async () => {
  const calls: string[] = [];
  const hosts = new Map(["default", "prim2", "third"].map(id => [id, {
    state: { authenticated: true },
    refreshAuthentication: async () => { calls.push(`session:${id}`); },
    inspectSession: async () => { calls.push(`inspect:${id}`); return {}; },
    verifyConnector: async () => { calls.push(`connector:${id}`); },
    connectorName: () => "Codex Native6",
  }]));
  const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => ({ selectedId: "default", accounts: [
      { id: "prim2", enabled: true }, { id: "default", enabled: true }, { id: "third", enabled: true }] }) },
    leases: () => ({ exclusiveLabel: () => null }),
    getHost: (id: string) => hosts.get(id),
    invalidateEvidence: () => 1, evidenceIsCurrent: () => true, recordCapabilityEvidence() {},
    options: { bootstrapAccountConnectors: () => true }, connectors: new Map(),
    logger: { info() {}, warn() {} }, publish() {}, snapshot: () => ({}),
    inspectionsPaused: false, destroyed: false,
  });
  await pool.refreshAuthentication();
  expect(calls).toEqual([
    "session:default", "inspect:default", "connector:default",
    "session:prim2", "session:third",
    "inspect:prim2", "connector:prim2", "inspect:third", "connector:third",
  ]);
});

test("an account whose evidence is being rebuilt reports it as checking", () => {
  const host = { state: { authenticated: true, authenticationStatus: "verified" }, turnTabs: new Map(),
    readOnlyInspection: null, connectorName: () => "Codex Native6", authPrincipalFingerprint: null };
  const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => ({ selectedId: "default", accounts: [{ id: "default", enabled: true }, { id: "prim2", enabled: true }] }) },
    reservations: new Map(), hosts: new Map([["default", host]]), capabilities: new Map(), connectors: new Map(),
    evidenceRefreshing: new Set(["default"]), evidenceRestores: new Map(), authenticationRefreshOperations: new Map(),
    network: { get: () => null }, safety: { snapshot: () => null, availability: () => "available" },
    toolProof: { snapshot: () => null }, accountTunnel: () => null, observationStamp: () => 1, evidenceEpoch: () => 1,
  });
  const [primary, other] = pool.accountSnapshot().accounts;
  expect(primary).toMatchObject({ evidenceChecking: true, checked: false });
  // A host that is not created yet but is queued for its check reads as checking, not as signed out.
  pool.evidenceRefreshing.add("prim2");
  expect(pool.accountSnapshot().accounts[1]).toMatchObject({ evidenceChecking: true, authenticationStatus: "unknown" });
  pool.evidenceRefreshing.clear();
  expect(pool.accountSnapshot().accounts[0]).toMatchObject({ evidenceChecking: false });
  expect(other.evidenceChecking).toBe(false);
});

test("an evidence restore that times out retries with pauses until the account checks out", async () => {
  const host = { state: { authenticated: true }, activeTraceId: null };
  const events: string[] = [];
  let attempts = 0;
  const capabilities = new Map();
  const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
    hosts: new Map([["prim2", host]]), capabilities, connectors: new Map(), reservations: new Map(),
    destroyed: false, inspectionsPaused: false, accountOperationLabel: () => null,
    accountTunnel: () => ({ required: false }), options: { bootstrapAccountConnectors: () => false, evidenceRestoreRetryDelaysMs: [5, 5, 5] },
    logger: { info: (event: string) => events.push(event), warn: (event: string) => events.push(event) }, publish() {},
    checkAccount: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("locator.getAttribute: Timeout 1000ms exceeded.");
      capabilities.set("prim2", {});
    },
  });
  pool.scheduleEvidenceRestore("prim2");
  await pool.evidenceRestores.get("prim2")?.done;
  expect(attempts).toBe(3);
  expect(capabilities.has("prim2")).toBe(true);
  expect(events.filter(event => event === "browser.account_evidence_restore_retry")).toHaveLength(2);
  expect(events).not.toContain("browser.account_evidence_restore_failed");
});

test("an evidence restore gives up after its retries and reports the failure once", async () => {
  const events: string[] = [];
  let attempts = 0;
  const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
    hosts: new Map([["prim2", { state: { authenticated: true }, activeTraceId: null }]]), capabilities: new Map(),
    connectors: new Map(), reservations: new Map(), destroyed: false, inspectionsPaused: false,
    accountOperationLabel: () => null, accountTunnel: () => ({ required: false }),
    options: { bootstrapAccountConnectors: () => false, evidenceRestoreRetryDelaysMs: [5, 5] },
    logger: { info: (event: string) => events.push(event), warn: (event: string) => events.push(event) }, publish() {},
    checkAccount: async () => { attempts += 1; throw new Error("Effort operation timed out"); },
  });
  pool.scheduleEvidenceRestore("prim2");
  await pool.evidenceRestores.get("prim2")?.done;
  expect(attempts).toBe(3);
  expect(events.filter(event => event === "browser.account_evidence_restore_failed")).toHaveLength(1);
});
