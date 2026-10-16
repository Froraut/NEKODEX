import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { AccountSafety } = require("../launcher/electron/account-safety.cjs");
const { AccountOperationLeases } = require("../launcher/electron/account-operation-leases.cjs");
const { AccountToolProof } = require("../launcher/electron/account-tool-proof.cjs");
const connector = "Codex Native6";
const principal = "a".repeat(64);
const alternate = "00000000-0000-4000-8000-000000000001";

function admission(mode = "selected") {
  const config = { mode, selectedId: "default", accounts: ["default", alternate].map(id => ({ id, enabled: true })) };
  const hosts = new Map(config.accounts.map(({ id }) => [id, { state: { authenticated: true }, turnTabs: new Map() }]));
  const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => config }, hosts, getHost: (id: string) => hosts.get(id),
    connectors: new Map([[alternate, connector]]),
    capabilities: new Map(config.accounts.map(({ id }) => [id, { solAvailable: true }])),
    traceOwners: new Map(), affinity: new Map(), pendingAffinity: new Map(), reservations: new Map(),
    lastAssigned: new Map(), accountOperationLabel: () => null,
    accountTunnel: () => ({ required: true, ready: true }),
    safety: { availability: () => ({ eligible: true }) },
  });
  const select = () => pool.chooseAccount("fixture-trace", null, false, { connector, effort: "low" });
  return { pool, hosts, select };
}

test("selected account may prove an unverified connector during the real turn while other requirements remain", () => {
  const { pool, hosts, select } = admission();
  expect(select()).toBe("default");
  hosts.get("default")!.state.authenticated = false;
  expect(select).toThrow("No enabled ChatGPT account");
  hosts.get("default")!.state.authenticated = true;
  pool.accountTunnel = () => ({ required: true, ready: false });
  expect(select).toThrow("No enabled ChatGPT account");
  pool.accountTunnel = () => ({ required: true, ready: true });
  pool.capabilities.set("default", { solAvailable: false });
  expect(select()).toBe("default");
  pool.capabilities.clear();
  expect(select()).toBe("default");
});

test("balanced routing still chooses a connector-verified account", () => {
  const { pool, select } = admission("balanced");
  expect(select()).toBe(alternate);
  pool.capabilities.set(alternate, { solAvailable: false });
  expect(select).toThrow("No enabled ChatGPT account");
  pool.capabilities.delete(alternate);
  expect(select).toThrow("No enabled ChatGPT account");
  pool.capabilities.set(alternate, { solAvailable: true });
  pool.connectors.clear();
  expect(select).toThrow("No enabled ChatGPT account");
});

test("a pinned account keeps its owner despite stale model discovery in balanced mode", () => {
  const { pool, hosts } = admission("balanced");
  for (const host of hosts.values()) (host as any).exactRetainedTurnTab = () => null;
  pool.traceOwners.set("fixture-trace", alternate);
  pool.capabilities.set(alternate, { solAvailable: false, modelCapabilities: { families: { "6": [] } } });
  const requirement = { requestedModel: "chatgpt-web/gpt-6-pro", effort: "max", connector };
  expect(pool.chooseAccount("fixture-trace", null, false, requirement)).toBe(alternate);
  pool.capabilities.clear();
  pool.connectors.clear();
  expect(pool.chooseAccount("fixture-trace", null, false, requirement)).toBe(alternate);
  expect(pool.accountReadinessBlocker({ traceId: "fixture-trace", key: null, connector }, requirement, alternate))
    .toBe("account_not_ready"); // No stale account_model_unavailable/account_unchecked diagnosis.
  pool.accountTunnel = () => ({ required: true, ready: false });
  expect(() => pool.chooseAccount("fixture-trace", null, false, requirement)).toThrow("Pinned ChatGPT account is not ready");
  pool.accountTunnel = () => ({ required: true, ready: true });
  hosts.get(alternate)!.state.authenticated = false;
  expect(() => pool.chooseAccount("fixture-trace", null, false, requirement)).toThrow("Pinned ChatGPT account is not ready");
});

test("only a successful actual tool result promotes the current turn identity's connector proof", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-selected-proof-"));
  try {
    const toolProof = new AccountToolProof(directory);
    const tab = { id: "tab", traceId: "fixture-trace", helperPid: 1, connectorIdentity: connector,
      authPrincipalFingerprint: principal, authIdentityEpoch: 7 };
    const owner: any = { accountId: "default", authPrincipalFingerprint: principal, authIdentityEpoch: 7,
      connectorName: () => connector, turnTabs: new Map([["tab", tab]]), endTurn: async () => ({}) };
    const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
      ownerForTrace: () => owner, traceOwners: new Map(), unsentAdmissions: new Map(),
      admissionQueue: { retire() {} }, recordUsage() {}, toolProof, connectors: new Map(),
      safety: { fail() {} }, logger: { warn() {} }, publish() {},
    });
    const end = (status = "completed", proof: unknown = { tool: "codex_exec" }) =>
      pool.endTurn(tab.traceId, 1, status, false, undefined, false, true, undefined, proof);
    await end("completed", null);
    expect(pool.connectors.size).toBe(0);
    await end("failed");
    expect(pool.connectors.size).toBe(0);
    owner.authIdentityEpoch++;
    await end();
    expect(pool.connectors.size).toBe(0);
    expect(toolProof.snapshot("default", principal)).toBeNull();
    owner.authIdentityEpoch = 7;
    await end();
    expect(pool.connectors.get("default")).toBe(connector);
    expect(toolProof.snapshot("default", principal)?.tool).toBe("codex_exec");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test("future pacing edits and resume preserve active owners and reject unknown or closed accounts", () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-active-pacing-"));
  try {
    const safety = new AccountSafety(directory);
    const leases = new AccountOperationLeases();
    const owner = { activeTraceId: "active-trace", currentOperation: () => "active model check" };
    const hosts = new Map([["default", owner]]);
    const traces = new Map([["active-trace", "default"]]);
    const tunnels = new Map([["default", { ready: true }]]);
    const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
      registry: { snapshot: () => ({ accounts: [{ id: "default" }] }) },
      destroyed: false, safety, operationLeases: leases, hosts, traceOwners: traces, tunnels,
      getHost() { throw new Error("Must not create or inspect a browser host"); },
      assertAccountOperationAvailable() { throw new Error("Must not acquire activity ownership"); },
      publish() {}, accountSnapshot: () => safety.snapshot("default"),
    });
    const originalOwners = JSON.stringify({ hosts: [...hosts], traces: [...traces], tunnels: [...tunnels] });
    const policy = { ...safety.snapshot("default").policy, enabled: true };
    const releaseRead = leases.acquireRead("default", "Session inspection", () => { throw new Error("Must not cancel read"); });
    expect(pool.setAccountSafety("default", policy).policy.enabled).toBe(true);
    expect(leases.readLabel("default")).toBe("Session inspection");
    pool.resumeAccount("default");
    releaseRead();
    const releaseMutation = leases.acquireExclusive("default", "Sign in");
    expect(pool.setAccountSafety("default", { ...policy, enabled: false }).policy.enabled).toBe(false);
    pool.resumeAccount("default");
    expect(leases.exclusiveLabel("default")).toBe("Sign in");
    expect(JSON.stringify({ hosts: [...hosts], traces: [...traces], tunnels: [...tunnels] })).toBe(originalOwners);
    const saved = JSON.stringify(safety.state);
    for (const method of ["setAccountSafety", "resumeAccount"]) {
      expect(() => pool[method](alternate, policy)).toThrow("Unknown ChatGPT account");
      expect(() => pool[method]("bad-id", policy)).toThrow("Account id");
      pool.destroyed = true;
      expect(() => pool[method]("default", policy)).toThrow("ChatGPT account pool is closed");
      pool.destroyed = false;
    }
    expect(JSON.stringify(safety.state)).toBe(saved);
    releaseMutation();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
