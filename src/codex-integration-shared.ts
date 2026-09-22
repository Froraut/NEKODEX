import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AppConfig, SubagentProtocol } from "./config";
import { atomicWriteFile, expandUserPath, getConfigDir } from "./config";

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

export interface FileSnapshot {
  path: string;
  exists: boolean;
  data?: Buffer;
  identity?: { dev: number; ino: number };
  mode?: number;
  symlink?: { link: string; target: string; mode: number; linkIdentity: { dev: number; ino: number }; identity: { dev: number; ino: number } };
}

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

export function snapshotFile(path: string, options?: { followSymlink?: boolean }): FileSnapshot {
  if (options?.followSymlink) {
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (stat?.isSymbolicLink()) {
      const link = readlinkSync(path);
      const target = realpathSync(path);
      const targetStat = lstatSync(target);
      if (!targetStat.isFile()) throw new Error(`Codex config symlink target is not a regular file: ${path}`);
      return {
        path,
        exists: true,
        data: readFileSync(target),
        symlink: {
          link,
          linkIdentity: { dev: stat.dev, ino: stat.ino },
          target,
          mode: targetStat.mode & 0o777,
          identity: { dev: targetStat.dev, ino: targetStat.ino },
        },
      };
    }
  }
  if (!existsSync(path)) return { path, exists: false };
  const stat = lstatSync(path);
  return { path, exists: true, data: readFileSync(path), mode: stat.mode & 0o777, identity: { dev: stat.dev, ino: stat.ino } };
}

/** Write the snapshotted config target, never replace its symbolic link or follow a new target. */
export function assertFileSnapshotCurrent(snapshot: FileSnapshot): void {
  const current = snapshotFile(snapshot.path, { followSymlink: Boolean(snapshot.symlink) });
  if (current.exists !== snapshot.exists
    || (snapshot.exists && (!current.data?.equals(snapshot.data ?? Buffer.alloc(0)) ||
      (snapshot.symlink && (!current.symlink || current.symlink.link !== snapshot.symlink.link
        || current.symlink.linkIdentity.dev !== snapshot.symlink.linkIdentity.dev
        || current.symlink.linkIdentity.ino !== snapshot.symlink.linkIdentity.ino
        || current.symlink.mode !== snapshot.symlink.mode
        || current.symlink.target !== snapshot.symlink.target
        || current.symlink.identity.dev !== snapshot.symlink.identity.dev
        || current.symlink.identity.ino !== snapshot.symlink.identity.ino))
      || (!snapshot.symlink && (current.mode !== snapshot.mode
        || !current.identity || current.identity.dev !== snapshot.identity?.dev
        || current.identity.ino !== snapshot.identity?.ino))))) {
    throw new Error(`Codex integration file changed before the managed mutation; preserving the external edit: ${snapshot.path}`);
  }
}

function fileSnapshotsMatch(current: FileSnapshot, expected: FileSnapshot): boolean {
  if (current.exists !== expected.exists) return false;
  if (!expected.exists) return true;
  if (!current.data?.equals(expected.data ?? Buffer.alloc(0))) return false;
  if (expected.symlink) {
    return Boolean(current.symlink)
      && current.symlink!.link === expected.symlink.link
      && current.symlink!.linkIdentity.dev === expected.symlink.linkIdentity.dev
      && current.symlink!.linkIdentity.ino === expected.symlink.linkIdentity.ino
      && current.symlink!.mode === expected.symlink.mode
      && current.symlink!.target === expected.symlink.target
      && current.symlink!.identity.dev === expected.symlink.identity.dev
      && current.symlink!.identity.ino === expected.symlink.identity.ino;
  }
  return Boolean(current.identity)
    && current.mode === expected.mode
    && current.identity!.dev === expected.identity?.dev
    && current.identity!.ino === expected.identity?.ino;
}

// Capture the inode before publication. Reading the destination after a write can
// accidentally claim another process's replacement as our rollback receipt.
function commitFileSnapshot(snapshot: FileSnapshot, data: string | Uint8Array, expected?: FileSnapshot): FileSnapshot {
  const target = snapshot.symlink?.target ?? snapshot.path;
  const staging = `${target}.integration-${randomUUID()}`;
  let staged: FileSnapshot | undefined;
  try {
    atomicWriteFile(staging, data, snapshot.symlink
      ? { mode: snapshot.symlink.mode, protectDirectory: false } : undefined);
    staged = snapshotFile(staging);
    const delays = [25, 50, 100, 150, 250, 350, 500];
    for (let attempt = 0; ; attempt++) {
      // Backoff lets other writers run; every publication attempt needs a fresh guard.
      if (expected) assertFileSnapshotCurrent(expected);
      try { renameSync(staging, target); break; } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const delay = delays[attempt];
        if (process.platform !== "win32" || !["EBUSY", "EPERM", "EACCES"].includes(code ?? "") || delay === undefined) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      }
    }
    return {
      path: snapshot.path, exists: true, data: staged.data!,
      ...(snapshot.symlink
        ? { symlink: { ...snapshot.symlink, identity: staged.identity! } }
        : { identity: staged.identity!, mode: staged.mode }),
    };
  } catch (error) {
    if (staged) {
      try {
        assertFileSnapshotCurrent(staged);
        rmSync(staging);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], `${String(error)}; integration staging cleanup also failed: ${String(cleanup)}`, { cause: error });
      }
    }
    throw error;
  }
}

export function writeFileSnapshot(
  snapshot: FileSnapshot,
  data: string | Uint8Array,
  options?: { expectedData?: Uint8Array; expectedSnapshot?: FileSnapshot },
): FileSnapshot {
  const expectedSnapshot = options?.expectedSnapshot;
  if (expectedSnapshot || options?.expectedData !== undefined) {
    const current = snapshotFile(snapshot.path, {
      followSymlink: Boolean(expectedSnapshot?.symlink ?? snapshot.symlink),
    });
    if (expectedSnapshot
      ? !fileSnapshotsMatch(current, expectedSnapshot)
      : (!snapshot.exists || !current.exists || !current.data?.equals(options!.expectedData!)
        || !fileSnapshotsMatch(current, snapshot))) {
      throw new Error(`Codex integration file changed before the managed write; preserving the external edit: ${snapshot.path}`);
    }
  }
  const symlink = snapshot.symlink;
  if (!symlink) {
    return commitFileSnapshot(snapshot, data,
      expectedSnapshot ?? (options?.expectedData !== undefined ? snapshot : undefined));
  }
  const linkStat = lstatSync(snapshot.path);
  if (!linkStat.isSymbolicLink()
    || linkStat.dev !== symlink.linkIdentity.dev || linkStat.ino !== symlink.linkIdentity.ino
    || readlinkSync(snapshot.path) !== symlink.link
    || realpathSync(snapshot.path) !== symlink.target
    || (() => {
      const targetStat = lstatSync(realpathSync(snapshot.path));
      const expectedIdentity = options?.expectedSnapshot?.symlink?.identity ?? symlink.identity;
      return targetStat.dev !== expectedIdentity.dev || targetStat.ino !== expectedIdentity.ino;
    })()) {
    throw new Error(`Codex config symlink changed during the operation: ${snapshot.path}`);
  }
  return commitFileSnapshot(snapshot, data, expectedSnapshot ?? snapshot);
}

export function restoreFileSnapshot(snapshot: FileSnapshot, options?: { expectedCurrent?: FileSnapshot }): void {
  if (snapshot.exists) {
    if (!snapshot.data) throw new Error(`File snapshot is missing data: ${snapshot.path}`);
    if (snapshot.symlink && !options?.expectedCurrent && !existsSync(snapshot.path)) {
      const targetStat = lstatSync(snapshot.symlink.target);
      if (targetStat.dev !== snapshot.symlink.identity.dev || targetStat.ino !== snapshot.symlink.identity.ino) {
        throw new Error(`Codex integration symlink target changed before rollback; preserving the external edit: ${snapshot.path}`);
      }
      symlinkSync(snapshot.symlink.link, snapshot.path);
      return;
    }
    writeFileSnapshot(snapshot, snapshot.data, { expectedSnapshot: options?.expectedCurrent });
  } else {
    if (options?.expectedCurrent) {
      const current = snapshotFile(snapshot.path, { followSymlink: Boolean(options.expectedCurrent.symlink) });
      if (!fileSnapshotsMatch(current, options.expectedCurrent)) {
        throw new Error(`Codex integration file changed before rollback removal; preserving the external edit: ${snapshot.path}`);
      }
    }
    rmSync(snapshot.path, { force: true });
  }
}

export function writeFilesWithCompensation(
  writes: Array<{
    path: string;
    data: string | Uint8Array;
    followSymlink?: boolean;
    expectedData?: Uint8Array;
    managed?: boolean;
    expectedSnapshot?: FileSnapshot;
  }>,
  removals: string[] = [],
): void {
  const paths = [...new Set([...writes.map(write => write.path), ...removals])];
  const snapshots = new Map(paths.map(path => [path, snapshotFile(path, {
    followSymlink: writes.some(write => write.path === path && write.followSymlink === true)
      || removals.includes(path),
  })]));
  const guardedWrites = writes.map(write => ({
    ...write,
    expectedSnapshot: write.expectedSnapshot ?? (write.managed ? snapshots.get(write.path) : undefined),
  }));
  const startedWrites = new Set<string>();
  const startedRemovals = new Set<string>();
  const ownedAfterWrite = new Map<string, FileSnapshot>();
  try {
    for (const write of guardedWrites) {
      if (write.expectedData !== undefined) {
        const snapshot = snapshots.get(write.path)!;
        const current = snapshotFile(write.path, { followSymlink: write.followSymlink });
        if (!snapshot.exists || !snapshot.data?.equals(write.expectedData)
          || !current.exists || !current.data?.equals(write.expectedData)) {
          throw new Error(`Codex integration file changed before the managed write; preserving the external edit: ${write.path}`);
        }
      }
      startedWrites.add(write.path);
      const committed = writeFileSnapshot(snapshots.get(write.path)!, write.data, {
        expectedData: write.expectedData,
        expectedSnapshot: write.expectedSnapshot,
      });
      ownedAfterWrite.set(write.path, committed);
    }
    for (const removal of removals) {
      const snapshot = snapshots.get(removal)!;
      assertFileSnapshotCurrent(snapshot);
      rmSync(removal, { force: true });
      startedRemovals.add(removal);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const snapshot of [...snapshots.values()].reverse()) {
      try {
        if (!startedWrites.has(snapshot.path) && !startedRemovals.has(snapshot.path)) continue;
        const write = guardedWrites.find(candidate => candidate.path === snapshot.path);
        const current = snapshotFile(snapshot.path, { followSymlink: Boolean(write?.followSymlink || snapshot.symlink) });
        if (fileSnapshotsMatch(current, snapshot)) continue;
        if (startedWrites.has(snapshot.path)) {
          const owned = ownedAfterWrite.get(snapshot.path);
          if (!owned || !fileSnapshotsMatch(current, owned)) {
            throw new Error("changed after the managed write; preserving the external edit");
          }
          restoreFileSnapshot(snapshot, { expectedCurrent: owned });
        } else if (startedRemovals.has(snapshot.path)) {
          if (current.exists) throw new Error("changed after the managed removal; preserving the external edit");
          restoreFileSnapshot(snapshot);
        }
      } catch (rollbackError) {
        rollbackFailures.push(`${snapshot.path}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    const primary = error instanceof Error ? error.message : String(error);
    throw new Error(
      rollbackFailures.length > 0
        ? `${primary}; Codex integration rollback also failed: ${rollbackFailures.join("; ")}`
        : primary,
    );
  }
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
