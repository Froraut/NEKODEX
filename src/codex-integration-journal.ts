import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atomicWriteFile, stripUtf8Bom } from "./config";
import { readBoundedUtf8File } from "./read-bounded-file";
import {
  CODEX_REALTIME_WEBRTC_CALL_BASE_URL,
  getCodexConfigPath,
  getCodexHooksPath,
  getCodexJournalPath,
  getCodexJournalRecoveryPath,
  serializeJournal,
  sha256,
  writeFilesWithCompensation,
} from "./codex-integration-shared";
import type {
  AnyCodexIntegrationJournal,
  CodexIntegrationJournal,
  LegacyCodexIntegrationJournalV10,
  LegacyCodexIntegrationJournal,
  LegacyCodexIntegrationJournalV9,
  LegacyCodexIntegrationJournalV3,
  LegacyCodexIntegrationJournalV4,
  LegacyCodexIntegrationJournalV5,
  LegacyCodexIntegrationJournalV6,
  LegacyCodexIntegrationJournalV7,
  LegacyCodexIntegrationJournalV8,
} from "./codex-integration-shared";
import { verifyManagedJournalState } from "./codex-integration-route";
import {
  installCodexInterruptHookJson,
  restoreCodexInterruptHookJson,
  verifyCodexInterruptHookJson,
} from "./codex-interrupt-hook-json";

function isPreviousAssignment(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const assignment = value as Record<string, unknown>;
  if (typeof assignment.present !== "boolean") return false;
  if (assignment.index !== undefined
    && (!Number.isSafeInteger(assignment.index) || (assignment.index as number) < 0)) return false;
  return !assignment.present
    || (typeof assignment.rawLine === "string" && typeof assignment.value === "string");
}

function isPreviousAssignments(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const assignments = value as Record<string, unknown>;
  return keys.every(key => isPreviousAssignment(assignments[key]));
}

function isPreviousFeatureAssignment(value: unknown): boolean {
  if (!isPreviousAssignment(value)) return false;
  const assignment = value as Record<string, unknown>;
  return typeof assignment.tablePresent === "boolean"
    && (assignment.tableName === undefined
      || assignment.tableName === "features"
      || assignment.tableName === "features.multi_agent_v2")
    && (assignment.inlineTable === undefined || typeof assignment.inlineTable === "boolean")
    && (assignment.separatorInserted === undefined || typeof assignment.separatorInserted === "boolean");
}

function isPreviousAgentAssignment(value: unknown): boolean {
  if (!isPreviousAssignment(value)) return false;
  const assignment = value as Record<string, unknown>;
  return typeof assignment.tablePresent === "boolean"
    && (assignment.separatorInserted === undefined || typeof assignment.separatorInserted === "boolean");
}

const MANAGED_ASSIGNMENT_KEYS = ["openai_base_url", "model_provider", "model_catalog_json"] as const;

function hasCompatibilityEvidence(value: Record<string, unknown>): boolean {
  return isPreviousFeatureAssignment(value.previousMultiAgent)
    && isPreviousFeatureAssignment(value.previousMultiAgentV2)
    && isPreviousAgentAssignment(value.previousAgentMaxDepth);
}

/** Journals 8-11 record the subagent protocol; Compatibility V1 also records its evidence and depth. */
function hasValidSubagentInstall(value: Record<string, unknown>, installed: Record<string, unknown>): boolean {
  return (installed.subagent_protocol === "compatibility-v1" || installed.subagent_protocol === "native")
    && (installed.subagent_protocol !== "compatibility-v1"
      || (hasCompatibilityEvidence(value)
        && typeof installed.agent_max_depth === "number"
        && Number.isSafeInteger(installed.agent_max_depth)
        && installed.agent_max_depth >= 2));
}

/** Journals 9-11 route Responses to the bridge and keep Voice on ChatGPT. */
function hasRealtimeRoute(installed: Record<string, unknown>): boolean {
  return typeof installed.openai_base_url === "string"
    && installed.experimental_realtime_webrtc_call_base_url === CODEX_REALTIME_WEBRTC_CALL_BASE_URL;
}

function isInstalledInterruptHook(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hook = value as Record<string, unknown>;
  return typeof hook.command === "string" && hook.command.length > 0
    && Number.isSafeInteger(hook.groupIndex) && (hook.groupIndex as number) >= 0
    && typeof hook.stateKey === "string" && hook.stateKey.length > 0
    && typeof hook.trustedHash === "string" && /^sha256:[a-f0-9]{64}$/.test(hook.trustedHash)
    && typeof hook.fragment === "string" && hook.fragment.length > 0;
}

function isInstalledInterruptHookV11(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hook = value as Record<string, unknown>;
  if (hook.storage === "toml") return isInstalledInterruptHook(hook);
  return hook.storage === "json"
    && typeof hook.command === "string" && hook.command.length > 0
    && typeof hook.hooksPath === "string" && hook.hooksPath.length > 0
    && Number.isSafeInteger(hook.groupIndex) && (hook.groupIndex as number) >= 0
    && Number.isSafeInteger(hook.hookIndex) && (hook.hookIndex as number) >= 0
    && typeof hook.entryHash === "string" && /^sha256:[a-f0-9]{64}$/.test(hook.entryHash)
    && typeof hook.stateKey === "string" && hook.stateKey.length > 0
    && typeof hook.trustedHash === "string" && /^sha256:[a-f0-9]{64}$/.test(hook.trustedHash)
    && typeof hook.trustFragment === "string" && hook.trustFragment.length > 0;
}

function parseJournal(path: string, contents?: string): AnyCodexIntegrationJournal {
  const value = JSON.parse(stripUtf8Bom(contents ?? readFileSync(path, "utf8"))) as Record<string, unknown>;
  const installed = value.installed as Record<string, unknown> | undefined;
  if (value.version === 11
    && typeof value.active === "boolean"
    && installed
    && hasRealtimeRoute(installed)
    && hasValidSubagentInstall(value, installed)
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && isPreviousAssignment(value.previousRealtimeWebrtcCallBaseUrl)
    && isInstalledInterruptHookV11(value.interruptHook)
    && typeof value.configPath === "string") {
    return value as unknown as CodexIntegrationJournal;
  }
  if (value.version === 10
    && typeof value.active === "boolean"
    && installed
    && hasRealtimeRoute(installed)
    && hasValidSubagentInstall(value, installed)
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && isPreviousAssignment(value.previousRealtimeWebrtcCallBaseUrl)
    && isInstalledInterruptHook(value.interruptHook)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV10;
  }
  if (value.version === 9
    && typeof value.active === "boolean"
    && installed
    && hasRealtimeRoute(installed)
    && hasValidSubagentInstall(value, installed)
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && isPreviousAssignment(value.previousRealtimeWebrtcCallBaseUrl)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV9;
  }
  if (value.version === 8
    && typeof value.active === "boolean"
    && installed
    && hasValidSubagentInstall(value, installed)
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV8;
  }
  if (value.version === 7
    && typeof value.active === "boolean"
    && value.installed
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV7;
  }
  if (value.version === 6
    && typeof value.active === "boolean"
    && value.installed
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && isPreviousFeatureAssignment(value.previousRemoteCompactionV2)
    && isPreviousFeatureAssignment(value.previousMultiAgent)
    && isPreviousFeatureAssignment(value.previousMultiAgentV2)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV6;
  }
  if (value.version === 5
    && typeof value.active === "boolean"
    && value.installed
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && isPreviousFeatureAssignment(value.previousRemoteCompactionV2)
    && isPreviousFeatureAssignment(value.previousMultiAgent)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV5;
  }
  if (value.version === 4
    && typeof value.active === "boolean"
    && value.installed
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV4;
  }
  if (value.version === 3 && value.installed
    && isPreviousAssignments(value.previous, MANAGED_ASSIGNMENT_KEYS)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV3;
  }
  if (value.version === 2 && value.installed
    && isPreviousAssignments(value.previous, ["model_provider", "model_catalog_json"])
    && typeof value.providerBlock === "string"
    && (value.uninstalling === undefined || (value.uninstalling
      && typeof (value.uninstalling as Record<string, unknown>).restoredConfigSha256 === "string"
      && /^[a-f0-9]{64}$/.test((value.uninstalling as Record<string, unknown>).restoredConfigSha256 as string)))) {
    return value as unknown as LegacyCodexIntegrationJournal;
  }
  throw new Error(`Invalid Codex integration journal: ${path}`);
}

function currentJournalBytes(path: string): Uint8Array {
  if (!existsSync(path)) {
    throw new Error(`Codex integration journal changed before the managed write: ${path}`);
  }
  return readFileSync(path);
}

function journalConfigMatches(journal: AnyCodexIntegrationJournal): boolean {
  try {
    assertJournalTargetsConfig(journal, getCodexConfigPath());
    if (!existsSync(journal.configPath)) return false;
    const text = readFileSync(journal.configPath, "utf8");
    if (journal.version === 2) return text.includes(journal.providerBlock)
      || Boolean(journal.uninstalling && sha256(text) === journal.uninstalling.restoredConfigSha256);
    verifyManagedJournalState(text, journal);
    return true;
  } catch {
    return false;
  }
}

function journalExternalHooksMatch(journal: AnyCodexIntegrationJournal): boolean {
  try {
    if (journal.version === 11 && journal.interruptHook.storage === "json") {
      const hook = journal.interruptHook;
      const installed = (): boolean => {
        if (!existsSync(hook.hooksPath)) return false;
        try {
          verifyCodexInterruptHookJson(readFileSync(hook.hooksPath, "utf8"), {
            ...hook,
            mode: "json",
          });
          return true;
        } catch {
          return false;
        }
      };
      return journal.active ? installed() : restoredInactiveJsonHook(journal) === undefined;
    }
    return true;
  } catch {
    return false;
  }
}

function journalMatchesConfig(journal: AnyCodexIntegrationJournal): boolean {
  return journalConfigMatches(journal) && journalExternalHooksMatch(journal);
}

/** Return a removal only when the inactive journal still identifies the exact JSON entry. */
export function restoredInactiveJsonHook(journal: AnyCodexIntegrationJournal):
  { path: string; current: string; restored: string } | undefined {
  if (journal.version !== 11 || journal.active || journal.interruptHook.storage !== "json") return undefined;
  assertJournalTargetsConfig(journal, getCodexConfigPath());
  const hook = journal.interruptHook;
  if (!existsSync(hook.hooksPath)) return undefined;
  const current = readFileSync(hook.hooksPath, "utf8");
  try {
    verifyCodexInterruptHookJson(current, { ...hook, mode: "json" });
    return {
      path: hook.hooksPath,
      current,
      restored: restoreCodexInterruptHookJson(current, { ...hook, mode: "json" }),
    };
  } catch (error) {
    // Parsing and duplicate-command checks still apply when the recorded slot is gone.
    // An occupied recorded slot is an external edit, even if its command differs.
    installCodexInterruptHookJson(current, hook.command);
    const document = JSON.parse(current) as {
      hooks?: Record<string, Array<{ hooks: Array<{ type?: string; command?: string }> }>>;
    };
    const groups = document.hooks?.Interrupt;
    if (groups?.[hook.groupIndex]?.hooks[hook.hookIndex]
      || Object.values(document.hooks ?? {}).some(eventGroups => eventGroups.some(group =>
        group.hooks.some(entry => entry.type === "command" && entry.command === hook.command)))) {
      throw new Error(`Codex JSON interrupt lifecycle hook changed after setup; preserving external edits: ${hook.hooksPath}`, { cause: error });
    }
    return undefined;
  }
}

function recoverPendingJsonHookWrite(
  recovery: AnyCodexIntegrationJournal,
  primary?: AnyCodexIntegrationJournal,
): boolean {
  if (recovery.version !== 11 || recovery.interruptHook.storage !== "json") return false;
  if (!journalConfigMatches(recovery) || journalExternalHooksMatch(recovery)) return false;
  const hookBytes = readFileSync(recovery.interruptHook.hooksPath);
  let current = hookBytes.toString("utf8");
  if (recovery.active && primary?.version === 11 && primary.active
    && primary.interruptHook.storage === "json") {
    assertJournalTargetsConfig(primary, getCodexConfigPath());
    current = restoreCodexInterruptHookJson(current, { ...primary.interruptHook, mode: "json" });
  }
  const next = recovery.active
    ? installCodexInterruptHookJson(current, recovery.interruptHook.command).text
    : restoreCodexInterruptHookJson(current, { ...recovery.interruptHook, mode: "json" });
  if (recovery.active) {
    verifyCodexInterruptHookJson(next, { ...recovery.interruptHook, mode: "json" });
  }
  writeFilesWithCompensation([
    { path: recovery.interruptHook.hooksPath, data: next, followSymlink: true,
      expectedData: hookBytes },
    { path: getCodexJournalPath(), data: serializeJournal(recovery),
      expectedData: currentJournalBytes(getCodexJournalPath()) },
  ]);
  return true;
}

/** Inspect copies without invoking any journal, config or hooks recovery writes. */
export function readJournalSnapshot(): {
  journal?: AnyCodexIntegrationJournal;
  recoveryPending: boolean;
} {
  const primaryPath = getCodexJournalPath();
  const recoveryPath = getCodexJournalRecoveryPath();
  const primary = existsSync(primaryPath) ? parseJournal(primaryPath, readBoundedUtf8File(primaryPath)) : undefined;
  const recovery = existsSync(recoveryPath) ? parseJournal(recoveryPath, readBoundedUtf8File(recoveryPath)) : undefined;
  if (!primary && !recovery) return { recoveryPending: false };
  const identical = Boolean(primary && recovery && serializeJournal(primary) === serializeJournal(recovery));
  return { journal: primary ?? recovery, recoveryPending: !identical };
}

/**
 * Read the journal, optionally repairing its copies. Inspection callers must disable
 * repair so status, doctor, and model discovery remain observational. Hook recovery
 * remains separately gated by explicit reconciliation intent.
 */
export function readJournal(options: {
  reconcileInactiveHook?: boolean;
  repair?: boolean;
} = {}): AnyCodexIntegrationJournal | undefined {
  const repair = options.repair !== false;
  const primaryPath = getCodexJournalPath();
  const recoveryPath = getCodexJournalRecoveryPath();
  let primary: AnyCodexIntegrationJournal | undefined;
  let recovery: AnyCodexIntegrationJournal | undefined;
  let primaryError: unknown;
  let recoveryError: unknown;
  if (existsSync(primaryPath)) {
    try { primary = parseJournal(primaryPath); } catch (error) { primaryError = error; }
  }
  if (existsSync(recoveryPath)) {
    try { recovery = parseJournal(recoveryPath); } catch (error) { recoveryError = error; }
  }
  if (!primary && !recovery) {
    if (primaryError) throw primaryError;
    if (recoveryError) throw recoveryError;
    return undefined;
  }
  if (primary && recovery && serializeJournal(primary) === serializeJournal(recovery)) {
    return primary;
  }
  // A v2 uninstall marker is intent, while the older copy is the pre-uninstall commit.
  // Their common baseline is enough to select the marker even before config restoration.
  if (primary?.version === 2 && recovery?.version === 2
    && Boolean(primary.uninstalling) !== Boolean(recovery.uninstalling)) {
    const marked = primary.uninstalling ? primary : recovery;
    const unmarked = primary.uninstalling ? recovery : primary;
    const { uninstalling: _marker, ...baseline } = marked;
    if (serializeJournal(baseline as AnyCodexIntegrationJournal) === serializeJournal(unmarked)
      && journalMatchesConfig(marked)) {
      const data = serializeJournal(marked);
      if (repair) {
        writeFilesWithCompensation([
          { path: recoveryPath, data, expectedData: currentJournalBytes(recoveryPath) },
          { path: primaryPath, data, expectedData: currentJournalBytes(primaryPath) },
        ]);
      }
      return marked;
    }
  }
  // Only the recovery copy's inactive intent paired with the old active primary
  // proves an interrupted disconnect. Equal inactive copies cannot identify who
  // later restored an identical hook, so they never authorize removal.
  const pendingInactiveDisconnect = recovery?.version === 11 && !recovery.active
    && recovery.interruptHook.storage === "json"
    && primary?.version === 11 && primary.active
    && serializeJournal({ ...primary, active: false }) === serializeJournal(recovery);
  if (repair && recovery && !primaryError
    && (recovery.version !== 11 || recovery.active || recovery.interruptHook.storage !== "json"
      || (options.reconcileInactiveHook === true && pendingInactiveDisconnect))
    && recoverPendingJsonHookWrite(recovery, primary)) return recovery;
  if (primary && !recovery && !recoveryError) {
    if (repair) atomicWriteFile(recoveryPath, serializeJournal(primary));
    return primary;
  }
  if (recovery && !primary && !primaryError) {
    if (!journalMatchesConfig(recovery)) {
      throw new Error("Codex integration recovery journal does not match the active config");
    }
    if (repair) atomicWriteFile(primaryPath, serializeJournal(recovery));
    return recovery;
  }

  const primaryMatches = primary ? journalMatchesConfig(primary) : false;
  const recoveryMatches = recovery ? journalMatchesConfig(recovery) : false;
  if (primaryMatches === recoveryMatches) {
    throw new Error(
      primaryMatches
        ? "Codex integration journal copies contain different baselines for the same config"
        : "Codex integration journal copies do not match the active config",
    );
  }
  const selected = primaryMatches ? primary! : recovery!;
  const data = serializeJournal(selected);
  if (repair) {
    writeFilesWithCompensation([
      { path: recoveryPath, data, expectedData: currentJournalBytes(recoveryPath) },
      { path: primaryPath, data, expectedData: currentJournalBytes(primaryPath) },
    ]);
  }
  return selected;
}

export function assertJournalTargetsConfig(
  journal: AnyCodexIntegrationJournal,
  configPath: string,
): void {
  const pathIdentity = (value: string): string => {
    const normalized = resolve(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  if (pathIdentity(journal.configPath) !== pathIdentity(configPath)) {
    throw new Error(
      `Codex integration journal belongs to ${journal.configPath}, not the active config ${configPath}`,
    );
  }
  if (journal.version === 11 && journal.interruptHook.storage === "json"
    && pathIdentity(journal.interruptHook.hooksPath) !== pathIdentity(getCodexHooksPath())) {
    throw new Error(
      `Codex integration journal belongs to ${journal.interruptHook.hooksPath}, not the active hooks JSON ${getCodexHooksPath()}`,
    );
  }
}
