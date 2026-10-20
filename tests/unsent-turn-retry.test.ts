import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { BrowserAdmissionQueue } = require("../launcher/electron/browser-admission-queue.cjs");

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

test("a turn whose tab a failed navigation already removed is still retired as never sent", async () => {
  const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
  const retired: unknown[] = [];
  const owner = {
    turnTabs: new Map(), connectorName: () => "Codex Native6", authPrincipalFingerprint: null,
    endTurn: async () => ({}),
    taskLedger: { get: () => undefined, snapshot: () => [
      { traceId: "trace_navfail01", terminal: true, submission: "not-sent", updatedAt: 2 },
      { traceId: "trace_other0001", terminal: true, submission: "sent", updatedAt: 3 },
    ] },
  };
  const pool: any = Object.assign(Object.create(AccountBrowserPool.prototype), {
    ownerForTrace: () => owner, traceOwners: new Map([["trace_navfail01", "default"]]), unsentAdmissions: new Map(),
    pendingAffinity: new Map(), admissionQueue: { retire: (...args: unknown[]) => retired.push(args) },
    recordUsage() {}, usage: { finish() {} }, safety: { fail() {} }, toolProof: { record() {} }, connectors: new Map(),
    logger: { warn() {} }, publish() {},
  });
  await pool.endTurn("trace_navfail01", 4242, "failed", false, "page.goto: net::ERR_TIMED_OUT", false, false, "browser_failure");
  expect(retired).toEqual([["trace_navfail01", 4242, true]]);
});
