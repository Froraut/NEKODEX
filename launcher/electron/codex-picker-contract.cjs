const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Codex reads its model catalog once per start. The launcher records what the user confirmed in
// the Codex picker and compares it with the catalog on disk, whoever rewrote it (the daemon on
// traffic, the model-list command or setup), so a changed list always asks for a Codex restart.

const PICKER_CATALOG_FILE = "codex-picker-models.json";
const WEB_MODEL_PREFIX = "chatgpt-web/";

/** A digest of the Web rows Codex shows: each visible row's ID, name, default and efforts. */
function visiblePickerContract(text) {
  const models = JSON.parse(text)?.models;
  if (!Array.isArray(models)) throw new Error("Codex picker catalog has no models array");
  const rows = models
    .filter(model => model && typeof model.slug === "string" && model.slug.startsWith(WEB_MODEL_PREFIX)
      && model.visibility === "list")
    .map(model => [model.slug, model.display_name ?? null, model.default_reasoning_level ?? null,
      (Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels : [])
        .map(level => level?.effort ?? null)]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function pickerCatalogPath(coreHome) {
  return path.join(coreHome, PICKER_CATALOG_FILE);
}

/** Whether Codex's top-level model_catalog_json names the NEKODEX picker catalog. */
function pickerCatalogConfigured(codexConfigText, catalogPath) {
  for (const line of codexConfigText.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*model_catalog_json\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(line);
    if (match) {
      try { return JSON.parse(match[1]) === catalogPath; } catch { return false; }
    }
  }
  return false;
}

let memo = null;

function fileStamp(file) {
  try { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.size}:${stat.ino}`; } catch { return "missing"; }
}

/**
 * The confirmed-picker contract Codex would load now, or null when Codex does not use the NEKODEX
 * picker catalog (Web-only provider, the picker turned off, or no installation).
 */
function currentPickerContract({ coreHome, codexHome }) {
  const catalogPath = pickerCatalogPath(coreHome);
  const configPath = path.join(codexHome, "config.toml");
  // Periodic checks reread the large catalog only after either file changed.
  const stamp = `${catalogPath}|${fileStamp(configPath)}|${fileStamp(catalogPath)}`;
  if (memo?.stamp === stamp) return memo.contract;
  let contract = null;
  try {
    if (pickerCatalogConfigured(fs.readFileSync(configPath, "utf8"), catalogPath)) {
      contract = visiblePickerContract(fs.readFileSync(catalogPath, "utf8"));
    }
  } catch { contract = null; }
  memo = { stamp, contract };
  return contract;
}

/**
 * State to apply when the catalog Codex would load differs from the one the user confirmed.
 * Only confirming the picker clears the restart request; a served catalog request does not.
 */
function pickerReconciliationPatch(state, contract) {
  if (contract === null || state.coreSetupComplete !== true || state.browserInteractionMode === "manual") return null;
  if ((state.codexPickerContract ?? null) === contract) return null;
  if (state.codexPickerConfirmed !== true && state.codexRestartRequired === true) return null;
  return { codexPickerConfirmed: false, codexRestartRequired: true };
}

module.exports = {
  currentPickerContract,
  pickerCatalogConfigured,
  pickerCatalogPath,
  pickerReconciliationPatch,
  visiblePickerContract,
};
