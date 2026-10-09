import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { BrowserAdmissionQueue, ACCOUNT_NOT_READY_GRACE_MS } = require("../launcher/electron/browser-admission-queue.cjs");

const owner = {
  traceId: "trace_unready01", helperPid: process.pid, reveal: false, key: null, connector: "Codex Native6",
  retained: false, effort: "low", routingKey: null, taskProgressVersion: 1, requestedAccountId: "default",
  requestedModel: "chatgpt-web/gpt-5.6-sol-instant",
};

function queueWith(inspect: () => unknown) {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-admission-"));
  let now = 1_000_000;
  let dispatched = 0;
  const queue = new BrowserAdmissionQueue({
    file: join(dir, "admission-queue.json"), inspect,
    dispatch: async () => { dispatched += 1; return { surfaceId: "s".repeat(32) }; },
    releaseUnsent: async () => true, clock: () => now, alive: () => true, autoPump: false,
  });
  return {
    queue, dispatched: () => dispatched,
    advance: (ms: number) => { now += ms; },
    // The live helper polls every 500 ms; keep the owner fresh across a long hold.
    poll: () => queue.request({ ...owner }),
    cleanup: () => { queue.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test("an account without its tool tunnel fails the queued task with that cause", async () => {
  const q = queueWith(() => ({ reason: "account-not-ready", blocker: "account_tunnel_unconfigured" }));
  try {
    expect(q.poll()).toMatchObject({ queued: true, notSent: true });
    await q.queue.pump();
    for (let held = 0; held < ACCOUNT_NOT_READY_GRACE_MS - 5_000; held += 5_000) {
      q.advance(5_000); q.poll(); await q.queue.pump();
    }
    expect(q.queue.snapshot().entries[0].status).toBe("waiting");
    q.advance(5_000); q.poll(); await q.queue.pump();
    expect(q.queue.snapshot().entries[0].status).toBe("failed");
    expect(() => q.poll()).toThrow("has no tool tunnel");
    expect(() => q.poll()).toThrow("has no tool tunnel");
    await expect(q.queue.cancelOwner(owner.traceId, owner.helperPid)).resolves.toEqual({ cancelled: true, notSent: true });
    expect(q.dispatched()).toBe(0);
  } finally { q.cleanup(); }
});

test("other holds keep waiting and a recovered account is admitted", async () => {
  let held: unknown = { reason: "capacity" };
  const q = queueWith(() => held);
  try {
    q.poll();
    for (let i = 0; i < 12; i++) { q.advance(5_000); q.poll(); await q.queue.pump(); }
    expect(q.queue.snapshot().entries[0].status).toBe("waiting");
    held = { reason: "account-not-ready", blocker: "account_signed_out" };
    q.advance(5_000); q.poll(); await q.queue.pump();
    held = null;
    q.advance(5_000); q.poll(); await q.queue.pump();
    expect(q.dispatched()).toBe(1);
  } finally { q.cleanup(); }
});
