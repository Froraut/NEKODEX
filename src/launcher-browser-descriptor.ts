import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { expandUserPath } from "./config";
import { processRunning } from "./process";
import { LauncherBrowserHostUnavailableError } from "./launcher-browser-errors";

export const LAUNCHER_BROWSER_HOST_KIND = "codex-web-gpt-launcher";
export const LAUNCHER_BROWSER_IDLE_URL = "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ENEKODEX%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E#codex-web-gpt-browser-host";
export type LauncherBrowserHostProfile = "production" | "development";

export interface LauncherBrowserHostDescriptor {
  version: 3;
  kind: typeof LAUNCHER_BROWSER_HOST_KIND;
  profile: LauncherBrowserHostProfile;
  pid: number;
  endpoint: string;
  control: {
    endpoint: string;
    token: string;
  };
  helper: {
    executable: string;
    script: string;
  };
  partition: string;
  accountId?: string;
  idleUrl: string;
  surfaceId: string;
  surfaceTargets: Record<string, string>;
  features?: string[];
  createdAt: string;
}

function assertLoopbackEndpoint(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing`);
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error(`${label} is not a valid URL`); }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error(`${label} must use http://127.0.0.1`);
  }
  if (!parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must contain only a loopback host and explicit port`);
  }
  return parsed.origin;
}

function assertDescriptorShape(value: unknown): LauncherBrowserHostDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Launcher browser descriptor is not an object");
  }
  const descriptor = value as Partial<LauncherBrowserHostDescriptor>;
  if (descriptor.version !== 3 || descriptor.kind !== LAUNCHER_BROWSER_HOST_KIND) {
    throw new Error("Launcher browser descriptor has an unsupported identity or version; restart the updated launcher");
  }
  if (descriptor.profile !== "production" && descriptor.profile !== "development") {
    throw new Error("Launcher browser descriptor has an invalid profile");
  }
  if (!Number.isInteger(descriptor.pid) || descriptor.pid! < 1) {
    throw new Error("Launcher browser descriptor has an invalid pid");
  }
  const endpoint = assertLoopbackEndpoint(descriptor.endpoint, "Launcher CDP endpoint");
  if (!descriptor.control || typeof descriptor.control !== "object") {
    throw new Error("Launcher browser descriptor is missing its control channel");
  }
  const controlEndpoint = assertLoopbackEndpoint(descriptor.control.endpoint, "Launcher control endpoint");
  if (typeof descriptor.control.token !== "string" || !/^[A-Za-z0-9_-]{40,}$/.test(descriptor.control.token)) {
    throw new Error("Launcher browser descriptor has an invalid control token");
  }
  if (!descriptor.helper || typeof descriptor.helper !== "object") {
    throw new Error("Launcher browser descriptor is missing its Node helper command");
  }
  const helperExecutable = typeof descriptor.helper.executable === "string" ? resolve(descriptor.helper.executable) : "";
  const helperScript = typeof descriptor.helper.script === "string" ? resolve(descriptor.helper.script) : "";
  if (!helperExecutable || !existsSync(helperExecutable)) {
    throw new Error("Launcher browser descriptor helper executable does not exist");
  }
  if (!helperScript || !existsSync(helperScript)) {
    throw new Error("Launcher browser descriptor helper script does not exist");
  }
  const accountId = descriptor.accountId ?? "default";
  if (accountId !== "default" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(accountId)) {
    throw new Error("Invalid launcher account identity");
  }
  const basePartition = descriptor.profile === "development"
    ? "persist:codex-web-gpt-dev-chatgpt"
    : "persist:codex-web-gpt-chatgpt";
  const expectedPartition = accountId === "default" ? basePartition : `${basePartition}-account-${accountId}`;
  if (descriptor.partition !== expectedPartition) {
    throw new Error("Launcher browser descriptor identifies an unexpected browser partition");
  }
  if (descriptor.idleUrl !== LAUNCHER_BROWSER_IDLE_URL) {
    throw new Error("Launcher browser descriptor identifies an unexpected idle surface");
  }
  if (typeof descriptor.surfaceId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(descriptor.surfaceId)) {
    throw new Error("Launcher browser descriptor has an invalid owned surface id");
  }
  const targets = descriptor.surfaceTargets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)
    || Object.entries(targets).some(([surface, target]) => !/^[A-Za-z0-9_-]{32}$/.test(surface)
      || typeof target !== "string" || !target.trim())
    || new Set(Object.values(targets)).size !== Object.keys(targets).length) {
    throw new Error("Launcher browser descriptor has invalid or duplicated surface targets");
  }
  if (typeof descriptor.createdAt !== "string" || Number.isNaN(Date.parse(descriptor.createdAt))) {
    throw new Error("Launcher browser descriptor has an invalid creation time");
  }
  if (descriptor.features !== undefined && (!Array.isArray(descriptor.features)
    || descriptor.features.some(feature => typeof feature !== "string" || !feature))) {
    throw new Error("Launcher browser descriptor has invalid feature flags");
  }
  return {
    version: 3,
    kind: LAUNCHER_BROWSER_HOST_KIND,
    profile: descriptor.profile,
    pid: descriptor.pid!,
    endpoint,
    control: { endpoint: controlEndpoint, token: descriptor.control.token },
    helper: { executable: helperExecutable, script: helperScript },
    partition: descriptor.partition,
    accountId,
    idleUrl: descriptor.idleUrl,
    surfaceId: descriptor.surfaceId,
    surfaceTargets: targets,
    ...(descriptor.features ? { features: [...descriptor.features] } : {}),
    createdAt: descriptor.createdAt,
  };
}

export function readLauncherBrowserHostDescriptor(configuredPath: string): LauncherBrowserHostDescriptor {
  const path = resolve(expandUserPath(configuredPath));
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new LauncherBrowserHostUnavailableError(
        `Launcher browser host is unavailable: descriptor is missing at ${path}`,
        "descriptor-missing",
      );
    }
    throw error;
  }
  if (!stat.isFile()) throw new Error(`Launcher browser descriptor is not a regular file: ${path}`);
  if (process.platform !== "win32") {
    if ((stat.mode & 0o077) !== 0) throw new Error(`Launcher browser descriptor has unsafe permissions: ${path}`);
    const getuid = process.getuid;
    if (typeof getuid === "function" && stat.uid !== getuid()) {
      throw new Error(`Launcher browser descriptor is not owned by the current user: ${path}`);
    }
  }
  let decoded: unknown;
  try { decoded = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new LauncherBrowserHostUnavailableError(
        `Launcher browser host is unavailable: descriptor is missing at ${path}`,
        "descriptor-missing",
      );
    }
    throw new Error(`Launcher browser descriptor is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const descriptor = assertDescriptorShape(decoded);
  if (!processRunning(descriptor.pid)) {
    throw new LauncherBrowserHostUnavailableError(
      `Launcher browser host process is not running (pid ${descriptor.pid})`,
      "process-not-running",
    );
  }
  return descriptor;
}
