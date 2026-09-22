import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CHATGPT_WEB_MODEL_ROUTES } from "../src/chatgpt-web-models";
import { defaultConfig } from "../src/config";
import { augmentNativeModelCatalog } from "../src/model-catalog";

const codex = resolve(process.argv[2] ?? "/Applications/ChatGPT.app/Contents/Resources/codex");
const root = mkdtempSync(join(tmpdir(), "codex-chatgpt-web-codex-smoke-"));
const isolatedEnv = {
  ...process.env,
  CODEX_HOME: join(root, "codex"),
  CODEX_CHATGPT_WEB_HOME: join(root, "app"),
};
function runCodex(args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync(codex, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: isolatedEnv,
    cwd: root,
    timeout: 15_000,
  });
  if (result.status !== 0) {
    throw new Error(`Codex ${args.join(" ")} failed: ${result.error?.message || result.stderr || result.signal || `exit ${result.status}`}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

try {
  mkdirSync(isolatedEnv.CODEX_HOME, { recursive: true });
  const bundled = runCodex(["debug", "models", "--bundled"]);
  const sourceCatalog = JSON.parse(bundled.stdout) as {
    models?: Array<{ slug?: string; supported_in_api?: boolean; visibility?: string; priority?: number }>;
  };
  // Native defaults change with Codex releases. Keep the first three visible native models
  // ahead of Web rows, then Pro and Extra High in the bounded V1 override roster.
  const nativeRows = sourceCatalog.models
    ?.filter(model => model.supported_in_api === true && model.visibility === "list" && model.slug && !model.slug.startsWith("chatgpt-web/"))
    .toSorted((left, right) => (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)) ?? [];
  const expectedNative = nativeRows[0]?.slug;
  if (!expectedNative) throw new Error("Bundled Codex catalog has no list-visible native API model");
  const config = defaultConfig("browser-only");
  config.proAvailable = true;
  config.extraHighAvailable = true;
  config.subagentProtocol = "compatibility-v1";
  config.allowWebSubagents = true;
  const catalogPath = join(root, "augmented-models.json");
  writeFileSync(catalogPath, `${JSON.stringify(augmentNativeModelCatalog(sourceCatalog, config))}\n`);
  writeFileSync(join(isolatedEnv.CODEX_HOME, "config.toml"), [
    `model_catalog_json = ${JSON.stringify(catalogPath)}`,
    "",
    "[features]",
    "multi_agent = true",
    "multi_agent_v2 = false",
    "",
  ].join("\n"));
  const result = runCodex(["debug", "models"]);
  const catalog = JSON.parse(result.stdout) as {
    models?: Array<{
      slug?: string;
      supported_reasoning_levels?: unknown[];
      multi_agent_version?: string;
      supported_in_api?: boolean;
      visibility?: string;
      priority?: number;
    }>;
  };
  const web = catalog.models?.filter(model => model.slug?.startsWith("chatgpt-web/")) ?? [];
  const webOrder = [
    "chatgpt-web/pro", "chatgpt-web/extra-high", "chatgpt-web/high",
    "chatgpt-web/medium", "chatgpt-web/light",
  ];
  const expected = webOrder.map(slug => {
    const route = CHATGPT_WEB_MODEL_ROUTES.find(route => route.slug === slug);
    if (!route) throw new Error(`Missing fixed ChatGPT Web route: ${slug}`);
    return { slug: route.slug, effort: route.codexEffort };
  });
  const actual = web.map(model => ({
    slug: model.slug,
    effort: Array.isArray(model.supported_reasoning_levels)
      ? (model.supported_reasoning_levels as Array<{ effort?: string }>).map(level => level.effort).join(",")
      : "",
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Codex did not preserve the fixed ChatGPT Web model contract: ${JSON.stringify(actual)}`);
  }
  const nativeLead = catalog.models?.find(model => model.slug === expectedNative);
  const webPro = catalog.models?.find(model => model.slug === "chatgpt-web/pro");
  if (nativeLead?.multi_agent_version !== "v1" || webPro?.multi_agent_version !== "v1") {
    throw new Error(
      `Codex did not preserve Compatibility V1 metadata for the leading native model and Web Pro: ${JSON.stringify({
        native: nativeLead?.multi_agent_version,
        webPro: webPro?.multi_agent_version,
      })}`,
    );
  }
  const features = runCodex(["features", "list"]).stdout;
  if (!/^multi_agent\s+stable\s+true$/m.test(features)
    || !/^multi_agent_v2\s+stable\s+false$/m.test(features)) {
    throw new Error(`Codex did not load the Compatibility V1 feature override:\n${features}`);
  }
  const spawnOverrides = (catalog.models ?? [])
    .filter(model => model.supported_in_api === true && model.visibility === "list")
    .toSorted((left, right) => (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 5)
    .map(model => model.slug);
  const expectedSpawnOverrides = [
    ...nativeRows.slice(0, 3).map(model => model.slug),
    ...webOrder,
  ].slice(0, 5);
  if (JSON.stringify(spawnOverrides) !== JSON.stringify(expectedSpawnOverrides)) {
    throw new Error(`Codex did not preserve the bounded V1 subagent roster: ${JSON.stringify(spawnOverrides)}`);
  }
  process.stdout.write("NATIVE_CODEX_CATALOG_SMOKE_OK\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
