import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexSettingsStatus } from "../launcher/src/setup-progress";
const { createStateStore } = require("../launcher/electron/state.cjs");

function withState(initial: Record<string, unknown>, action: (file: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-refresh-state-"));
  const file = join(directory, "state.json");
  try {
    writeFileSync(file, JSON.stringify({ version: 1, coreSetupComplete: true, ...initial }));
    action(file);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("codex refresh: a received catalog survives reopening without inventing picker confirmation or another restart", () => {
  withState({ codexCatalogVerified: true, codexPickerConfirmed: false, codexRestartRequired: true }, file => {
    const store = createStateStore(file);
    expect(store.read().codexRestartRequired).toBe(false);
    expect(store.read().codexPickerConfirmed).toBe(false);
    store.update({ language: "ru" });
    const reopened = createStateStore(file).read();
    expect(reopened.codexRestartRequired).toBe(false);
    expect(reopened.codexPickerConfirmed).toBe(false);
    expect(codexSettingsStatus(reopened, false)).toBe("picker");
  });
});

test("codex refresh: a real configuration change waits for new evidence and a failed receipt stays cleared across reload", () => {
  withState({ codexCatalogVerified: true, codexPickerConfirmed: true }, file => {
    const store = createStateStore(file);
    store.update({ codexCatalogVerified: false, codexRestartRequired: true });
    expect(createStateStore(file).read().codexRestartRequired).toBe(true);
    expect(store.read().codexPickerConfirmed).toBe(false);
    // A failed current receipt proves contact, not a usable catalog. It must show
    // the catalog failure rather than recreating a generic restart instruction.
    store.update({ codexRestartRequired: false });
    const failed = createStateStore(file).read();
    expect(failed.codexRestartRequired).toBe(false);
    expect(failed.codexCatalogVerified).toBe(false);
    expect(codexSettingsStatus(failed, false, true)).toBe("catalog-error");
    store.update({ codexCatalogVerified: true });
    expect(createStateStore(file).read().codexRestartRequired).toBe(false);
    expect(store.read().codexPickerConfirmed).toBe(false);
  });
});

test("codex refresh: UI distinguishes pending catalog, picker review, Manual refresh, removal and queued context", () => {
  const installed = { coreSetupComplete: true, browserInteractionMode: "automatic", codexRestartRequired: true };
  expect(codexSettingsStatus(installed, false)).toBe("catalog");
  expect(codexSettingsStatus({ ...installed, codexCatalogVerified: true }, false)).toBe("picker");
  expect(codexSettingsStatus({ ...installed, codexCatalogVerified: true, codexPickerConfirmed: true }, false)).toBeNull();
  expect(codexSettingsStatus({ ...installed, browserInteractionMode: "manual" }, false)).toBe("manual-refresh");
  expect(codexSettingsStatus({ ...installed, coreSetupComplete: false }, false)).toBe("removed");
  expect(codexSettingsStatus({ ...installed, pendingBiggerContext: true }, false)).toBeNull();
  expect(codexSettingsStatus(installed, true)).toBeNull();
});
