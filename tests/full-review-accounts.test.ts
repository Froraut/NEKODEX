import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { createCodexAccountTools } = require("../launcher/electron/codex-account-tools.cjs");
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { AccountNetwork } = require("../launcher/electron/account-network.cjs");
const { DURABILITY_WARNING_CODE, writePrivateFileAtomic } = require("../launcher/electron/atomic-file.cjs");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("account quota refresh waits for readiness before owning a cancellable read lease", async () => {
  const readiness = deferred<void>();
  const firstRead = deferred<{ availability: string; accountId: string }>();
  const secondRead = deferred<never>();
  const reads = [firstRead, secondRead];
  let readIndex = 0;
  let leaseHeld = false;
  let releases = 0;
  const session = { fetch() { throw new Error("fixture must not make a live request"); } };
  const identity = { accountId: "default", identityEpoch: 4, principalFingerprint: "fixture-principal" };
  const host = { ready: () => readiness.promise, view: { webContents: { session } } };
  const pool = {
    accountSnapshot: () => ({ accounts: [{ id: "default", authenticated: true }] }),
    acquireAccountReadOperation: (id: string, label: string, cancel: () => void) => {
      expect(id).toBe("default");
      expect(label).toBe("Codex account limit refresh");
      expect(typeof cancel).toBe("function");
      expect(leaseHeld).toBe(false);
      leaseHeld = true;
      return () => { leaseHeld = false; releases += 1; };
    },
    getHost: () => host,
    evidenceEpoch: () => 9,
    accountIdentityLease: () => identity,
  };
  const tools = createCodexAccountTools({
    getPool: () => pool,
    getInteractionMode: () => "automatic",
    BrowserWindow: class {},
    clipboard: { writeText() {} },
    codexHome: "/fixture/codex-home",
    quotaReader: {
      snapshot() { return null; },
      read: () => reads[readIndex++].promise,
      clear() {},
    },
    createController: () => ({ selectionLock: () => null }),
  });

  const successful = tools.refreshQuota("default");
  await Promise.resolve();
  expect(leaseHeld).toBe(false);
  readiness.resolve(undefined);
  await Promise.resolve();
  expect(leaseHeld).toBe(true);
  expect(tools.currentOperation()).toBeNull();
  firstRead.resolve({ availability: "available", accountId: "default" });
  await expect(successful).resolves.toMatchObject({ availability: "available" });
  expect(leaseHeld).toBe(false);
  expect(releases).toBe(1);

  const failed = tools.refreshQuota("default");
  await Promise.resolve();
  expect(leaseHeld).toBe(true);
  secondRead.reject(new Error("synthetic quota failure"));
  await expect(failed).rejects.toThrow("synthetic quota failure");
  expect(leaseHeld).toBe(false);
  expect(releases).toBe(2);
});

test("account read leases allow active turns, block mutations, and settle on quit cancellation", async () => {
  let hostOperation: string | null = null;
  const host = {
    activeTraceId: "running-trace",
    currentOperation: () => hostOperation,
    cancelReadOnlyInspection: async () => {},
  };
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    destroyed: false,
    inspectionsPaused: false,
    accountOperations: new Map(),
    accountReadOperations: new Map(),
    networkOperation: null,
    loginOperation: null,
    addingAccount: false,
    hosts: new Map([["default", host]]),
    reservations: new Map(),
    registry: { snapshot: () => ({ accounts: [{ id: "default" }] }) },
  });
  let cancelled = false;
  let releaseRead = () => {};
  releaseRead = pool.acquireAccountReadOperation("default", "Codex account limit refresh", () => {
    cancelled = true;
    releaseRead();
  });

  expect(pool.accountOperationLabel("default")).toBeNull();
  expect(pool.currentOperation()).toBeNull();
  expect(() => pool.acquireAccountOperation("default", "Account proxy change"))
    .toThrow("busy with Codex account limit refresh");

  await pool.cancelReadOnlyInspections();
  expect(cancelled).toBe(true);
  expect(pool.accountReadOperationLabel("default")).toBeNull();

  pool.inspectionsPaused = false;
  hostOperation = "session inspection";
  const releaseConcurrentRead = pool.acquireAccountReadOperation(
    "default", "Codex account limit refresh", () => {},
  );
  releaseConcurrentRead();
});

test("post-rename durability uncertainty keeps proxy memory, disk, and live routing consistent", async () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-account-durability-"));
  try {
    const receipts: Array<{ committed: boolean; durability: string; warningCode?: string }> = [];
    const warnings: string[] = [];
    const network = new AccountNetwork(root, {
      writeFile: (file: string, content: string, options: Record<string, unknown>) => {
        const receipt = writePrivateFileAtomic(file, content, {
          ...options,
          platform: "linux",
          directorySync: () => { throw new Error("synthetic directory sync failure"); },
          warningSink: (value: { warningCode: string }) => warnings.push(value.warningCode),
        });
        receipts.push(receipt);
        return receipt;
      },
    });
    const applied: unknown[] = [];
    const host = {
      ready: async () => {},
      view: { webContents: { session: {
        setProxy: async (value: unknown) => { applied.push(value); },
        closeAllConnections: async () => { applied.push("closed"); },
      } } },
    };
    const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
      network,
      networkOperation: null,
      getHost: () => host,
      acquireAccountOperation: () => () => {},
      invalidateEvidence: () => {},
      accountSnapshot: () => ({ accounts: [] }),
      publish: () => {},
    });

    await pool.setAccountProxy("default", { mode: "https", url: "https://proxy.example:8443" });

    expect(applied).toEqual([
      { mode: "fixed_servers", proxyRules: "https://proxy.example:8443",
        proxyBypassRules: "<local>;localhost;127.0.0.1;[::1]" },
      "closed",
    ]);
    expect(network.get("default")).toEqual({ mode: "https", url: "https://proxy.example:8443" });
    expect(JSON.parse(readFileSync(join(root, "account-network.json"), "utf8")))
      .toMatchObject({ accounts: { default: { mode: "https", url: "https://proxy.example:8443" } } });
    expect(receipts).toEqual([{ committed: true, durability: "uncertain",
      warningCode: DURABILITY_WARNING_CODE }]);
    expect(warnings).toEqual([DURABILITY_WARNING_CODE]);
    expect(new AccountNetwork(root).get("default"))
      .toEqual({ mode: "https", url: "https://proxy.example:8443" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
