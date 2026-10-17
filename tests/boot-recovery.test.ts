import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { externallyReferencedRuntimeVersions, pruneRuntimeVersions } = require("../launcher/electron/runtime-install.cjs");
const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
const { sessionRecheckDelayMs, syncSessionRecheck } = require("../launcher/electron/session-recheck.cjs");

const UNVERIFIED = "Codex openai_base_url changed after setup; refusing to overwrite the user's newer value "
  + "(no local gateway at the newer openai_base_url confirmed that it forwards to this NEKODEX runtime)";

test("pruning keeps a runtime version that a launch agent still executes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "nekodex-prune-"));
  try {
    const coreHome = path.join(root, "core");
    const agents = path.join(root, "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    for (const version of ["6.1.30-nekodex.1", "6.1.31-nekodex.1", "6.1.32-nekodex.1", "6.1.32-nekodex.5"]) {
      mkdirSync(path.join(coreHome, "versions", `${version}-darwin-arm64`, "runtime"), { recursive: true });
    }
    writeFileSync(path.join(agents, "local.gateway.plist"), `<plist><dict><key>ProgramArguments</key><array>`
      + `<string>${coreHome}/versions/6.1.30-nekodex.1-darwin-arm64/runtime/bun</string></array></dict></plist>`);
    writeFileSync(path.join(agents, "unrelated.plist"), "<plist><string>/usr/bin/true</string></plist>");
    const referenced = externallyReferencedRuntimeVersions({ coreHome, platform: "darwin", arch: "arm64", directories: [agents] });
    expect(referenced).toEqual(["6.1.30-nekodex.1"]);
    pruneRuntimeVersions({ coreHome, platform: "darwin", arch: "arm64", keepVersions: ["6.1.32-nekodex.5", ...referenced] });
    const kept = (version: string) => existsSync(path.join(coreHome, "versions", `${version}-darwin-arm64`));
    expect(kept("6.1.30-nekodex.1")).toBe(true);
    expect(kept("6.1.32-nekodex.1")).toBe(true); // newest older release stays as the rollback
    expect(kept("6.1.31-nekodex.1")).toBe(false);
    expect(externallyReferencedRuntimeVersions({ coreHome, platform: "darwin", arch: "arm64",
      directories: [path.join(root, "missing")] })).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function routeHost(statuses: Array<Record<string, unknown>>) {
  const logged: string[] = [];
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    assertProductionProfile() {},
    run: async () => ({ stdout: JSON.stringify(statuses.length > 1 ? statuses.shift() : statuses[0]) }),
    logger: { info: (event: string) => logged.push(event), warn: (event: string) => logged.push(event) },
  });
  return { host, logged };
}

test("startup waits for a chained gateway that is still starting", async () => {
  const ready = { installed: true, active: true, errors: [],
    chainedRoute: { url: "http://127.0.0.1:17844/v1", upstreamUrl: "http://127.0.0.1:17841/v1", upstreamVersion: "6.1.32" } };
  const { host, logged } = routeHost([
    { installed: true, active: true, errors: [UNVERIFIED] },
    { installed: true, active: true, errors: [UNVERIFIED] },
    ready,
  ]);
  let clock = 0;
  const status = await host.bridgeStatusAwaitingChainedGateway("bridge-connect", {
    waitMs: 10_000, intervalMs: 1_000, now: () => clock, sleep: async (ms: number) => { clock += ms; },
  });
  expect(status.chainedRoute.url).toBe("http://127.0.0.1:17844/v1");
  expect(clock).toBe(2_000);
  expect(logged.filter(event => event === "bridge.chained_gateway_waiting")).toHaveLength(1);
  expect(logged).toContain("bridge.chained_gateway_ready");
});

test("the gateway wait is bounded and other route drift fails at once", async () => {
  let clock = 0;
  const options = { waitMs: 5_000, intervalMs: 1_000, now: () => clock, sleep: async (ms: number) => { clock += ms; } };
  const missing = routeHost([{ installed: true, active: true, errors: [UNVERIFIED] }]).host;
  await expect(missing.bridgeStatusAwaitingChainedGateway("bridge-connect", options)).rejects.toThrow(/no local gateway/);
  expect(clock).toBe(5_000);
  clock = 0;
  const drift = routeHost([{ installed: true, active: true, errors: ["marker changed"] }]).host;
  await expect(drift.bridgeStatusAwaitingChainedGateway("bridge-connect", options)).rejects.toThrow(/marker changed/);
  expect(clock).toBe(0);
});

function recheckHost(initial: Record<string, unknown>) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const setTimer = (fn: () => void, ms: number) => { const timer = { fn, ms }; timers.push(timer); return timer; };
  const host: any = {
    state: initial, logger: { info() {} }, retries: 0, outcomes: [] as string[],
    sessionRecheckEnabled: () => true,
    async retryAuthenticationCheck() {
      host.retries += 1;
      host.state = { authenticationStatus: "unknown" };
      syncSessionRecheck(host, { setTimer });
      const outcome = host.outcomes.shift() ?? "unavailable";
      host.state = { authenticationStatus: outcome, authenticationIssue: outcome === "unavailable" ? "network" : null };
      syncSessionRecheck(host, { setTimer });
      if (outcome !== "verified") throw new Error("still unavailable");
      return host.state;
    },
  };
  const fire = async () => { const timer = timers.shift()!; timer.fn(); await new Promise(resolve => setTimeout(resolve, 0)); return timer.ms; };
  return { host, timers, setTimer, fire };
}

test("an unavailable session check is retried with backoff until ChatGPT answers", async () => {
  const { host, timers, setTimer, fire } = recheckHost({ authenticationStatus: "unavailable", authenticationIssue: "access" });
  host.outcomes = ["unavailable", "verified"];
  syncSessionRecheck(host, { setTimer });
  syncSessionRecheck(host, { setTimer });
  expect(timers).toHaveLength(1);
  expect(await fire()).toBe(sessionRecheckDelayMs(0));
  expect(host.retries).toBe(1);
  expect(timers).toHaveLength(1);
  expect(await fire()).toBe(sessionRecheckDelayMs(1));
  expect(host.retries).toBe(2);
  expect(host.state.authenticationStatus).toBe("verified");
  expect(timers).toHaveLength(0);
  expect(host.sessionRecheckAttempt).toBe(0);
});

test("a re-check never takes the browser from a task and skips issues that need the user", async () => {
  const busy = recheckHost({ authenticationStatus: "unavailable", authenticationIssue: "timeout" });
  busy.host.activeTraceId = "trace-1";
  syncSessionRecheck(busy.host, { setTimer: busy.setTimer });
  await busy.fire();
  expect(busy.host.retries).toBe(0);
  expect(busy.timers).toHaveLength(1);

  const identity = recheckHost({ authenticationStatus: "unavailable", authenticationIssue: "identity" });
  syncSessionRecheck(identity.host, { setTimer: identity.setTimer });
  expect(identity.timers).toHaveLength(0);

  const manual = recheckHost({ authenticationStatus: "unavailable", authenticationIssue: "network" });
  manual.host.sessionRecheckEnabled = () => false;
  syncSessionRecheck(manual.host, { setTimer: manual.setTimer });
  expect(manual.timers).toHaveLength(0);
});
