import { expect, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");

test("Native Agent authority ignores Web tunnel and permits only matching-owner cleanup during drain", async () => {
  const supervisor = Object.create(RuntimeSupervisor.prototype);
  const config = { mode: "full", releaseVersion: "native-authority-fixture" };
  let health: any = { service: "codex-chatgpt-web", status: "ok", mode: config.mode, version: config.releaseVersion,
    pid: process.pid, instance_id: "native-authority-fixture-instance", native_accepting_turns: true, web_accepting_turns: false };
  supervisor.launcherProfile = "development";
  supervisor.proxyHealthPayload = async () => health;
  supervisor.tunnelHealth = () => { throw new Error("Native authority must not inspect Web tunnel"); };
  expect(await supervisor.ownedAgentRuntimeReady(config)).toBe(true);
  health.native_accepting_turns = false;
  expect(await supervisor.ownedAgentRuntimeReady(config)).toBe(false);
  expect(await supervisor.ownedAgentRuntimeReady(config, { allowDraining: true })).toBe(true);
  health.version = "foreign-version";
  expect(await supervisor.ownedAgentRuntimeReady(config, { allowDraining: true })).toBe(false);
  health.version = config.releaseVersion;
  supervisor.launcherProfile = "production";
  supervisor.daemon = { pid: process.pid, exitCode: null, signalCode: null };
  supervisor.daemonInstanceId = health.instance_id;
  expect(await supervisor.ownedAgentRuntimeReady(config)).toBe(false);
  expect(await supervisor.ownedAgentRuntimeReady(config, { allowDraining: true })).toBe(true);
  health.instance_id = "foreign-instance";
  expect(await supervisor.ownedAgentRuntimeReady(config, { allowDraining: true })).toBe(false);
  health.instance_id = supervisor.daemonInstanceId;
  supervisor.daemon.exitCode = 0;
  expect(await supervisor.ownedAgentRuntimeReady(config, { allowDraining: true })).toBe(false);
});
