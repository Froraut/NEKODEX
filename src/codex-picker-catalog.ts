import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, getConfigDir, stripUtf8Bom, type AppConfig } from "./config";
import { augmentNativeModelCatalog, buildChatGptWebModel } from "./model-catalog";
import {
  CHATGPT_WEB_LUNA_MODEL_ROUTES,
  CHATGPT_WEB_MODEL_PREFIX,
  CHATGPT_WEB_MODEL_ROUTES,
  requireChatGptWebModelRoute,
} from "./chatgpt-web-models";
import {
  findTopLevelAssignment,
  firstTableIndex,
  insertDocumentLine,
  parseDocument,
  removeDocumentLine,
  renderDocument,
  splitLines,
} from "./codex-integration-document";
import { getCodexConfigPath, type CodexModelContextOverride, type PreviousAssignment } from "./codex-integration-shared";

// The Codex desktop picker lists only an OpenAI-supplied allowlist unless Codex is
// configured with its own model_catalog_json. This mixed-mode catalog keeps every
// native row from the account's live catalog and adds the routed Web rows. Codex
// reads the file once per app-server start, so the runtime refreshes it on traffic
// and a Codex restart shows the refreshed list.

const KEY = "model_catalog_json";

export interface PickerCatalogState {
  path: string;
  previous: PreviousAssignment;
}

export function pickerCatalogPath(): string {
  return join(getConfigDir(), "codex-picker-models.json");
}

export function nativeCatalogPath(): string {
  return join(getConfigDir(), "codex-native-models.json");
}

export function isPickerCatalogState(value: unknown): value is PickerCatalogState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const previous = state.previous as Record<string, unknown> | undefined;
  return typeof state.path === "string" && state.path.length > 0
    && !!previous && typeof previous === "object" && typeof previous.present === "boolean"
    && (previous.index === undefined || (Number.isSafeInteger(previous.index) && (previous.index as number) >= 0))
    && (!previous.present || (typeof previous.rawLine === "string" && typeof previous.value === "string"));
}

/** Builds the picker catalog: live native rows, named Web rows, and hidden rows for saved fixed-mode tasks. */
export function buildPickerCatalog(
  native: unknown,
  config: AppConfig,
  contextOverride?: CodexModelContextOverride,
): string {
  const augmented = augmentNativeModelCatalog(native, config, contextOverride);
  const models = augmented.models as Array<Record<string, unknown>>;
  const nativeModels = models.filter(model => !String(model.slug).startsWith(CHATGPT_WEB_MODEL_PREFIX));
  const template = nativeModels.find(model => model.visibility === "list"
    && Array.isArray(model.supported_reasoning_levels)
    && (config.mode !== "full" || typeof model.tool_mode === "string"));
  if (template && config.browserInteractionMode !== "manual") {
    for (const legacy of [...CHATGPT_WEB_MODEL_ROUTES, ...CHATGPT_WEB_LUNA_MODEL_ROUTES]) {
      if (models.some(model => model.slug === legacy.slug)) continue;
      try {
        const route = requireChatGptWebModelRoute(legacy.slug, config);
        models.push({ ...buildChatGptWebModel(template, route, config), visibility: "hide" });
      } catch { /* A saved route unavailable for this account stays unavailable. */ }
    }
  }
  return JSON.stringify({ models }, null, 2) + "\n";
}

function readJson(path: string): unknown {
  return JSON.parse(stripUtf8Bom(readFileSync(path, "utf8")));
}

/** Native source at setup: Codex's own cache, else the runtime's last live catalog. */
export function initialNativeCatalog(codexModelsCachePath: string): unknown | undefined {
  for (const path of [codexModelsCachePath, nativeCatalogPath()]) {
    if (!existsSync(path)) continue;
    try {
      const value = readJson(path) as { models?: unknown };
      if (value && Array.isArray(value.models) && value.models.length > 0) return value;
    } catch { /* An unreadable cache is not a catalog source. */ }
  }
  return undefined;
}

export interface PickerCatalogRefresh {
  changed: boolean;
  webModels: number;
}

/**
 * Rewrites the installed picker catalog from a live native catalog. The file is owned by
 * its location; it is refreshed only while installed so a disabled picker leaves nothing.
 */
export function refreshPickerCatalog(
  native: unknown,
  config: AppConfig,
  contextOverride?: CodexModelContextOverride,
): PickerCatalogRefresh | undefined {
  const path = pickerCatalogPath();
  // The last live native catalog also seeds a later opt-in after Codex cleared its own cache.
  atomicWriteFile(nativeCatalogPath(), JSON.stringify(native) + "\n");
  if (!existsSync(path)) return undefined;
  const data = buildPickerCatalog(native, config, contextOverride);
  const webModels = (JSON.parse(data).models as Array<{ slug: string; visibility?: string }>)
    .filter(model => model.slug.startsWith(CHATGPT_WEB_MODEL_PREFIX) && model.visibility === "list").length;
  if (readFileSync(path, "utf8") === data) return { changed: false, webModels };
  atomicWriteFile(path, data);
  return { changed: true, webModels };
}

export function pickerCatalogAgeMs(now = Date.now()): number | undefined {
  try { return now - statSync(pickerCatalogPath()).mtimeMs; } catch { return undefined; }
}

/** Disabling keeps the native seed; uninstall removes both NEKODEX-owned files. */
export function removePickerCatalogFiles({ includeNativeSeed = false } = {}): string[] {
  return [pickerCatalogPath(), ...(includeNativeSeed ? [nativeCatalogPath()] : [])].filter(path => existsSync(path));
}

/** Refuses to replace a catalog the user configured; ours is applied only when none is set. */
export function applyPickerCatalog(text: string, path: string): { text: string; state: PickerCatalogState } {
  const document = parseDocument(text);
  const found = findTopLevelAssignment(document.lines, KEY);
  if (found.present && found.value !== path) {
    throw new Error("Codex already uses its own model_catalog_json; the NEKODEX picker catalog was not installed");
  }
  const line = `${KEY} = ${JSON.stringify(path)}`;
  if (found.index !== undefined) document.lines[found.index] = line;
  else insertDocumentLine(document, firstTableIndex(document.lines), line);
  return { text: renderDocument(document), state: { path, previous: { present: false } } };
}

/** True when Codex currently points at the NEKODEX-owned picker catalog. */
export function pointsAtPickerCatalog(text: string): boolean {
  return findTopLevelAssignment(splitLines(text), KEY).value === pickerCatalogPath();
}

/** Whether the Codex config currently in effect points at the picker catalog. */
export function pickerCatalogInUse(): boolean {
  try { return pointsAtPickerCatalog(readFileSync(getCodexConfigPath(), "utf8")); } catch { return false; }
}

/**
 * Crash recovery chooses between journal copies by exact picker ownership: a journal
 * with an active picker catalog needs our line, every other journal state forbids it.
 */
export function pickerOwnershipMatches(text: string, active: boolean, state: PickerCatalogState | undefined): boolean {
  return pointsAtPickerCatalog(text) === Boolean(active && state);
}

/**
 * Removes only our line. A value the user changed or removed while connected is theirs,
 * so it is kept instead of blocking disconnect, repair or uninstall.
 */
export function restorePickerCatalog(text: string, state: PickerCatalogState): string {
  const document = parseDocument(text);
  const found = findTopLevelAssignment(document.lines, KEY);
  if (found.value !== state.path) return text;
  if (found.index !== undefined) removeDocumentLine(document, found.index);
  if (state.previous.present) {
    insertDocumentLine(document, Math.min(state.previous.index ?? 0, firstTableIndex(document.lines)), state.previous.rawLine!);
  }
  return renderDocument(document);
}
