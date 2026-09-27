import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { activateCodexIntegration, deactivateCodexIntegration, installCodexIntegration,
  inspectCodexIntegration, preflightCodexIntegration, uninstallCodexIntegration } from "../src/codex-integration";

function isolated(action: (fixture: ReturnType<typeof fixture>) => void) {
  const root = mkdtempSync(join(tmpdir(), "nekodex-web-provider-"));
  const prior = { codex: process.env.CODEX_HOME, bridge: process.env.CODEX_CHATGPT_WEB_HOME };
  // These are the application's real profile options, scoped only to this test process.
  process.env.CODEX_HOME = join(root, "codex");
  process.env.CODEX_CHATGPT_WEB_HOME = join(root, "bridge");
  try { action(fixture()); }
  finally {
    if (prior.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior.codex;
    if (prior.bridge === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior.bridge;
    rmSync(root, { recursive: true, force: true });
  }
}
function fixture() {
  const codex = process.env.CODEX_HOME!;
  mkdirSync(codex);
  const path = join(codex, "config.toml"), cache = join(codex, "models_cache.json");
  const original = 'model = "native-model" # personal choice\nmodel_reasoning_effort = "high"\n\n[features]\ngoals = true\n';
  writeFileSync(path, original);
  writeFileSync(cache, JSON.stringify({ models: [{ slug: "native-model", visibility: "list",
    tool_mode: "code_mode_only", base_instructions: "Isolated fixture", input_modalities: ["text"],
    supported_reasoning_levels: [{ effort: "high", description: "High" }], default_reasoning_level: "high" }] }));
  return { path, cache, original, config: defaultConfig("full"), read: () => Bun.TOML.parse(readFileSync(path, "utf8")) as any };
}

test.serial("Web-only config uses independent authentication, survives repair/disconnect and restores native choice", () => isolated(f => {
  installCodexIntegration(f.config, { providerMode: "web-only" });
  const selected = f.read();
  expect(selected.model_provider).toBe("nekodex-web");
  expect(selected.model_providers["nekodex-web"].requires_openai_auth).toBe(false);
  const models = JSON.parse(readFileSync(selected.model_catalog_json, "utf8")).models;
  expect(models.every((model: any) => model.slug.startsWith("chatgpt-web/"))).toBe(true);
  expect(models.filter((model: any) => model.visibility === "list").every((model: any) => model.slug.startsWith("chatgpt-web/gpt-"))).toBe(true);
  expect(inspectCodexIntegration().errors).toEqual([]);
  expect(() => preflightCodexIntegration(f.config)).not.toThrow();
  const legacy = models.find((model: any) => model.slug === "chatgpt-web/high");
  expect(legacy.visibility).toBe("hide");
  writeFileSync(f.path, readFileSync(f.path, "utf8").replace(`model = ${JSON.stringify(selected.model)}`, 'model = "chatgpt-web/high"'));
  installCodexIntegration(f.config);
  expect(f.read().model).toBe("chatgpt-web/high");
  deactivateCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
  activateCodexIntegration();
  expect(f.read().model).toBe("chatgpt-web/high");
  installCodexIntegration(f.config, { providerMode: "mixed" });
  expect(f.read().model).toBe("native-model");
  expect(f.read().model_provider).toBeUndefined();
  uninstallCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
  expect(existsSync(selected.model_catalog_json)).toBe(false);
}));

test.serial("missing catalog and provider collisions cannot change existing user config", () => isolated(f => {
  for (const conflict of ['profile = "work"\n', '[model_providers.nekodex-web]\nname = "User provider"\n']) {
    const text = conflict.startsWith("profile") ? conflict + f.original : f.original + conflict;
    writeFileSync(f.path, text);
    expect(() => installCodexIntegration(f.config, { providerMode: "web-only" })).toThrow(/profile|provider/i);
    expect(readFileSync(f.path, "utf8")).toBe(text);
  }
  writeFileSync(f.path, f.original);
  rmSync(f.cache);
  expect(() => installCodexIntegration(f.config, { providerMode: "web-only" })).toThrow(/catalog/i);
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
  expect(inspectCodexIntegration().installed).toBe(false);
}));

test.serial("catalog tampering blocks live removal and remains untouched after disconnection", () => isolated(f => {
  installCodexIntegration(f.config, { providerMode: "web-only" });
  const catalog = f.read().model_catalog_json;
  const before = readFileSync(f.path, "utf8"), content = readFileSync(catalog, "utf8");
  writeFileSync(catalog, "user data");
  expect(() => deactivateCodexIntegration()).toThrow(/catalog/i);
  expect(readFileSync(f.path, "utf8")).toBe(before);
  writeFileSync(catalog, content);
  deactivateCodexIntegration();
  writeFileSync(catalog, "user data");
  expect(() => activateCodexIntegration()).toThrow(/catalog/i);
  uninstallCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
  expect(readFileSync(catalog, "utf8")).toBe("user data");
}));
