import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, getConfigPath, loadConfig, providerConfig, readConfigForSetup } from "../src/config";
import { transitionSetupConfig, meaningfulRuntimeChange, type SetupTransitionContext } from "../src/setup-policy";

function context(): SetupTransitionContext {
  return { defaults: defaultConfig(), profile: "production", version: "fixture", runtimeCommand: [process.execPath], brokerEndpoint: "/fixture/broker", acknowledgementTime: "2026-09-22T00:00:00Z" };
}

test("Native5 automatic identity survives Manual round trip without mutating input", () => {
  const env = context();
  const existing = { ...env.defaults, mode: "full" as const, experimentalAsyncToolOperations: true, appName: "Codex Native5", automaticAppName: "Codex Native5", browserHost: "launcher" as const, browserHostDescriptorPath: "/fixture/descriptor" };
  const before = structuredClone(existing);
  const manual = transitionSetupConfig(existing, { mode: "full", browserInteractionMode: "manual", acknowledgedUnofficial: true }, env);
  expect(manual.appName).toBe("Codex Zero Risk4");
  expect(manual.automaticAppName).toBe("Codex Native5");
  expect(manual.experimentalAsyncToolOperations).toBe(false);
  const automatic = transitionSetupConfig(manual, { mode: "full", browserInteractionMode: "automatic" }, env);
  expect(automatic.appName).toBe("Codex Native5");
  expect(automatic.experimentalAsyncToolOperations).toBe(true);
  expect(existing).toEqual(before);
});

test("explicit incompatible async rejects; inherited async normalizes", () => {
  const env = context();
  expect(() => transitionSetupConfig(undefined, { mode: "browser-only", experimentalAsyncToolOperations: true }, env)).toThrow("Async tool operations require");
  const result = transitionSetupConfig({ ...env.defaults, experimentalAsyncToolOperations: true }, { mode: "browser-only", acknowledgedUnofficial: true }, env);
  expect(result.experimentalAsyncToolOperations).toBe(false);
});

test("fresh delegation stays opt-in while legacy setup migration and runtime validation stay distinct", () => {
  const prior = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = mkdtempSync(join(tmpdir(), "setup-policy-"));
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const env = context();
    expect(transitionSetupConfig(undefined, { mode: "browser-only", acknowledgedUnofficial: true }, env).allowWebSubagents).toBe(false);
    const { allowWebSubagents, ...legacy } = env.defaults;
    writeFileSync(getConfigPath(), JSON.stringify({ ...legacy, appName: "Codex Native3", automaticAppName: "Codex Native3" }));
    expect(() => loadConfig()).toThrow("Legacy ChatGPT connector");
    const read = readConfigForSetup();
    expect(read.persistedIdentity).toBe("Codex Native3");
    expect(read.config!.appName).toBe("Codex Native4");
    expect(read.config!.allowWebSubagents).toBe(true);
  } finally {
    if (prior === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior;
    rmSync(home, { recursive: true, force: true });
  }
});

test("restart projection excludes dynamic model preferences but includes routed behavior", () => {
  const original = context().defaults;
  expect(meaningfulRuntimeChange(original, { ...original, proModelVersion: "6", compactionModel: "extra-high" })).toBe(false);
  expect(meaningfulRuntimeChange(original, { ...original, allowWebSubagents: !original.allowWebSubagents })).toBe(true);
  expect(meaningfulRuntimeChange(original, { ...original, useSavedChats: true })).toBe(true);
});

test("saved chats opt in explicitly and omission preserves an existing choice", () => {
  const env = context();
  const initial = transitionSetupConfig(undefined, { mode: "browser-only", acknowledgedUnofficial: true }, env);
  expect(initial.useSavedChats).toBe(false);
  expect(initial.experimentalFreshConversationPerTurn).toBe(env.defaults.experimentalFreshConversationPerTurn);
  const saved = transitionSetupConfig(initial, { mode: "browser-only", useSavedChats: true }, env);
  expect(saved.useSavedChats).toBe(true);
  expect(providerConfig(saved).chatgptWeb?.useSavedChats).toBe(true);
  expect(transitionSetupConfig(saved, { mode: "browser-only" }, env).useSavedChats).toBe(true);
  const temporary = transitionSetupConfig(saved, { mode: "browser-only", useSavedChats: false }, env);
  expect(temporary.useSavedChats).toBe(false);
  expect(providerConfig(temporary).chatgptWeb?.useSavedChats).toBe(false);
});
