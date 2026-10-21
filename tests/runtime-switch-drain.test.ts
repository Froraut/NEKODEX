import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint, defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { ServerAdmission, webAdmissionFailureMessage } from "../src/server-admission";

const require = createRequire(import.meta.url);
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fakeTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let next = 1;
  return {
    timers: {
      now: () => now,
      setTimeout: (callback: () => void, ms: number) => { const id = next++; pending.set(id, { at: now + ms, callback }); return id; },
      clearTimeout: (id: unknown) => { pending.delete(id as number); },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...pending]) if (entry.at <= now) { pending.delete(id); entry.callback(); }
    },
  };
}

test("an unrenewed drain lease resumes admission; renewal, resume and shutdown keep their meaning", () => {
  const clock = fakeTimers();
  const expired: Array<string | null> = [];
  const admission = new ServerAdmission(reason => expired.push(reason), clock.timers);
  admission.drain({ leaseMs: 30_000, reason: "runtime-switch" });
  expect(admission.draining).toBe(true);
  expect(admission.switching).toBe(true);
  clock.advance(20_000);
  // The owner renews by draining again; the lease restarts from now.
  admission.drain({ leaseMs: 30_000, reason: "runtime-switch" });
  clock.advance(20_000);
  expect(admission.draining).toBe(true);
  clock.advance(10_001);
  expect(admission.accepting).toBe(true);
  expect(expired).toEqual(["runtime-switch"]);

  // A legacy drain without a body still ends, after the default lease.
  admission.drain();
  expect(admission.switching).toBe(false);
  clock.advance(5 * 60_000);
  expect(admission.accepting).toBe(true);

  // An explicit resume cancels the lease; a committed shutdown never resumes.
  admission.drain({ leaseMs: 1_000 });
  expect(admission.resume()).toBe(true);
  clock.advance(2_000);
  expect(expired).toHaveLength(2);
  admission.drain({ leaseMs: 1_000 });
  admission.beginShutdown();
  clock.advance(2_000);
  expect(admission.draining).toBe(true);
  expect(admission.resume()).toBe(false);
  expect(expired).toHaveLength(2);
});

test("a switch drain tells clients to retry in seconds", () => {
  const base = { draining: true, launcherDetached: false, brokerReady: true };
  expect(webAdmissionFailureMessage({ ...base, switching: true })).toMatch(/switching to its updated local runtime/);
  expect(webAdmissionFailureMessage(base)).toMatch(/restarting/);
});

test.serial("the daemon holds new requests during a switch drain, refuses others with Retry-After and expires leases", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-switch-drain-")));
  roots.push(home);
  const keys = ["CODEX_CHATGPT_WEB_HOME", "CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR", "CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME"] as const;
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  delete process.env.CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME;
  let server: ReturnType<typeof startServer> | undefined;
  try {
    const config = { ...defaultConfig("full"), port: 0, browserHost: "launcher" as const,
      brokerSocketPath: process.platform === "win32" ? defaultBrokerEndpoint(home) : join(home, "b.sock") };
    server = startServer(config, { fetchUpstream: async () => new Response(JSON.stringify({ object: "list", data: [] }),
      { status: 200, headers: { "content-type": "application/json" } }) });
    const base = `http://127.0.0.1:${server.port}`;
    const admin = (path: string, body?: unknown) => fetch(`${base}${path}`, { method: "POST",
      headers: { authorization: `Bearer ${config.controlToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

    const drained = await (await admin("/admin/drain", { leaseMs: 60_000, reason: "runtime-stop" })).json() as any;
    expect(drained).toMatchObject({ accepting_turns: false, draining: true, drain_reason: "runtime-stop" });
    const refused = await fetch(`${base}/v1/models`);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("3");
    expect(((await refused.json()) as any).error.message).toMatch(/restarting/);

    await admin("/admin/drain", { leaseMs: 60_000, reason: "runtime-switch" });
    let settled = false;
    const held = fetch(`${base}/v1/models`).then(response => { settled = true; return response; });
    await Bun.sleep(600);
    expect(settled).toBe(false);
    expect((await admin("/admin/resume")).status).toBe(200);
    const admitted = await held;
    expect(admitted.status).not.toBe(503);
    await admitted.body?.cancel();

    // Nobody renews this drain: it resumes on its own.
    await admin("/admin/drain", { leaseMs: 1_000, reason: "runtime-switch" });
    expect(((await (await fetch(`${base}/healthz`)).json()) as any).native_accepting_turns).toBe(false);
    await Bun.sleep(1_400);
    expect(((await (await fetch(`${base}/healthz`)).json()) as any)).toMatchObject({ native_accepting_turns: true, draining: false });
    // A bodyless drain (the CLI) keeps working.
    expect((await admin("/admin/drain")).status).toBe(200);
    expect((await admin("/admin/resume")).status).toBe(200);
  } finally {
    await server?.stop(true);
    for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}, 15_000);

function supervisorWith(control: (action: string, body?: any) => any) {
  const root = mkdtempSync(join(tmpdir(), "nekodex-switch-supervisor-"));
  roots.push(root);
  const warnings: string[] = [];
  const supervisor = new RuntimeSupervisor({ app: {}, coreHome: root, sourceRoot: root, browserDescriptorPath: join(root, "b.json"),
    logger: { info() {}, error() {}, warn: (event: string) => warnings.push(event) } });
  const config = { mode: "full", releaseVersion: "1.0.0", host: "127.0.0.1", port: 1, controlToken: "t" };
  const daemon = { pid: 4242, exitCode: null, signalCode: null };
  const calls: Array<[string, any]> = [];
  Object.assign(supervisor, {
    readConfig: () => config,
    daemon,
    performControl: async (_config: unknown, action: string, options: { body?: unknown } = {}) => {
      calls.push([action, options.body]);
      return control(action, options.body);
    },
  });
  return { supervisor, calls, warnings, config, daemon };
}

const health = (active: number) => ({ status: "ok", accepting_turns: false, drain_reason: "runtime-switch", active_http_turns: active,
  active_browser_turns: 0, active_compaction_runs: 0 });

test("a switch drain waits for running turns, then holds the drain for the stop", async () => {
  let active = 2;
  const { supervisor, calls } = supervisorWith(action => {
    if (action === "drain") return health(active--);
    return { status: "ok" };
  });
  const result = await supervisor.drainForSwitch({ deadlineAt: Date.now() + 60_000 });
  expect(result).toMatchObject({ status: "idle", held: true });
  expect(calls.filter(([action]) => action === "drain").every(([, body]) => body.reason === "runtime-switch" && body.leaseMs > 0)).toBe(true);
  expect(calls.some(([action]) => action === "cancel-turns" || action === "resume")).toBe(false);
  expect(supervisor.drainOwnedByThisLauncher()).toBe(true);
  expect(await supervisor.releaseSwitchDrain()).toBe(true);
  expect(supervisor.drainOwnedByThisLauncher()).toBe(false);
});

test("at the deadline the remaining turns are cancelled through cancel-turns and the switch proceeds", async () => {
  let cancelled = false;
  const { supervisor, calls, warnings } = supervisorWith(action => {
    if (action === "drain") return health(cancelled ? 0 : 3);
    if (action === "cancel-turns") { cancelled = true; return { status: "ok", cancelled_http_turns: 3, cancelled_browser_turns: 0 }; }
    return { status: "ok" };
  });
  const result = await supervisor.drainForSwitch({ deadlineAt: Date.now() - 1 });
  expect(result).toMatchObject({ status: "idle", held: true, cancelled: { httpTurns: 3 } });
  expect(calls.map(([action]) => action)).toEqual(["drain", "cancel-turns", "drain"]);
  expect(warnings).toContain("runtime.switch_turns_cancelled");
});

test("quit or uncancellable launcher work ends a switch drain with admission resumed", async () => {
  const quitting = supervisorWith(action => action === "drain" ? health(1) : { status: "ok" });
  expect(await quitting.supervisor.drainForSwitch({ deadlineAt: Date.now() + 60_000, isCancelled: () => true }))
    .toMatchObject({ status: "cancelled" });
  // Nothing was drained yet, so nothing needed resuming.
  expect(quitting.calls).toEqual([]);

  const setup = supervisorWith(action => action === "drain" ? health(0) : { status: "ok" });
  const result = await setup.supervisor.drainForSwitch({ deadlineAt: Date.now() - 1, busy: () => "core setup" });
  expect(result).toMatchObject({ status: "deferred", detail: "core setup" });
  expect(setup.calls.map(([action]) => action)).toEqual(["drain", "resume"]);
  expect(setup.supervisor.drainOwnedByThisLauncher()).toBe(false);
});

test("a drained runtime that no transition owns is resumed: at once on adoption, after a grace period otherwise", async () => {
  let draining = true;
  const { supervisor, calls, warnings, config, daemon } = supervisorWith(action => {
    if (action === "resume") { draining = false; return { status: "ok" }; }
    return { status: "ok" };
  });
  supervisor.proxyHealthPayload = async () => ({ service: "codex-chatgpt-web", status: "ok", version: config.releaseVersion,
    mode: config.mode, pid: daemon.pid, draining, shutdown_stage: "idle", drain_reason: "runtime-switch" });
  supervisor.proxyHealth = async () => true;

  // A drain this launcher holds is never touched.
  supervisor.drainHeldFor = daemon;
  expect(await supervisor.reconcileOrphanedDrain({ graceMs: 0 })).toMatchObject({ status: "not-applicable" });
  supervisor.drainHeldFor = null;

  expect(await supervisor.reconcileOrphanedDrain({ graceMs: 60_000 })).toMatchObject({ status: "observing" });
  expect(calls).toEqual([]);
  expect(await supervisor.reconcileOrphanedDrain({ graceMs: 0, phase: "adoption" })).toMatchObject({ status: "resumed" });
  expect(calls.map(([action]) => action)).toEqual(["resume"]);
  expect(warnings).toContain("runtime.orphaned_drain_resumed");
  expect(await supervisor.reconcileOrphanedDrain({ graceMs: 0 })).toMatchObject({ status: "accepting" });

  // A daemon that is already shutting down is left to its owner.
  draining = true;
  supervisor.proxyHealthPayload = async () => ({ service: "codex-chatgpt-web", status: "ok", version: config.releaseVersion,
    mode: config.mode, pid: daemon.pid, draining: true, shutdown_stage: "listener_close" });
  expect(await supervisor.reconcileOrphanedDrain({ graceMs: 0 })).toMatchObject({ status: "accepting" });
});

test("a daemon without drain leases gets a short switch drain", async () => {
  let cancelled = false;
  const startedAt = Date.now();
  const { supervisor, calls } = supervisorWith(action => {
    // No drain_reason: a release from before drain leases, which refuses new requests at once.
    if (action === "drain") return { status: "ok", accepting_turns: false, active_http_turns: cancelled ? 0 : 1,
      active_browser_turns: 0, active_compaction_runs: 0 };
    if (action === "cancel-turns") { cancelled = true; return { status: "ok", cancelled_http_turns: 1, cancelled_browser_turns: 0 }; }
    return { status: "ok" };
  });
  const realNow = Date.now;
  // Skip the legacy window without waiting 30 s.
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    const pending = supervisor.drainForSwitch({ deadlineAt: startedAt + 10 * 60_000,
      onProgress: () => { offset = 31_000; } });
    expect(await pending).toMatchObject({ status: "idle", cancelled: { httpTurns: 1 } });
  } finally {
    Date.now = realNow;
  }
  expect(calls.map(([action]) => action)).toContain("cancel-turns");
});
