import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { webAdmissionFailureMessage } from "../src/server-admission";

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { AccountOperationLeases } = require("../launcher/electron/account-operation-leases.cjs");

function run(argv: string[]) {
  const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

// Network blips, OpenAI reachability, dead processes, backoff, stale-marker
// orphans and Reconnect, against loopback endpoints and real child processes.
test("account tunnels survive network blips, report OpenAI outages and recover orphans", () => {
  const result = run([process.execPath, join(import.meta.dir, "../launcher/scripts/smoke-account-tunnel-resilience.cjs")]);
  expect(result.output).toContain("account tunnel resilience smoke passed");
  expect(result.code).toBe(0);
}, 60_000);

test("the proxy records a tunnel's cause and explains refused Web admission", () => {
  const result = run([process.execPath, "run", join(import.meta.dir, "../scripts/smoke-account-tunnel-readiness.ts")]);
  expect(result.output).toContain("ACCOUNT_TUNNEL_READINESS_OK");
  expect(result.output).toContain("cause-reported");
  expect(result.code).toBe(0);
  const base = { draining: false, launcherDetached: false, brokerReady: true };
  expect(webAdmissionFailureMessage({ ...base, tunnelUnavailableReason: "openai_unreachable" }))
    .toMatch(/cannot reach OpenAI; check your VPN/);
  expect(webAdmissionFailureMessage({ ...base, tunnelUnavailableReason: null })).toMatch(/Reconnect the tunnel/);
  expect(webAdmissionFailureMessage({ ...base, brokerReady: false, tunnelUnavailableReason: "openai_unreachable" }))
    .toMatch(/broker is not ready/);
}, 60_000);

function poolWithHost(host: any) {
  const pool = Object.create(AccountBrowserPool.prototype);
  Object.assign(pool, {
    hosts: new Map([["default", host]]), destroyed: false, inspectionsPaused: false,
    registry: { snapshot: () => ({ selectedId: "default", accounts: [{ id: "default", enabled: true }] }) },
    getHost: () => host, publish: () => {}, evidenceEpochs: new Map(), capabilities: new Map(),
    connectors: new Map(), evidenceRefreshing: new Set(), authenticationRefreshOperations: new Map(),
    evidenceRestores: new Map(), options: {}, logger: { info() {}, warn() {} },
  });
  pool.operationLeases = new AccountOperationLeases();
  return pool;
}

function connectorHost(onVerify: (call: number) => void) {
  const host: any = { activeTraceId: null, calls: 0, currentOperation: () => null,
    connectorName: () => "Codex Test" };
  host.verifyConnector = async () => { host.calls += 1; onVerify(host.calls); return { ok: true }; };
  return host;
}

test("connector verification retries once when a concurrent check renews account evidence", async () => {
  let pool: any;
  const host = connectorHost(call => { if (call === 1) pool.invalidateEvidence("default"); });
  pool = poolWithHost(host);
  await expect(pool.verifyConnector("Codex Test")).resolves.toEqual({ ok: true });
  expect(host.calls).toBe(2);
  expect(pool.connectors.get("default")).toBe("Codex Test");
});

test("connector verification still fails when evidence keeps changing", async () => {
  let pool: any;
  const host = connectorHost(() => pool.invalidateEvidence("default"));
  pool = poolWithHost(host);
  await expect(pool.verifyConnector("Codex Test")).rejects.toThrow(/readiness changed while verifying its connector/);
  expect(host.calls).toBe(2);
  expect(pool.connectors.has("default")).toBe(false);
});

test("connector verification joins the startup authentication refresh instead of racing it", async () => {
  const order: string[] = [];
  const host = connectorHost(() => order.push("verify"));
  const pool = poolWithHost(host);
  pool.evidenceRefreshing.add("default");
  setTimeout(() => {
    pool.invalidateEvidence("default");
    order.push("refresh-finished");
    pool.evidenceRefreshing.delete("default");
  }, 150);
  await expect(pool.verifyConnector("Codex Test")).resolves.toEqual({ ok: true });
  expect(order).toEqual(["refresh-finished", "verify"]);
  expect(host.calls).toBe(1);
});
