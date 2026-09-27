import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getConfigDir, loadConfig, preserveUtf8Bom, stripUtf8Bom, type AppConfig } from "./config";
import { snapshotFile, writeFilesWithCompensation } from "./file-transactions";
import { localApiKey, prepareLocalApiAccess } from "./local-api-access";
import { preferredClaudeGatewayModelIds } from "./messages/models";

type Json = Record<string, any>;
type Previous = Record<string, { present: boolean; value?: unknown }>;
interface Journal {
  version: 1; owner: "nekodex-claude"; settingsPath: string; active: boolean; previousEnvPresent: boolean;
  installed: { settings: Json; env: Json }; previous: { settings: Previous; env: Previous };
}
const journalPath = () => join(getConfigDir(), "claude-integration.json");
const SETTING_KEYS = ["model", "availableModels", "enforceAvailableModels"];
const ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"];
export const claudeSettingsPath = () => join(resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")), "settings.json");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Claude settings must be a JSON object");
  return value as Json;
}
function readSettings(path: string) {
  const snapshot = snapshotFile(path, { followSymlink: true });
  if ((snapshot.data?.length ?? 0) > 4 * 1024 * 1024) throw new Error("Claude settings exceed the supported size");
  try { return { snapshot, value: snapshot.data ? object(JSON.parse(stripUtf8Bom(snapshot.data.toString("utf8")))) : {} }; }
  catch { throw new Error("Claude settings JSON is invalid; existing data was preserved"); }
}
function readJournal(): Journal | undefined {
  if (!existsSync(journalPath())) return;
  const stat = lstatSync(journalPath());
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024
    || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("Claude ownership journal must be a private regular file");
  let value: Journal;
  try { value = object(JSON.parse(readFileSync(journalPath(), "utf8"))) as Journal; }
  catch { throw new Error("Claude integration journal JSON is invalid"); }
  if (value.version !== 1 || value.owner !== "nekodex-claude" || typeof value.active !== "boolean" || value.settingsPath !== claudeSettingsPath()
    || typeof value.previousEnvPresent !== "boolean" || !value.installed?.settings || !value.installed?.env
    || !value.previous?.settings || !value.previous?.env) throw new Error("Claude integration ownership is invalid");
  for (const [keys, installed, saved] of [[SETTING_KEYS, value.installed.settings, value.previous.settings],
    [ENV_KEYS, value.installed.env, value.previous.env]] as const) {
    if (Object.keys(installed).length !== keys.length || Object.keys(saved).length !== keys.length
      || keys.some(key => !Object.hasOwn(installed, key) || typeof saved[key]?.present !== "boolean")) {
      throw new Error("Claude integration journal has unknown owned fields");
    }
  }
  return value;
}
function assertOwned(settings: Json, journal: Journal) {
  const env = settings.env === undefined ? {} : object(settings.env);
  for (const [key, value] of Object.entries(journal.installed.settings)) {
    if (key === "model" && journal.installed.settings.availableModels?.includes(settings.model)) continue;
    if (!same(settings[key], value)) throw new Error(`Claude ${key} changed after connection; preserving your edit`);
  }
  for (const [key, value] of Object.entries(journal.installed.env)) {
    if (!same(env[key], value)) throw new Error(`Claude ${key} changed after connection; preserving your edit`);
  }
}
function previous(target: Json, desired: Json): Previous {
  return Object.fromEntries(Object.keys(desired).map(key => [key, { present: Object.hasOwn(target, key),
    ...(Object.hasOwn(target, key) ? { value: target[key] } : {}) }]));
}
function restore(target: Json, values: Previous) {
  for (const [key, before] of Object.entries(values)) {
    if (before.present) target[key] = before.value; else delete target[key];
  }
}

export function installClaudeIntegration(config: AppConfig) {
  if (config.browserInteractionMode === "manual") throw new Error("Claude Code requires Automatic mode");
  const path = claudeSettingsPath(), { snapshot, value } = readSettings(path);
  const existing = readJournal();
  if (existing?.active) assertOwned(value, existing);
  const env = value.env === undefined ? {} : object(value.env);
  if (!existing?.active && (env.ANTHROPIC_BASE_URL || env.ANTHROPIC_AUTH_TOKEN)) {
    throw new Error("Claude already has a custom provider. Remove that route before connecting NEKODEX; existing settings were preserved");
  }
  const availableModels = preferredClaudeGatewayModelIds(config);
  if (!availableModels.length) throw new Error("No automatic ChatGPT Web models are available");
  if (existing?.active && !availableModels.includes(value.model)) throw new Error("The selected Claude Web model is unavailable; choose another model before refreshing");
  const access = prepareLocalApiAccess(true);
  const installed = {
    settings: { model: existing?.active ? value.model : availableModels[0], availableModels, enforceAvailableModels: true },
    env: { ANTHROPIC_BASE_URL: `http://${config.host}:${config.port}/claude`, ANTHROPIC_AUTH_TOKEN: access.key,
      ANTHROPIC_API_KEY: access.key, CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1" },
  };
  const journal: Journal = { version: 1, owner: "nekodex-claude", settingsPath: path, active: true,
    previousEnvPresent: existing?.active ? existing.previousEnvPresent : Object.hasOwn(value, "env"), installed,
    previous: existing?.active ? existing.previous : { settings: previous(value, installed.settings), env: previous(env, installed.env) } };
  const receipt = snapshotFile(journalPath());
  writeFilesWithCompensation([
    access.write,
    { path, data: preserveUtf8Bom(JSON.stringify({ ...value, ...installed.settings, env: { ...env, ...installed.env } }, null, 2) + "\n", snapshot.data?.toString("utf8") ?? ""),
      expectedSnapshot: snapshot, followSymlink: true },
    { path: receipt.path, data: JSON.stringify(journal, null, 2) + "\n", expectedSnapshot: receipt },
  ]);
  return inspectClaudeIntegration();
}

export function removeClaudeIntegration() {
  const journal = readJournal();
  if (!journal?.active) return inspectClaudeIntegration();
  const { snapshot, value } = readSettings(journal.settingsPath);
  assertOwned(value, journal);
  const env = object(value.env);
  restore(value, journal.previous.settings); restore(env, journal.previous.env);
  if (!journal.previousEnvPresent && Object.keys(env).length === 0) delete value.env;
  const receipt = snapshotFile(journalPath());
  writeFilesWithCompensation([
    { path: snapshot.path, data: preserveUtf8Bom(JSON.stringify(value, null, 2) + "\n", snapshot.data?.toString("utf8") ?? ""), expectedSnapshot: snapshot, followSymlink: true },
    { path: receipt.path, data: JSON.stringify({ ...journal, active: false }, null, 2) + "\n", expectedSnapshot: receipt },
  ]);
  return inspectClaudeIntegration();
}

export function inspectClaudeIntegration() {
  const journal = readJournal();
  if (!journal?.active) return { installed: false, ready: false, model: null as string | null, issue: null as string | null };
  const { value } = readSettings(journal.settingsPath);
  try {
    assertOwned(value, journal);
    const ready = localApiKey() === journal.installed.env.ANTHROPIC_AUTH_TOKEN;
    return { installed: true, ready, model: value.model as string, issue: ready ? null : "Enable Local API or reconnect Claude after key rotation" };
  } catch (error) { return { installed: true, ready: false, model: null, issue: error instanceof Error ? error.message : "Claude settings changed" }; }
}

export function claudeIntegrationCommand(args: string[]) {
  const action = args.shift() ?? "status";
  if (args.length || !["status", "connect", "disconnect"].includes(action)) throw new Error("Usage: codex-chatgpt-web claude <status|connect|disconnect>");
  const result = action === "connect" ? installClaudeIntegration(loadConfig())
    : action === "disconnect" ? removeClaudeIntegration() : inspectClaudeIntegration();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
