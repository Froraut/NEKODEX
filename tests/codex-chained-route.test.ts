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
