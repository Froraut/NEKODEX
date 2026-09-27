import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { activateCodexIntegration, deactivateCodexIntegration, installCodexIntegration,
  inspectCodexIntegration, uninstallCodexIntegration } from "../src/codex-integration";
import { pickerCatalogPath, refreshPickerCatalog } from "../src/codex-picker-catalog";
import { getCodexJournalPath, getCodexJournalRecoveryPath } from "../src/codex-integration-shared";

function isolated(action: (fixture: ReturnType<typeof fixture>) => void) {
  const root = mkdtempSync(join(tmpdir(), "nekodex-picker-catalog-"));
  const prior = { codex: process.env.CODEX_HOME, bridge: process.env.CODEX_CHATGPT_WEB_HOME };
  process.env.CODEX_HOME = join(root, "codex");
  process.env.CODEX_CHATGPT_WEB_HOME = join(root, "bridge");
  try { action(fixture()); }
  finally {
    if (prior.codex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prior.codex;
    if (prior.bridge === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior.bridge;
    rmSync(root, { recursive: true, force: true });
  }
}

const nativeRow = (slug: string, priority: number) => ({ slug, visibility: "list", priority,
  tool_mode: "code_mode_only", base_instructions: "Isolated fixture", input_modalities: ["text"],
  supported_reasoning_levels: [{ effort: "high", description: "High" }], default_reasoning_level: "high" });

function fixture() {
  const codex = process.env.CODEX_HOME!;
  mkdirSync(codex);
  const path = join(codex, "config.toml"), cache = join(codex, "models_cache.json");
  const original = 'model = "native-model" # personal choice\nmodel_reasoning_effort = "high"\n\n[features]\ngoals = true\n';
  writeFileSync(path, original);
  writeFileSync(cache, JSON.stringify({ models: [nativeRow("native-model", 1)] }));
  return { path, cache, original, config: defaultConfig("full"), read: () => Bun.TOML.parse(readFileSync(path, "utf8")) as any };
}

const slugs = (path: string) => (JSON.parse(readFileSync(path, "utf8")).models as Array<{ slug: string; visibility: string }>);

test.serial("mixed mode points Codex at a picker catalog with native and Web rows and restores exactly", () => isolated(f => {
  installCodexIntegration(f.config);
  const installed = f.read();
  expect(installed.model).toBe("native-model");
  expect(installed.model_provider).toBeUndefined();
  expect(installed.model_catalog_json).toBe(pickerCatalogPath());
  const models = slugs(pickerCatalogPath());
  expect(models[0]).toMatchObject({ slug: "native-model", visibility: "list" });
  expect(models.filter(model => model.visibility === "list").map(model => model.slug))
    .toContain("chatgpt-web/gpt-5.6-sol");
  // Saved fixed-mode tasks keep metadata, but never appear in the picker.
  expect(models.find(model => model.slug === "chatgpt-web/high")?.visibility).toBe("hide");
  expect(inspectCodexIntegration().errors).toEqual([]);

  deactivateCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
  activateCodexIntegration();
  expect(f.read().model_catalog_json).toBe(pickerCatalogPath());
  uninstallCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
  expect(existsSync(pickerCatalogPath())).toBe(false);
}));

test.serial("picker opt-out persists across setup and Web-only mode owns the catalog key", () => isolated(f => {
  installCodexIntegration(f.config, { pickerCatalog: false });
  expect(f.read().model_catalog_json).toBeUndefined();
  expect(existsSync(pickerCatalogPath())).toBe(false);
  writeFileSync(f.cache, JSON.stringify({ models: [nativeRow("native-model", 1)] }));
  installCodexIntegration(f.config);
  expect(f.read().model_catalog_json).toBeUndefined();

  // Setup cleared Codex's cache and nothing refreshed it, so an explicit opt-in explains why it cannot proceed.
  expect(() => installCodexIntegration(f.config, { pickerCatalog: true })).toThrow("Open Codex once");
  expect(f.read().model_catalog_json).toBeUndefined();
  writeFileSync(f.cache, JSON.stringify({ models: [nativeRow("native-model", 1)] }));
  installCodexIntegration(f.config, { pickerCatalog: true });
  expect(f.read().model_catalog_json).toBe(pickerCatalogPath());
  installCodexIntegration(f.config, { providerMode: "web-only" });
  expect(f.read().model_provider).toBe("nekodex-web");
  expect(f.read().model_catalog_json).not.toBe(pickerCatalogPath());
  expect(existsSync(pickerCatalogPath())).toBe(false);
  expect(inspectCodexIntegration().errors).toEqual([]);
  // Codex removed its cache when Web-only was installed; the runtime's last catalog seeds mixed mode.
  installCodexIntegration(f.config, { providerMode: "mixed" });
  expect(f.read().model_provider).toBeUndefined();
  uninstallCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
}));

test.serial("a user-configured model catalog keeps precedence", () => isolated(f => {
  const own = join(process.env.CODEX_HOME!, "own-models.json");
  writeFileSync(own, JSON.stringify({ models: [nativeRow("native-model", 1)] }));
  const original = `model_catalog_json = ${JSON.stringify(own)}\n${f.original}`;
  writeFileSync(f.path, original);
  installCodexIntegration(f.config);
  expect(f.read().model_catalog_json).toBe(own);
  expect(existsSync(pickerCatalogPath())).toBe(false);
  uninstallCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(original);
}));

test.serial("the runtime refreshes only an installed picker catalog and reports changes", () => isolated(f => {
  expect(refreshPickerCatalog({ models: [nativeRow("native-model", 1)] }, f.config)).toBeUndefined();
  installCodexIntegration(f.config);
  expect(refreshPickerCatalog({ models: [nativeRow("native-model", 1)] }, f.config)?.changed).toBe(false);
  const refreshed = refreshPickerCatalog({ models: [nativeRow("native-model", 1), nativeRow("native-next", 2)] }, f.config);
  expect(refreshed?.changed).toBe(true);
  expect(refreshed?.webModels).toBeGreaterThan(0);
  expect(slugs(pickerCatalogPath()).map(model => model.slug)).toContain("native-next");
  uninstallCodexIntegration();
}));

test.serial("a catalog the user sets while disconnected blocks neither reconnect nor uninstall", () => isolated(f => {
  installCodexIntegration(f.config);
  deactivateCodexIntegration();
  const own = join(process.env.CODEX_HOME!, "own-models.json");
  writeFileSync(own, JSON.stringify({ models: [nativeRow("native-model", 1)] }));
  writeFileSync(f.path, `model_catalog_json = ${JSON.stringify(own)}\n${readFileSync(f.path, "utf8")}`);
  expect(inspectCodexIntegration().errors).toEqual([]);
  activateCodexIntegration();
  expect(f.read().model_catalog_json).toBe(own);
  uninstallCodexIntegration();
  expect(f.read().model_catalog_json).toBe(own);
}));

test.serial("a managed catalog line the user removed while connected is not required back", () => isolated(f => {
  installCodexIntegration(f.config);
  writeFileSync(f.path, readFileSync(f.path, "utf8").replace(/^model_catalog_json = .*\n/m, ""));
  expect(inspectCodexIntegration().errors).toEqual([]);
  deactivateCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
  uninstallCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
}));

test.serial("an interrupted opt-in resolves to the journal copy that owns the written catalog line", () => isolated(f => {
  installCodexIntegration(f.config, { pickerCatalog: false });
  const journals = [getCodexJournalPath(), getCodexJournalRecoveryPath()];
  expect(journals.every(path => existsSync(path))).toBe(true);
  const before = journals.map(path => readFileSync(path, "utf8"));
  writeFileSync(f.cache, JSON.stringify({ models: [nativeRow("native-model", 1)] }));
  installCodexIntegration(f.config, { pickerCatalog: true });
  // Simulate a crash after the config and recovery copy were written but before the primary copy.
  writeFileSync(journals[0]!, before[0]!);
  expect(readFileSync(journals[0]!, "utf8")).not.toBe(readFileSync(journals[1]!, "utf8"));
  expect(inspectCodexIntegration().errors).toEqual([]);
  expect(f.read().model_catalog_json).toBe(pickerCatalogPath());
  uninstallCodexIntegration();
  expect(readFileSync(f.path, "utf8")).toBe(f.original);
}));

test.serial("an explicit opt-in explains a user-owned catalog and picker changes never leave Web-only mode", () => isolated(f => {
  const own = join(process.env.CODEX_HOME!, "own-models.json");
  writeFileSync(own, JSON.stringify({ models: [nativeRow("native-model", 1)] }));
  writeFileSync(f.path, `model_catalog_json = ${JSON.stringify(own)}\n${f.original}`);
  installCodexIntegration(f.config);
  expect(() => installCodexIntegration(f.config, { pickerCatalog: true })).toThrow("its own model_catalog_json");
  expect(f.read().model_catalog_json).toBe(own);
  uninstallCodexIntegration();
}));
