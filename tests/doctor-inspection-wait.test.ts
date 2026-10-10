import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { AccountOperationLeases } = require("../launcher/electron/account-operation-leases.cjs");

// Only the browser host is stubbed; the pool's lease and busy logic run as shipped.
function poolWithHost(host: any) {
  const pool = Object.create(AccountBrowserPool.prototype);
  Object.assign(pool, {
    hosts: new Map([["default", host]]), destroyed: false, inspectionsPaused: false,
    registry: { snapshot: () => ({ selectedId: "default", accounts: [{ id: "default", enabled: true }] }) },
    getHost: () => host, publish: () => {}, evidenceEpochs: new Map(), capabilities: new Map(),
    options: {},
  });
  pool.operationLeases = new AccountOperationLeases();
  return pool;
}

function hostWithInspection(name: string) {
  let finish!: () => void;
  const host: any = { activeTraceId: null, manualOperation: name, loginOperation: null,
    descriptorPath: "/nonexistent", inspected: 0 };
  host.readOnlyInspection = { name, done: new Promise<void>(resolve => { finish = resolve; })
    .then(() => { host.readOnlyInspection = null; host.manualOperation = null; }) };
  host.currentOperation = () => host.manualOperation || host.readOnlyInspection?.name || null;
  host.inspectSession = async () => {
    if (host.currentOperation()) throw new Error("Finish the account's active task or operation before checking it");
    host.inspected++;
    return { authenticated: true, temporary: true, url: "https://chatgpt.com/" };
  };
  return { host, finish: () => finish() };
}

test("a runtime session inspection waits for the launcher's own read-only check instead of failing busy", async () => {
  const { host, finish } = hostWithInspection("session inspection");
  const pool = poolWithHost(host);
  const pending = pool.inspectSession(false, "default");
  await Promise.resolve();
  expect(host.inspected).toBe(0);
  finish();
  await expect(pending).resolves.toMatchObject({ authenticated: true });
  expect(host.inspected).toBe(1);
});

test("a runtime session inspection still fails fast while the account runs a non-inspection operation", async () => {
  const { host } = hostWithInspection("session inspection");
  host.manualOperation = "ChatGPT login";
  const pool = poolWithHost(host);
  await expect(pool.inspectSession(false, "default")).rejects.toThrow(/busy with ChatGPT login/);
  expect(host.inspected).toBe(0);
});

test("the inspection wait is bounded", async () => {
  const { host } = hostWithInspection("connector verification");
  const pool = poolWithHost(host);
  pool.options.readOnlyInspectionWaitMs = 30;
  const started = Date.now();
  await expect(pool.inspectSession(false, "default")).rejects.toThrow(/busy with connector verification/);
  expect(Date.now() - started).toBeLessThan(1_000);
});
