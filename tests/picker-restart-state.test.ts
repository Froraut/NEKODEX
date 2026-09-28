import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createStateStore } = require("../launcher/electron/state.cjs");
const { RuntimeHost } = require("../launcher/electron/runtime.cjs");

test("a changed Codex model list keeps restart guidance until the picker is confirmed", () => {
  const dir = mkdtempSync(join(tmpdir(), "nekodex-picker-restart-"));
  try {
    const file = join(dir, "launcher-state.json");
    const store = createStateStore(file);
    store.update({ coreSetupComplete: true, codexCatalogVerified: true, codexPickerConfirmed: true, codexRestartRequired: false });
    store.update({ codexPickerConfirmed: false, codexRestartRequired: true });
    expect(store.update({ language: "ru" })).toMatchObject({ codexCatalogVerified: true, codexPickerConfirmed: false, codexRestartRequired: true });
    // Reloading the launcher keeps it too.
    expect(createStateStore(file).read()).toMatchObject({ codexPickerConfirmed: false, codexRestartRequired: true });
    // Web-only asks for a restart in the same update that marks its catalog as known.
    const reset = createStateStore(join(dir, "web-only.json"));
    reset.update({ coreSetupComplete: true, codexCatalogVerified: false, codexRestartRequired: true });
    expect(reset.update({ codexCatalogVerified: true, codexPickerConfirmed: false, codexRestartRequired: true }).codexRestartRequired).toBe(true);
    // Observing the served catalog, and the user's confirmation, clear it.
    const served = createStateStore(join(dir, "served.json"));
    served.update({ coreSetupComplete: true, codexCatalogVerified: false, codexRestartRequired: true });
    expect(served.update({ codexCatalogVerified: true }).codexRestartRequired).toBe(false);
    expect(store.update({ codexPickerConfirmed: true, codexRestartRequired: false }).codexRestartRequired).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the runtime host reports whether saved evidence changed the visible picker", async () => {
  const receipts: unknown[] = [];
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    logger: { info: (_event: string, detail: unknown) => receipts.push(detail), warn() {} },
    launcherProfile: "production", active: null, lifecycleOperation: null, activeChild: null, browserDescriptorPath: "/nonexistent",
    runtimeConfigSnapshot: () => ({ configured: true, config: { browserHost: "launcher", browserInteractionMode: "automatic",
      solAvailable: true, proAvailable: false, extraHighAvailable: false } }),
    launcherControlEnvironment: () => ({}),
    command: () => ({ executable: "/bin/sh", args: ["-c", "echo '{\"saved\":true,\"webModels\":6,\"pickerChanged\":true}'"], cwd: "/" }),
  });
  expect(await host.saveModelCapabilities({ solAvailable: true, proAvailable: true, extraHighAvailable: true,
    modelCapabilities: { observedAt: 1, families: { "5.6": ["max"] }, names: {} } })).toEqual({ saved: true, pickerChanged: true });
  expect(receipts).toEqual([{ pickerChanged: true, webModels: 6 }]);
});
