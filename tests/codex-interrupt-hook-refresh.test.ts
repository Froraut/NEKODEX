import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { inspectCodexIntegration, installCodexIntegration, refreshCodexInterruptHook } from "../src/codex-integration";
import { BASE_URL_CHANGED_MESSAGE } from "../src/codex-integration-route";
import { codexInterruptHookCommand, codexInterruptHookHash } from "../src/codex-interrupt-hook";

const GATEWAY = "http://127.0.0.1:17844/v1";
const runtime = (version: string) => ({ runtimeCommand: [
  `/Users/u/.codex-chatgpt-web/versions/${version}-darwin-arm64/runtime/bun`,
  `/Users/u/.codex-chatgpt-web/versions/${version}-darwin-arm64/app/cli.js`,
] });

function isolated(action: (paths: { config: string; hooks: string }) => void) {
  return () => {
    const root = mkdtempSync(join(tmpdir(), "nekodex-hook-refresh-"));
    const prior = { codex: process.env.CODEX_HOME, bridge: process.env.CODEX_CHATGPT_WEB_HOME };
    process.env.CODEX_HOME = join(root, "codex");
    process.env.CODEX_CHATGPT_WEB_HOME = join(root, "bridge");
    try {
      mkdirSync(process.env.CODEX_HOME);
      const config = join(process.env.CODEX_HOME, "config.toml");
      const hooks = join(process.env.CODEX_HOME, "hooks.json");
      writeFileSync(config, 'model = "native-model"\n');
      // An existing hooks.json makes the integration manage its Interrupt hook there.
      writeFileSync(hooks, `${JSON.stringify({ hooks: {} }, null, 1)}\n`);
      writeFileSync(join(process.env.CODEX_HOME, "models_cache.json"), JSON.stringify({ models: [{ slug: "native-model",
        visibility: "list", tool_mode: "code_mode_only", base_instructions: "Isolated fixture", input_modalities: ["text"],
        supported_reasoning_levels: [{ effort: "high", description: "High" }], default_reasoning_level: "high" }] }));
      action({ config, hooks });
    } finally {
      if (prior.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior.codex;
      if (prior.bridge === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior.bridge;
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test.serial("an upgraded runtime takes over the Interrupt hook, its trust and the journal", isolated(({ config, hooks }) => {
  installCodexIntegration({ ...defaultConfig("full"), ...runtime("6.1.15-nekodex.1") });
  const old = codexInterruptHookCommand(runtime("6.1.15-nekodex.1"));
  expect(readFileSync(hooks, "utf8")).toContain("6.1.15-nekodex.1");

  expect(refreshCodexInterruptHook(runtime("6.1.32-nekodex.20"))).toEqual({ changed: true });
  const current = codexInterruptHookCommand(runtime("6.1.32-nekodex.20"));
  const hooksText = readFileSync(hooks, "utf8");
  expect(hooksText).toContain("6.1.32-nekodex.20");
  expect(hooksText).not.toContain("6.1.15-nekodex.1");
  const configText = readFileSync(config, "utf8");
  expect(configText).toContain(codexInterruptHookHash(current));
  expect(configText).not.toContain(codexInterruptHookHash(old));
  // Journal, config and hooks still agree.
  expect(inspectCodexIntegration().errors).toEqual([]);

  expect(refreshCodexInterruptHook(runtime("6.1.32-nekodex.20"))).toEqual({ changed: false });
  expect(readFileSync(hooks, "utf8")).toBe(hooksText);
}));

test.serial("a route the user put behind a gateway is left exactly as it is", isolated(({ config, hooks }) => {
  installCodexIntegration({ ...defaultConfig("full"), ...runtime("6.1.15-nekodex.1") });
  const managed = inspectCodexIntegration().routeUrl!;
  writeFileSync(config, readFileSync(config, "utf8").replace(`openai_base_url = ${JSON.stringify(managed)}`,
    `openai_base_url = ${JSON.stringify(GATEWAY)}`));

  expect(refreshCodexInterruptHook(runtime("6.1.32-nekodex.20"))).toEqual({ changed: true });
  expect(readFileSync(config, "utf8")).toContain(`openai_base_url = ${JSON.stringify(GATEWAY)}`);
  expect(readFileSync(hooks, "utf8")).toContain("6.1.32-nekodex.20");
  // Only the user's newer route differs, as before the refresh.
  expect(inspectCodexIntegration().errors).toEqual([BASE_URL_CHANGED_MESSAGE]);
}));

test.serial("a hook entry the user edited is theirs and is not rewritten", isolated(({ config, hooks }) => {
  installCodexIntegration({ ...defaultConfig("full"), ...runtime("6.1.15-nekodex.1") });
  const edited = readFileSync(hooks, "utf8").replace('\\"interrupt\\"', '\\"interrupt\\" \\"--verbose\\"')
    .replace("'interrupt'", "'interrupt' '--verbose'");
  writeFileSync(hooks, edited);
  const configText = readFileSync(config, "utf8");

  expect(() => refreshCodexInterruptHook(runtime("6.1.32-nekodex.20"))).toThrow();
  expect(readFileSync(hooks, "utf8")).toBe(edited);
  expect(readFileSync(config, "utf8")).toBe(configText);
}));

function bridgeHost(run: (args: string[]) => Promise<{ stdout: string }>) {
  const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
  const events: Array<[string, string]> = [];
  const calls: string[][] = [];
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    assertProductionProfile() {}, currentOperation: () => null, lifecycleOperation: null,
    bridgeStatusAwaitingChainedGateway: async () => ({ installed: true, active: true, changed: false }),
    run: async (_name: string, args: string[]) => { calls.push(args); return run(args); },
    logger: { info: (event: string) => events.push(["info", event]), warn: (event: string) => events.push(["warn", event]) },
  });
  return { host, events, calls };
}

test("every route connect, at start, upgrade and rollback, brings the hook to the running runtime", async () => {
  const { host, events, calls } = bridgeHost(async () => ({ stdout: '{"changed":true}' }));
  await expect(host.connectBridgeRoute()).resolves.toMatchObject({ installed: true, active: true });
  expect(calls).toEqual([["route", "refresh-hook"]]);
  expect(events).toContainEqual(["info", "bridge.interrupt_hook_refreshed"]);
});

test("a hook refresh that fails never fails the route", async () => {
  const { host, events } = bridgeHost(async () => { throw new Error("hooks.json is not writable"); });
  await expect(host.connectBridgeRoute()).resolves.toMatchObject({ active: true });
  expect(events).toContainEqual(["warn", "bridge.interrupt_hook_refresh_failed"]);
  expect(host.lifecycleOperation).toBeNull();
});
