import { writeFilesWithCompensation, type FileSnapshot } from "./file-transactions";
export { snapshotFile, assertFileSnapshotCurrent, writeFileSnapshot, restoreFileSnapshot, writeFilesWithCompensation, fileSnapshotsMatch, type FileSnapshot, type CommittedFileReceipt } from "./file-transactions";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AppConfig, SubagentProtocol } from "./config";
import { expandUserPath, getConfigDir } from "./config";

export const MANAGED_COMMENT = "# Managed by codex-chatgpt-web; `codex-chatgpt-web uninstall` restores prior values.";
export const MANAGED_ROUTE_COMMENT =
  "# Managed by codex-chatgpt-web: Responses use the local bridge; Voice stays on ChatGPT.";
export const CODEX_REALTIME_WEBRTC_CALL_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const MANAGED_REMOTE_COMPACTION_LINE =
  "remote_compaction_v2 = false # Managed by codex-chatgpt-web: bounds retained Web image history.";
export const MANAGED_MULTI_AGENT_LINE =
  "multi_agent = true # Managed by codex-chatgpt-web: enables routed Web subagents.";
export const MANAGED_MULTI_AGENT_V2_LINE =
  "multi_agent_v2 = false # Managed by codex-chatgpt-web: keeps routed Web subagent payloads readable.";
export const MANAGED_MULTI_AGENT_V2_TABLE_LINE =
  "enabled = false # Managed by codex-chatgpt-web: keeps routed Web subagent payloads readable.";
export const MIN_COMPATIBILITY_V1_AGENT_DEPTH = 2;
export function managedAgentMaxDepthLine(value: number): string {
  return `max_depth = ${value} # Managed by codex-chatgpt-web: allows nested routed Web subagents in Compatibility V1.`;
}

export interface PreviousAssignment {
  present: boolean;
  rawLine?: string;
  value?: string;
  index?: number;
}
export type ManagedAssignmentKey = "openai_base_url" | "model_provider" | "model_catalog_json";

export interface PreviousFeatureAssignment extends PreviousAssignment {
  tablePresent: boolean;
  tableName?: "features" | "features.multi_agent_v2";
  inlineTable?: boolean;
  separatorInserted?: boolean;
}

export interface PreviousAgentAssignment extends PreviousAssignment {
  tablePresent: boolean;
  separatorInserted?: boolean;
}

export interface InstalledCodexInterruptHook {
  command: string;
  groupIndex: number;
  stateKey: string;
  trustedHash: string;
  fragment: string;
}

export interface InstalledCodexInterruptHookJson {
  storage: "json";
  command: string;
  hooksPath: string;
  groupIndex: number;
  hookIndex: number;
  entryHash: string;
  stateKey: string;
  trustedHash: string;
  trustFragment: string;
}

export interface InstalledCodexInterruptHookToml extends InstalledCodexInterruptHook {
  storage: "toml";
}

export interface CodexIntegrationJournal {
  version: 11;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
    experimental_realtime_webrtc_call_base_url: string;
    subagent_protocol: SubagentProtocol;
    agent_max_depth?: number;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  previousRealtimeWebrtcCallBaseUrl: PreviousAssignment;
  interruptHook: InstalledCodexInterruptHookToml | InstalledCodexInterruptHookJson;
  previousMultiAgent?: PreviousFeatureAssignment;
  previousMultiAgentV2?: PreviousFeatureAssignment;
  previousAgentMaxDepth?: PreviousAgentAssignment;
  format?: {
    lineEnding: "\n" | "\r\n" | "\r";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV10 {
  version: 10;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
    experimental_realtime_webrtc_call_base_url: string;
    subagent_protocol: SubagentProtocol;
    agent_max_depth?: number;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  previousRealtimeWebrtcCallBaseUrl: PreviousAssignment;
  interruptHook: InstalledCodexInterruptHook;
  previousMultiAgent?: PreviousFeatureAssignment;
  previousMultiAgentV2?: PreviousFeatureAssignment;
  previousAgentMaxDepth?: PreviousAgentAssignment;
  format?: {
    lineEnding: "\n" | "\r\n" | "\r";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV9 {
  version: 9;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
    experimental_realtime_webrtc_call_base_url: string;
    subagent_protocol: SubagentProtocol;
    agent_max_depth?: number;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  previousRealtimeWebrtcCallBaseUrl: PreviousAssignment;
  previousMultiAgent?: PreviousFeatureAssignment;
  previousMultiAgentV2?: PreviousFeatureAssignment;
  previousAgentMaxDepth?: PreviousAgentAssignment;
  format?: {
    lineEnding: "\n" | "\r\n" | "\r";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV8 {
  version: 8;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
    subagent_protocol: SubagentProtocol;
    agent_max_depth?: number;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  previousMultiAgent?: PreviousFeatureAssignment;
  previousMultiAgentV2?: PreviousFeatureAssignment;
  previousAgentMaxDepth?: PreviousAgentAssignment;
  format?: {
    lineEnding: "\n" | "\r\n";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV7 {
  version: 7;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  format?: {
    lineEnding: "\n" | "\r\n";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV6 {
  version: 6;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
    remote_compaction_v2: false;
    multi_agent: true;
    multi_agent_v2: false;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  previousRemoteCompactionV2: PreviousFeatureAssignment;
  previousMultiAgent: PreviousFeatureAssignment;
  previousMultiAgentV2: PreviousFeatureAssignment;
  format?: {
    lineEnding: "\n" | "\r\n";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV5 {
  version: 5;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
    remote_compaction_v2: false;
    multi_agent: true;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  previousRemoteCompactionV2: PreviousFeatureAssignment;
  previousMultiAgent: PreviousFeatureAssignment;
  format?: {
    lineEnding: "\n" | "\r\n";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV4 {
  version: 4;
  active: boolean;
  configPath: string;
  installed: {
    openai_base_url: string;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  format?: {
    lineEnding: "\n" | "\r\n";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournalV3 {
  version: 3;
  configPath: string;
  installed: {
    openai_base_url: string;
  };
  previous: Record<ManagedAssignmentKey, PreviousAssignment>;
  format?: {
    lineEnding: "\n" | "\r\n";
    trailingNewline: boolean;
  };
}

export interface LegacyCodexIntegrationJournal {
  version: 2;
  uninstalling?: { restoredConfigSha256: string };
  configPath: string;
  catalogPath: string;
  catalogSha256: string;
  providerBlock: string;
  installed: {
    model_provider: string;
    model_catalog_json: string;
  };
  previous: {
    model_provider: PreviousAssignment;
    model_catalog_json: PreviousAssignment;
  };
}

export type ManagedRouteJournal =
  | CodexIntegrationJournal
  | LegacyCodexIntegrationJournalV10
  | LegacyCodexIntegrationJournalV9
  | LegacyCodexIntegrationJournalV8
  | LegacyCodexIntegrationJournalV7
  | LegacyCodexIntegrationJournalV6
  | LegacyCodexIntegrationJournalV5
  | LegacyCodexIntegrationJournalV4
  | LegacyCodexIntegrationJournalV3;
export type AnyCodexIntegrationJournal = ManagedRouteJournal | LegacyCodexIntegrationJournal;

export interface InstallCodexIntegrationOptions {
  replaceExistingRoute?: boolean;
}

export interface UninstallCodexIntegrationResult {
  changed: boolean;
}

export interface SetCodexIntegrationActiveResult {
  changed: boolean;
  active: boolean;
}

export interface CodexModelContextOverride {
  contextWindow: number;
}

export function getCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return resolve(expandUserPath(configured || join(homedir(), ".codex")));
}

export function getCodexConfigPath(): string {
  return join(getCodexHome(), "config.toml");
}

export function getCodexHooksPath(): string {
  return join(getCodexHome(), "hooks.json");
}

export function getCodexModelsCachePath(): string {
  return join(getCodexHome(), "models_cache.json");
}

export function getCodexJournalPath(): string {
  return join(getConfigDir(), "codex", "integration-journal.json");
}

export function getCodexJournalRecoveryPath(): string {
  return join(getConfigDir(), "codex", "integration-journal.recovery.json");
}

export function routeUrl(config: AppConfig): string {
  return `http://${config.host}:${config.port}/v1`;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function serializeJournal(journal: AnyCodexIntegrationJournal): string {
  return `${JSON.stringify(journal, null, 2)}\n`;
}

export function writeIntegrationState(
  journal: AnyCodexIntegrationJournal,
  configWrite?: { path: string; data: string },
  removals: string[] = [],
  additionalWrites: Array<{ path: string; data: string; followSymlink?: boolean; expectedSnapshot?: FileSnapshot }> = [],
): void {
  const data = serializeJournal(journal);
  // The recovery copy records intent and the primary copy records commit. If the process stops
  // between those writes, the physical config unambiguously selects the completed state.
  writeFilesWithCompensation([
    { path: getCodexJournalRecoveryPath(), data },
    ...(configWrite ? [{ ...configWrite, followSymlink: true, managed: true }] : []),
    ...additionalWrites.map(write => ({ ...write, followSymlink: write.followSymlink ?? true, managed: true })),
    { path: getCodexJournalPath(), data },
  ], removals);
}
