import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, loadConfig } from "./config";
import { snapshotFile, writeFileSnapshot } from "./file-transactions";

interface LocalApiState { version: 1; enabled: boolean; key: string; updatedAt: string }
const KEY = /^sk-local-[a-f0-9]{64}$/;
export const localApiStatePath = () => join(getConfigDir(), "local-api-access.json");

function parseState(text: string): LocalApiState {
  let value: LocalApiState;
  try { value = JSON.parse(text) as LocalApiState; } catch { throw new Error("Local API configuration JSON is invalid"); }
  if (!value || value.version !== 1 || typeof value.enabled !== "boolean" || !KEY.test(value.key)
    || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("Local API configuration is invalid");
  return { version: 1, enabled: value.enabled, key: value.key, updatedAt: value.updatedAt };
}

function readState(): LocalApiState | undefined {
  const path = localApiStatePath();
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384
    || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw new Error("Local API configuration must be a private regular file");
  }
  return parseState(readFileSync(path, "utf8"));
}

/** Read on admission so disabling access or rotating the key takes effect immediately. */
export function localApiKey(): string | undefined {
  const state = readState();
  return state?.enabled ? state.key : undefined;
}

export function localApiStatus() {
  const state = readState();
  return { enabled: state?.enabled === true, configured: Boolean(state),
    keyFingerprint: state ? createHash("sha256").update(state.key).digest("hex").slice(0, 12) : null };
}

export function prepareLocalApiAccess(enabled: boolean, rotate = false) {
  const before = snapshotFile(localApiStatePath());
  // Validate permissions/ownership before using an existing credential.
  const current = readState();
  const next: LocalApiState = { version: 1, enabled,
    key: current && !rotate ? current.key : `sk-local-${randomBytes(32).toString("hex")}`,
    updatedAt: new Date().toISOString() };
  return { key: next.key, write: { path: before.path, data: `${JSON.stringify(next, null, 2)}\n`, expectedSnapshot: before } };
}

export function setLocalApiAccess(enabled: boolean, rotate = false) {
  const { write } = prepareLocalApiAccess(enabled, rotate);
  writeFileSnapshot(write.expectedSnapshot, write.data, { expectedSnapshot: write.expectedSnapshot });
  return localApiStatus();
}

export function localApiCommand(args: string[]): void {
  const action = args.shift() ?? "status";
  if (args.length || !["status", "enable", "disable", "rotate", "key"].includes(action)) {
    throw new Error("Usage: codex-chatgpt-web api <status|enable|disable|rotate|key>");
  }
  const config = loadConfig();
  if (action === "enable" || action === "disable") setLocalApiAccess(action === "enable");
  if (action === "rotate") setLocalApiAccess(localApiStatus().enabled, true);
  if (action === "key") {
    const key = localApiKey();
    if (!key) throw new Error("Local API access is disabled");
    process.stdout.write(`${key}\n`); return;
  }
  process.stdout.write(JSON.stringify({ ...localApiStatus(), baseUrl: `http://${config.host}:${config.port}/v1`,
    protocols: ["chat-completions", "messages"] }, null, 2) + "\n");
}
