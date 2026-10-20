import { afterEach, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { AccountTunnelPeer } = require("../launcher/electron/account-tunnel-supervisor.cjs");
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");

const tunnel = { tunnelId: `tunnel_${"b".repeat(32)}`, alias: "account-b", profileName: "profile",
  profileDir: mkdtempSync(join(tmpdir(), "nk-tunnel-profile-")), binaryPath: "/tmp/unused", runtimeKeyFile: "/tmp/unused-key" };
const binding = { accountId: "default", interactionMode: "automatic", tunnel };
const config = { mode: "full", tunnel, accountTunnelBinding: true };
const original = { start: RuntimeSupervisor.prototype.startTunnel, stop: RuntimeSupervisor.prototype.runTunnelStopCommand,
  connect: RuntimeSupervisor.prototype.runTunnelConnectCommand };
afterEach(() => {
  RuntimeSupervisor.prototype.startTunnel = original.start;
  RuntimeSupervisor.prototype.runTunnelStopCommand = original.stop;
  RuntimeSupervisor.prototype.runTunnelConnectCommand = original.connect;
});

function peer(extra: Record<string, unknown> = {}) {
  return Object.assign(Object.create(AccountTunnelPeer.prototype), {
    binding, statePath: join(mkdtempSync(join(tmpdir(), "nk-tunnel-")), "marker.json"),
    logger: { info() {}, warn() {}, error() {} }, tunnel: null, ownedAliasVerified: false,
    connectAttempted: false, initialAliasAbsent: false, ownAttemptPending: false, restartOwnedAlias: false,
    launcherProfile: "development", ...extra });
}
const readyAlias = { statusKnown: true, ready: true, state: "ready", processRunning: true, pid: 4242 };

test("connecting an alias seen absent marks the attempt as this launcher's own", async () => {
  RuntimeSupervisor.prototype.runTunnelConnectCommand = async () => ({ code: 0, output: "" });
  const owner = peer({ initialAliasAbsent: true });
  await owner.runTunnelConnectCommand(config);
  expect(owner.ownAttemptPending).toBe(true);
});

test("a later start adopts this launcher's own alias after a stalled probe instead of refusing it", async () => {
  let started = 0;
  RuntimeSupervisor.prototype.startTunnel = async function () { started++; this.tunnel = { pid: 4242 }; };
  const owner = peer({ ownAttemptPending: true, connectAttempted: true });
  owner.waitForKnownTunnelStatus = async () => readyAlias;
  await owner.startTunnel(config, "runtime-recovery", {});
  expect(started).toBe(1);
  expect(owner.ownedAliasVerified).toBe(true);
  expect(owner.ownAttemptPending).toBe(false);
});

test("an alias this launcher never started is still refused", async () => {
  RuntimeSupervisor.prototype.startTunnel = async () => { throw new Error("must not start"); };
  const stranger = peer();
  stranger.waitForKnownTunnelStatus = async () => readyAlias;
  await expect(stranger.startTunnel(config, "runtime-recovery", {}))
    .rejects.toThrow("ready without current launcher ownership proof");
});

test("cleanup can stop its own just-started process even though the PID was never learned", async () => {
  let stopped = 0;
  RuntimeSupervisor.prototype.runTunnelStopCommand = async () => { stopped++; return { code: 0, output: "" }; };
  const owner = peer({ ownAttemptPending: true, connectAttempted: true });
  owner.readTunnelHealth = async () => readyAlias;
  owner.waitForTunnelStopped = async () => {};
  await expect(owner.runTunnelStopCommand(config)).resolves.toMatchObject({ code: 0 });
  expect(stopped).toBe(1);
  expect(owner.ownAttemptPending).toBe(false);
});

test("without an own attempt an unknown PID still blocks shutdown", async () => {
  RuntimeSupervisor.prototype.runTunnelStopCommand = async () => { throw new Error("must not stop"); };
  const stranger = peer();
  stranger.readTunnelHealth = async () => readyAlias;
  await expect(stranger.runTunnelStopCommand(config)).rejects.toThrow("no current launcher ownership proof");
});
