import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { deactivateCodexIntegration, inspectCodexIntegration, installCodexIntegration } from "../src/codex-integration";
import { BASE_URL_CHANGED_MESSAGE } from "../src/codex-integration-route";
import {
  inspectCodexIntegrationWithChain,
  UNVERIFIED_CHAIN_DETAIL,
  verifyChainedCodexRoute,
  type HealthFetcher,
} from "../src/codex-chained-route";

const RUNTIME = "http://127.0.0.1:17841/v1";
const GATEWAY = "http://127.0.0.1:17844/v1";
const runtimeHealth = { status: "ok", service: "codex-chatgpt-web", version: "6.1.31-nekodex.1", instance_id: "run-1" };
const gatewayHealth = (upstream: Record<string, unknown>) => ({ status: "ok", version: "0.4.1", source: "codex-config/providers", upstream });

function healthFetcher(bodies: Record<string, unknown>, seen: string[] = []): HealthFetcher {
  return async url => {
    seen.push(url);
    const body = bodies[new URL(url).origin];
    if (body === undefined) throw new Error("connection refused");
    return Response.json(body);
  };
}

const chain = (managed: string, upstream: Record<string, unknown> = { reachable: true, status: 200, version: runtimeHealth.version }) =>
  healthFetcher({ [new URL(managed).origin]: runtimeHealth, "http://127.0.0.1:17844": gatewayHealth(upstream) });

test("a loopback gateway whose reachable upstream is this runtime proves the chain", async () => {
  expect(await verifyChainedCodexRoute(GATEWAY, RUNTIME, { fetcher: chain(RUNTIME) })).toEqual({
    url: GATEWAY, upstreamUrl: RUNTIME, upstreamVersion: "6.1.31-nekodex.1", gatewayVersion: "0.4.1",
  });
});

test("the chain is refused unless the gateway vouches for exactly this runtime", async () => {
  const refused = [
    chain(RUNTIME, { reachable: false }),
    chain(RUNTIME, { reachable: true, version: "6.1.30-nekodex.1" }),
    chain(RUNTIME, { reachable: true, version: runtimeHealth.version, instance_id: "another-runtime" }),
    chain(RUNTIME, { reachable: true, version: runtimeHealth.version, origin: "http://127.0.0.1:17900" }),
    // A second runtime on the newer port is not a gateway in front of this one.
    healthFetcher({ "http://127.0.0.1:17841": runtimeHealth, "http://127.0.0.1:17844": { ...runtimeHealth, upstream: { reachable: true, version: runtimeHealth.version } } }),
    // The managed runtime itself must answer; a gateway alone proves nothing.
    healthFetcher({ "http://127.0.0.1:17844": gatewayHealth({ reachable: true, version: runtimeHealth.version }) }),
  ];
  for (const fetcher of refused) expect(await verifyChainedCodexRoute(GATEWAY, RUNTIME, { fetcher })).toBeUndefined();
});

test("non-loopback, credentialed or differently shaped URLs are refused without any request", async () => {
  const seen: string[] = [];
  const fetcher = healthFetcher({}, seen);
  for (const url of ["https://127.0.0.1:17844/v1", "http://gateway.example:17844/v1", "http://user:pw@127.0.0.1:17844/v1",
    "http://127.0.0.1:17844/other", RUNTIME]) {
    expect(await verifyChainedCodexRoute(url, RUNTIME, { fetcher })).toBeUndefined();
  }
  expect(seen).toEqual([]);
});

function isolated(action: (paths: { config: string }) => Promise<void>) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "nekodex-chained-route-"));
    const prior = { codex: process.env.CODEX_HOME, bridge: process.env.CODEX_CHATGPT_WEB_HOME };
    process.env.CODEX_HOME = join(root, "codex");
    process.env.CODEX_CHATGPT_WEB_HOME = join(root, "bridge");
    try {
      mkdirSync(process.env.CODEX_HOME);
      const config = join(process.env.CODEX_HOME, "config.toml");
      writeFileSync(config, 'model = "native-model"\n');
      writeFileSync(join(process.env.CODEX_HOME, "models_cache.json"), JSON.stringify({ models: [{ slug: "native-model",
        visibility: "list", tool_mode: "code_mode_only", base_instructions: "Isolated fixture", input_modalities: ["text"],
        supported_reasoning_levels: [{ effort: "high", description: "High" }], default_reasoning_level: "high" }] }));
      await action({ config });
    } finally {
      if (prior.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior.codex;
      if (prior.bridge === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior.bridge;
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test.serial("status accepts a verified gateway chain without touching the user's newer route", isolated(async ({ config }) => {
  installCodexIntegration(defaultConfig("full"));
  const managed = inspectCodexIntegration().routeUrl!;
  writeFileSync(config, readFileSync(config, "utf8").replace(`openai_base_url = ${JSON.stringify(managed)}`,
    `openai_base_url = ${JSON.stringify(GATEWAY)}`));
  const userText = readFileSync(config, "utf8");

  const strict = inspectCodexIntegration();
  expect(strict.errors).toEqual([BASE_URL_CHANGED_MESSAGE]);
  expect(strict.baseUrlChanged).toEqual({ current: GATEWAY, error: BASE_URL_CHANGED_MESSAGE });

  const chained = await inspectCodexIntegrationWithChain({ fetcher: chain(managed) });
  expect(chained.errors).toEqual([]);
  expect(chained.active).toBe(true);
  expect(chained.chainedRoute).toMatchObject({ url: GATEWAY, upstreamUrl: managed });

  const unverified = await inspectCodexIntegrationWithChain({ fetcher: healthFetcher({}) });
  expect(unverified.errors).toEqual([`${BASE_URL_CHANGED_MESSAGE} (${UNVERIFIED_CHAIN_DETAIL})`]);
  expect(unverified.chainedRoute).toBeUndefined();

  // Writes stay strict: a chain is a status fact, never permission to replace the user's value.
  expect(() => deactivateCodexIntegration()).toThrow(/openai_base_url changed/);
  expect(readFileSync(config, "utf8")).toBe(userText);
}));

test.serial("other managed-route drift still fails even behind a verified gateway", isolated(async ({ config }) => {
  installCodexIntegration(defaultConfig("full"));
  const managed = inspectCodexIntegration().routeUrl!;
  writeFileSync(config, readFileSync(config, "utf8")
    .replace(`openai_base_url = ${JSON.stringify(managed)}`, `openai_base_url = ${JSON.stringify(GATEWAY)}`)
    .replace(/^# Managed by codex-chatgpt-web.*\n/m, ""));
  const status = await inspectCodexIntegrationWithChain({ fetcher: chain(managed) });
  expect(status.chainedRoute).toBeUndefined();
  expect(status.errors.join("; ")).toMatch(/marker changed/);
}));

test("the launcher treats a chained status as connected and logs the chain once", async () => {
  const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
  const logged: Array<[string, unknown]> = [];
  const status = { installed: true, active: true, routeUrl: RUNTIME, errors: [],
    chainedRoute: { url: GATEWAY, upstreamUrl: RUNTIME, upstreamVersion: "6.1.31-nekodex.1" } };
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    assertProductionProfile() {},
    run: async () => ({ stdout: JSON.stringify(status) }),
    logger: { info: (event: string, details: unknown) => logged.push([event, details]) },
  });
  expect(await host.bridgeStatus()).toMatchObject({ active: true, chainedRoute: { url: GATEWAY } });
  await host.bridgeStatus();
  expect(logged).toEqual([["bridge.route_chained", { url: GATEWAY, upstreamUrl: RUNTIME, upstreamVersion: "6.1.31-nekodex.1" }]]);
  host.run = async () => ({ stdout: JSON.stringify({ ...status, chainedRoute: undefined,
    errors: [`${BASE_URL_CHANGED_MESSAGE} (${UNVERIFIED_CHAIN_DETAIL})`] }) });
  await expect(host.bridgeStatus()).rejects.toThrow(/Codex bridge route is inconsistent/);
});

test.serial("a gateway waiting for this down runtime is named as a pending chain, still unverified", isolated(async ({ config }) => {
  installCodexIntegration(defaultConfig("full"));
  const managed = inspectCodexIntegration().routeUrl!;
  writeFileSync(config, readFileSync(config, "utf8").replace(`openai_base_url = ${JSON.stringify(managed)}`,
    `openai_base_url = ${JSON.stringify(GATEWAY)}`));
  const unverified = `${BASE_URL_CHANGED_MESSAGE} (${UNVERIFIED_CHAIN_DETAIL})`;
  const runtimeDown = (upstream: Record<string, unknown>) =>
    healthFetcher({ "http://127.0.0.1:17844": gatewayHealth(upstream) });

  const pending = await inspectCodexIntegrationWithChain({ fetcher: runtimeDown({ reachable: false }) });
  expect(pending.errors).toEqual([unverified]);
  expect(pending.chainedRoute).toBeUndefined();
  expect(pending.pendingChainedRoute).toEqual({ url: GATEWAY, upstreamUrl: managed, gatewayVersion: "0.4.1" });
  expect(await verifyChainedCodexRoute(GATEWAY, managed, { fetcher: runtimeDown({ reachable: false }) })).toBeUndefined();

  // A running runtime the gateway cannot reach, a gateway naming another upstream, a second
  // runtime instance or no gateway at all are not a pending chain.
  for (const fetcher of [
    chain(managed, { reachable: false }),
    runtimeDown({ reachable: false, origin: "http://127.0.0.1:17900" }),
    runtimeDown({ reachable: true, version: runtimeHealth.version }),
    healthFetcher({ "http://127.0.0.1:17844": { ...runtimeHealth, upstream: { reachable: false } } }),
    healthFetcher({}),
  ]) {
    const status = await inspectCodexIntegrationWithChain({ fetcher });
    expect(status.errors).toEqual([unverified]);
    expect(status.pendingChainedRoute).toBeUndefined();
  }
}));

function launcherHost(status: Record<string, unknown>, logged: Array<[string, unknown]>, runs: string[][]) {
  const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
  return Object.assign(Object.create(RuntimeHost.prototype), {
    assertProductionProfile() {},
    currentOperation: () => null,
    run: async (_name: string, args: string[]) => { runs.push(args); return { stdout: JSON.stringify(status) }; },
    logger: { info: (event: string, details: unknown) => logged.push([event, details]) },
  });
}

test("the runtime-failure fail-safe leaves a pending gateway chain alone without an error", async () => {
  const logged: Array<[string, unknown]> = [];
  const runs: string[][] = [];
  const status = { installed: true, active: true, routeUrl: RUNTIME,
    errors: [`${BASE_URL_CHANGED_MESSAGE} (${UNVERIFIED_CHAIN_DETAIL})`],
    pendingChainedRoute: { url: GATEWAY, upstreamUrl: RUNTIME, gatewayVersion: "0.4.4" } };
  const host = launcherHost(status, logged, runs);
  expect(await host.restoreBridgeRoute("runtime-start-fail-safe"))
    .toMatchObject({ installed: true, active: true, errors: [], pendingChainedRoute: { url: GATEWAY } });
  expect(runs).toEqual([["route", "status"]]);
  expect(logged).toEqual([["bridge.route_chained_upstream_down", { url: GATEWAY, upstreamUrl: RUNTIME }]]);

  // Everything else stays strict: plain status, uninstall's restore, and a pending chain for another route.
  await expect(host.bridgeStatus()).rejects.toThrow(/Codex bridge route is inconsistent/);
  await expect(host.restoreBridgeRouteWithinOperation("uninstall-integration")).rejects.toThrow(/inconsistent/);
  const foreign = launcherHost({ ...status, pendingChainedRoute: { url: GATEWAY, upstreamUrl: "http://127.0.0.1:17900/v1" } }, [], []);
  await expect(foreign.restoreBridgeRoute("runtime-start-fail-safe")).rejects.toThrow(/inconsistent/);
  const unchained = launcherHost({ ...status, pendingChainedRoute: undefined }, [], []);
  await expect(unchained.restoreBridgeRoute("runtime-start-fail-safe")).rejects.toThrow(/inconsistent/);
});
