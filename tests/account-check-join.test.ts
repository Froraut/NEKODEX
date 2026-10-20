import { expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function pool(host: any) {
  return Object.assign(Object.create(AccountBrowserPool.prototype), {
    destroyed: false, inspectionsPaused: false, hosts: new Map([["default", host]]),
    authenticationRefreshOperations: new Map(), reservations: new Map(),
    getHost: () => host, accountMutationOperationLabel: () => null,
    accountOperationLabel: () => host.readOnlyInspection?.name ?? null,
  });
}

test("Retry pressed during a running account check waits for it instead of failing busy", async () => {
  const running = deferred();
  let retries = 0;
  const host: any = { activeTraceId: null, readOnlyInspection: { name: "connector verification", done: running.promise } };
  const accounts = pool(host);
  const original = AccountBrowserPool.prototype.refreshAccountAuthentication;
  let released = false;
  accounts.refreshAccountAuthentication = function (id: string) {
    if (!released) return original.call(this, id);
    retries += 1;
    return Promise.resolve({ retried: true });
  };
  const result = accounts.refreshAccountAuthentication("default");
  expect(accounts.refreshAccountAuthentication("default")).toBe(result);
  expect(retries).toBe(0);
  host.readOnlyInspection = null;
  released = true;
  running.resolve();
  await expect(result).resolves.toEqual({ retried: true });
  expect(retries).toBe(1);
  expect(accounts.authenticationRefreshOperations.size).toBe(0);
});

test("a task on the account still refuses the retry immediately", () => {
  const host: any = { activeTraceId: "trace", readOnlyInspection: { name: "session inspection", done: new Promise(() => {}) } };
  const accounts = pool(host);
  accounts.accountOperationError = () => new Error("This ChatGPT account is busy with session inspection; retry after it finishes");
  return expect(accounts.refreshAccountAuthentication("default")).rejects.toThrow("busy with session inspection");
});

test("Check account waits for the running inspection before its busy check", async () => {
  const running = deferred();
  const host: any = { activeTraceId: null, readOnlyInspection: { name: "session inspection", done: running.promise } };
  const accounts = pool(host);
  let waited = false;
  const wait = accounts.waitForAccountInspection("default").then(() => { waited = true; });
  await Promise.resolve();
  expect(waited).toBe(false);
  host.readOnlyInspection = null;
  running.resolve();
  await wait;
  expect(waited).toBe(true);
});

test("Retry joins a follow-on check that a chained Check starts, then runs", async () => {
  const inspection = deferred();
  const verification = deferred();
  let retries = 0;
  const host: any = { activeTraceId: null, readOnlyInspection: { name: "session inspection", done: inspection.promise } };
  const accounts = pool(host);
  const original = AccountBrowserPool.prototype.refreshAccountAuthentication;
  accounts.refreshAccountAuthentication = function (id: string, joined?: number) {
    if (host.readOnlyInspection) return original.call(this, id, joined);
    retries += 1;
    return Promise.resolve({ retried: true });
  };
  const result = accounts.refreshAccountAuthentication("default");
  // The session inspection hands the page straight to connector verification.
  host.readOnlyInspection = { name: "connector verification", done: verification.promise };
  inspection.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(retries).toBe(0);
  host.readOnlyInspection = null;
  verification.resolve();
  await expect(result).resolves.toEqual({ retried: true });
  expect(retries).toBe(1);
});

test("a Check that waited through a launcher restart pause stops before inspecting", async () => {
  const running = deferred();
  let inspected = false;
  const host: any = { activeTraceId: null, readOnlyInspection: { name: "session inspection", done: running.promise },
    inspectSession: async () => { inspected = true; } };
  const accounts = pool(host);
  const check = accounts.checkAccount("default");
  accounts.inspectionsPaused = true;
  host.readOnlyInspection = null;
  running.resolve();
  await expect(check).rejects.toThrow("paused for launcher restart");
  expect(inspected).toBe(false);
});
