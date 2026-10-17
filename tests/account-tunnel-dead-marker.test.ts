import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { AccountTunnelSupervisor } = require("../launcher/electron/account-tunnel-supervisor.cjs");
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");
const { processIdentity } = require("../launcher/electron/update-recovery.cjs");

const binding = (root: string) => ({ accountId: "default", interactionMode: "automatic",
  tunnel: { tunnelId: "tunnel-1", alias: "alias-1", profileName: "profile-1", profileDir: join(root, "profile") } });
const configFor = (root: string) => ({ mode: "full", accountTunnelMode: true, browserInteractionMode: "automatic",
  accountTunnels: [binding(root)], automaticAppName: "Codex Test" });
const markerPath = (root: string) => join(root, "runtime",
  `account-tunnel-${Buffer.from("default\0automatic").toString("hex")}.json`);

// A PID that belonged to a process which has already exited.
const deadPid = () => spawnSync(process.execPath, ["-e", "0"]).pid;

function writeMarker(root: string, fields: Record<string, unknown>) {
  mkdirSync(join(root, "runtime"), { recursive: true });
  const b = binding(root);
  writeFileSync(markerPath(root), JSON.stringify({ version: 1, daemonPid: null, status: "ready",
    updatedAt: new Date().toISOString(), accountId: b.accountId, interactionMode: b.interactionMode,
    tunnelId: b.tunnel.tunnelId, alias: b.tunnel.alias, ...fields }));
}

function withRoot(action: (root: string, logged: string[]) => Promise<void> | void) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "nekodex-dead-marker-"));
    const logged: string[] = [];
    try { await action(root, logged); }
    finally { rmSync(root, { recursive: true, force: true }); }
  };
}

const logger = (logged: string[]) => ({ info() {}, error() {}, warn: (event: string) => logged.push(event) });

function supervisor(root: string, logged: string[]) {
  const config = configFor(root);
  return new AccountTunnelSupervisor({ app: {}, logger: logger(logged), sourceRoot: root, coreHome: root,
    browserDescriptorPath: join(root, "browser.json"), readConfig: () => config }, () => {});
}

test("a dead launcher's marker for a dead tunnel is no live peer and is discarded", withRoot((root, logged) => {
  writeMarker(root, { ownerPid: deadPid(), ownerIdentity: "gone", tunnelPid: deadPid(), tunnelIdentity: "gone" });
  const accounts = supervisor(root, logged);
  accounts.configure(configFor(root));
  expect(accounts.ownedKeys()).toEqual([]);
  expect(existsSync(markerPath(root))).toBe(false);
  expect(logged).toContain("runtime.account_tunnel_dead_marker_discarded");
}));

test("a reused tunnel PID counts as dead, a live proven tunnel stays owned", withRoot(async (root, logged) => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    await new Promise(resolve => child.once("spawn", resolve));
    const identity = processIdentity(child.pid);
    expect(identity).toBeTruthy();
    // The PID is alive but now names another process than the one the marker recorded.
    writeMarker(root, { ownerPid: deadPid(), ownerIdentity: "gone", tunnelPid: child.pid, tunnelIdentity: "an earlier process" });
    const reused = supervisor(root, logged);
    reused.configure(configFor(root));
    expect(reused.ownedKeys()).toEqual([]);
    expect(existsSync(markerPath(root))).toBe(false);

    // The orphan of a dead launcher with its exact identity still needs a verified stop.
    writeMarker(root, { ownerPid: deadPid(), ownerIdentity: "gone", tunnelPid: child.pid, tunnelIdentity: identity });
    const orphan = supervisor(root, logged);
    orphan.configure(configFor(root));
    expect(orphan.ownedKeys()).toEqual(["default\0automatic"]);
    expect(existsSync(markerPath(root))).toBe(true);
  } finally {
    child.kill("SIGKILL");
  }
}));

test("a live foreign launcher keeps its marker even when its tunnel exited", withRoot((root, logged) => {
  const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    writeMarker(root, { ownerPid: owner.pid, tunnelPid: deadPid(), tunnelIdentity: "gone" });
    const accounts = supervisor(root, logged);
    accounts.configure(configFor(root));
    expect(accounts.ownedKeys()).toEqual(["default\0automatic"]);
    expect(existsSync(markerPath(root))).toBe(true);
  } finally {
    owner.kill("SIGKILL");
  }
}));

test("cold-start stop clears a crashed runtime's dead account tunnel state instead of demanding a drain", withRoot(async (root, logged) => {
  const config = configFor(root);
  writeMarker(root, { ownerPid: deadPid(), ownerIdentity: "gone", tunnelPid: deadPid(), tunnelIdentity: "gone" });
  const runtime = new RuntimeSupervisor({ app: {}, logger: { ...logger(logged), info() {} }, sourceRoot: root,
    coreHome: root, browserDescriptorPath: join(root, "browser.json"), launcherProfile: "production" });
  writeFileSync(runtime.statePath, JSON.stringify({ version: 1, ownerPid: deadPid(), daemonPid: deadPid(),
    tunnelPid: null, status: "ready", updatedAt: new Date().toISOString() }));
  Object.assign(runtime, {
    readConfig: () => config,
    proxyHealth: async () => false,
    proxyHealthPayload: async () => null,
  });
  await expect(runtime.stopForSetup()).resolves.toEqual({ status: "stopped" });
  expect(existsSync(markerPath(root))).toBe(false);
  expect(existsSync(runtime.statePath)).toBe(false);
}));
