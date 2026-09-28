import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createStateStore } = require("../launcher/electron/state.cjs");
const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
const { currentPickerContract, pickerCatalogConfigured, pickerReconciliationPatch, visiblePickerContract } =
  require("../launcher/electron/codex-picker-contract.cjs");

const row = (slug: string, efforts: string[], visibility = "list") => ({ slug, visibility, display_name: slug,
  default_reasoning_level: efforts[0], supported_reasoning_levels: efforts.map(effort => ({ effort })) });
const catalog = (...models: object[]) => JSON.stringify({ models }, null, 2);

test("the picker contract covers only the Web rows Codex shows", () => {
  const base = visiblePickerContract(catalog(row("native", ["high"]), row("chatgpt-web/gpt-5.6-sol", ["medium", "high"])));
  expect(visiblePickerContract(catalog(row("native", ["low"]), row("native-two", ["high"]),
    row("chatgpt-web/gpt-5.6-sol", ["medium", "high"]), row("chatgpt-web/high", ["high"], "hide")))).toBe(base);
  expect(visiblePickerContract(catalog(row("native", ["high"]), row("chatgpt-web/gpt-5.6-sol", ["medium", "high", "xhigh"])))).not.toBe(base);
  expect(pickerCatalogConfigured('model = "x"\nmodel_catalog_json = "/h/codex-picker-models.json" # managed\n[features]\n', "/h/codex-picker-models.json")).toBe(true);
  expect(pickerCatalogConfigured('[profiles.a]\nmodel_catalog_json = "/h/codex-picker-models.json"\n', "/h/codex-picker-models.json")).toBe(false);
});

test("any rewrite of the catalog Codex loads asks for a restart until the picker is confirmed again", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-picker-contract-"));
  try {
    const coreHome = join(root, "core"), codexHome = join(root, "codex");
    mkdirSync(coreHome); mkdirSync(codexHome);
    const catalogPath = join(coreHome, "codex-picker-models.json");
    writeFileSync(join(codexHome, "config.toml"), `model_catalog_json = ${JSON.stringify(catalogPath)}\n`);
    writeFileSync(catalogPath, catalog(row("chatgpt-web/gpt-5.6-sol", ["high"])));
    const confirmed = currentPickerContract({ coreHome, codexHome });
    const store = createStateStore(join(root, "launcher-state.json"));
    store.update({ coreSetupComplete: true, codexCatalogVerified: true, codexPickerConfirmed: true,
      codexRestartRequired: false, codexPickerContract: confirmed });
    expect(pickerReconciliationPatch(store.read(), currentPickerContract({ coreHome, codexHome }))).toBeNull();
    // The daemon (or the model-list command) rewrites the catalog; no event reaches the launcher.
    writeFileSync(catalogPath, catalog(row("chatgpt-web/gpt-5.6-sol", ["high"]), row("chatgpt-web/gpt-5.5", ["medium", "high"])));
    const patch = pickerReconciliationPatch(store.read(), currentPickerContract({ coreHome, codexHome }));
    expect(patch).toEqual({ codexPickerConfirmed: false, codexRestartRequired: true });
    store.update(patch);
    // A served catalog request and a launcher restart both keep the request.
    store.update({ codexCatalogVerified: true, language: "ru" });
    const reloaded = createStateStore(join(root, "launcher-state.json"));
    expect(reloaded.read()).toMatchObject({ codexPickerConfirmed: false, codexRestartRequired: true, codexPickerContract: confirmed });
    expect(pickerReconciliationPatch(reloaded.read(), currentPickerContract({ coreHome, codexHome }))).toBeNull();
    // Confirming records the new contract; nothing is pending afterwards.
    const now = currentPickerContract({ coreHome, codexHome });
    reloaded.update({ codexPickerConfirmed: true, codexRestartRequired: false, codexPickerContract: now });
    expect(pickerReconciliationPatch(reloaded.read(), now)).toBeNull();
    // A picker confirmed before contracts were recorded is reconfirmed once, as Codex may hold an older list.
    expect(pickerReconciliationPatch({ coreSetupComplete: true, codexPickerConfirmed: true }, now))
      .toEqual({ codexPickerConfirmed: false, codexRestartRequired: true });
    // Web-only or the picker turned off: Codex does not load this file.
    writeFileSync(join(codexHome, "config.toml"), 'model_provider = "nekodex-web"\n');
    expect(currentPickerContract({ coreHome, codexHome })).toBeNull();
    expect(pickerReconciliationPatch(reloaded.read(), null)).toBeNull();
    expect(pickerReconciliationPatch({ ...reloaded.read(), browserInteractionMode: "manual" }, "0".repeat(64))).toBeNull();
    // Removing the installation forgets the confirmed contract.
    expect(reloaded.update({ coreSetupComplete: false }).codexPickerContract).toBeNull();
    expect(readFileSync(join(root, "launcher-state.json"), "utf8")).toContain('"codexPickerContract": null');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the runtime host reads the whole receipt after a long command output", async () => {
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    logger: { info() {}, warn() {} },
    launcherProfile: "production", active: null, lifecycleOperation: null, activeChild: null, browserDescriptorPath: "/nonexistent",
    runtimeConfigSnapshot: () => ({ configured: true, config: { browserHost: "launcher", browserInteractionMode: "automatic",
      solAvailable: true, proAvailable: false, extraHighAvailable: false } }),
    launcherControlEnvironment: () => ({}),
    command: () => ({ executable: "/bin/sh", args: ["-c",
      "head -c 300000 /dev/zero | tr '\\0' x; echo; echo '{\"saved\":true,\"webModels\":6,\"pickerChanged\":true}'"], cwd: "/" }),
  });
  expect(await host.saveModelCapabilities({ solAvailable: true, proAvailable: true, extraHighAvailable: true,
    modelCapabilities: { observedAt: 1, families: { "5.6": ["max"] }, names: {} } })).toEqual({ saved: true, pickerChanged: true });
});
