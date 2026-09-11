import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJournalSnapshot } from "./codex-integration-journal";
import { readBoundedUtf8File } from "./read-bounded-file";
import { getCodexHome } from "./codex-integration-shared";

export interface CodexRouteDiagnostics {
  schemaVersion: 1;
  codexHome: string;
  configPath: string;
  profilePath: string | null;
  configStatus: "missing" | "loaded" | "invalid" | "unreadable";
  profile: string | null;
  provider: string | null;
  providerSource: "default" | "root" | "profile" | "unknown";
  customProvider: boolean;
  modelCatalogOverride: boolean;
  installed: boolean | null;
  active: boolean | null;
  routeMatches: boolean | null;
  issueCodes: string[];
}

interface IntegrationInspection { installed: boolean; active: boolean | null; routeUrl?: string; errors: string[]; recoveryPending?: boolean }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const safeName = (value: unknown): string | null => typeof value === "string" && value.trim() === value
  && /^[\p{L}\p{M}\p{N}_. -]{1,128}$/u.test(value) ? value : null;

/** Report configured routing without returning TOML, provider URLs, credentials, or mutating it. */
export function diagnoseCodexConfiguration(
  text: string | null,
  { codexHome, profile, profileText, integration }: { codexHome: string; profile?: string; profileText?: string; integration: IntegrationInspection | null },
): CodexRouteDiagnostics {
  const result: CodexRouteDiagnostics = {
    schemaVersion: 1,
    codexHome: resolve(codexHome), configPath: join(resolve(codexHome), "config.toml"),
    profilePath: profile && profileText !== undefined && safeName(profile) ? join(resolve(codexHome), `${profile}.config.toml`) : null,
    configStatus: text === null && profileText === undefined ? "missing" : "loaded", profile: null, provider: "openai",
    providerSource: "default", customProvider: false, modelCatalogOverride: false,
    installed: integration?.installed ?? null, active: integration?.active ?? null,
    routeMatches: null, issueCodes: [],
  };
  if (!integration) result.issueCodes.push("integration-unreadable");
  else if (integration.errors.length) result.issueCodes.push("integration-drift");
  if (integration?.recoveryPending) result.issueCodes.push("integration-recovery-pending");
  if (text === null && profileText === undefined && profile === undefined) {
    result.issueCodes.push("config-missing");
    return result;
  }
  let config: Record<string, unknown>;
  try {
    const parsed = Bun.TOML.parse((text ?? "").replace(/^\uFEFF/, ""));
    if (!object(parsed)) throw new Error("Configuration root is not a table");
    config = parsed;
  }
  catch {
    result.configStatus = "invalid";
    result.provider = null;
    result.providerSource = "unknown";
    result.issueCodes.push("config-invalid");
    return result;
  }
  const selected = profile;
  let effective = config;
  if (selected !== undefined) {
    result.profile = safeName(selected);
    let overlay: unknown;
    try { overlay = profileText === undefined ? undefined : Bun.TOML.parse(profileText.replace(/^\uFEFF/, "")); } catch { /* Generic profile error only. */ }
    if (!result.profile || !object(overlay)) {
      result.provider = null;
      result.providerSource = "unknown";
      result.issueCodes.push("profile-unavailable");
      return result;
    }
    effective = { ...config, ...overlay };
    if (Object.hasOwn(overlay, "model_provider")) result.providerSource = "profile";
  }
  if (effective.model_provider !== undefined) {
    result.provider = safeName(effective.model_provider);
    if (!result.provider) {
      result.providerSource = "unknown";
      result.issueCodes.push("provider-invalid");
    } else if (result.providerSource !== "profile") result.providerSource = "root";
    // Display restrictions must not hide the fact that a configured custom provider can bypass the bridge.
    result.customProvider = typeof effective.model_provider === "string" && effective.model_provider.length > 0 && effective.model_provider !== "openai";
  }
  result.modelCatalogOverride = effective.model_catalog_json !== undefined;
  if (result.customProvider) result.issueCodes.push("custom-provider");
  if (result.modelCatalogOverride) result.issueCodes.push("catalog-override");
  if (integration?.installed && integration.routeUrl) {
    result.routeMatches = effective.openai_base_url === integration.routeUrl;
    if (integration.active && !result.routeMatches) result.issueCodes.push("route-mismatch");
  }
  return result;
}

export function readCodexRouteDiagnostics(options: {
  codexHome?: string;
  profile?: string;
  inspect?: () => IntegrationInspection;
  journalPaths?: { primaryPath: string; recoveryPath: string };
} = {}): CodexRouteDiagnostics {
  const home = resolve(options.codexHome ?? getCodexHome());
  const configPath = join(home, "config.toml");
  let integration: IntegrationInspection | null = null;
  try {
    if (options.inspect) integration = options.inspect();
    else {
      const snapshot = readJournalSnapshot(options.journalPaths);
      const journal = snapshot.journal;
      const samePath = journal && (process.platform === "win32"
        ? resolve(journal.configPath).toLowerCase() === configPath.toLowerCase()
        : resolve(journal.configPath) === configPath);
      integration = {
        installed: Boolean(journal && samePath),
        active: snapshot.recoveryPending || (journal && !samePath) ? null : journal ? ("active" in journal ? journal.active : true) : false,
        ...(!snapshot.recoveryPending && samePath && journal && "openai_base_url" in journal.installed && typeof journal.installed.openai_base_url === "string"
          ? { routeUrl: journal.installed.openai_base_url } : {}),
        errors: journal && !samePath ? ["different-home"] : [],
        recoveryPending: snapshot.recoveryPending,
      };
    }
  } catch { /* Do not repair journals or include their contents in diagnostics. */ }
  let text: string | null = null;
  let profileText: string | undefined;
  try {
    if (existsSync(configPath)) text = readBoundedUtf8File(configPath);
    if (options.profile && safeName(options.profile)) {
      const profilePath = join(home, `${options.profile}.config.toml`);
      if (existsSync(profilePath)) profileText = readBoundedUtf8File(profilePath);
    }
  } catch {
    const result = diagnoseCodexConfiguration(null, { codexHome: home, profile: options.profile, integration });
    result.configStatus = "unreadable";
    result.provider = null;
    result.providerSource = "unknown";
    result.issueCodes = result.issueCodes.filter(code => code !== "config-missing").concat("config-unreadable");
    return result;
  }
  return diagnoseCodexConfiguration(text, { codexHome: home, profile: options.profile, profileText, integration });
}
