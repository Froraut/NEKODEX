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
  if (!value || typeof value !== "object") return false;
  const assignment = value as Record<string, unknown>;
  if (typeof assignment.present !== "boolean") return false;
  return !assignment.present
    || (typeof assignment.rawLine === "string" && typeof assignment.value === "string");
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
    && typeof installed.openai_base_url === "string"
    && installed.experimental_realtime_webrtc_call_base_url === CODEX_REALTIME_WEBRTC_CALL_BASE_URL
    && (installed.subagent_protocol === "compatibility-v1" || installed.subagent_protocol === "native")
    && (installed.subagent_protocol !== "compatibility-v1"
      || (value.previousMultiAgent && value.previousMultiAgentV2
        && value.previousAgentMaxDepth
        && typeof installed.agent_max_depth === "number"
        && Number.isSafeInteger(installed.agent_max_depth)
        && installed.agent_max_depth >= 2))
    && value.previous
    && isPreviousAssignment(value.previousRealtimeWebrtcCallBaseUrl)
    && isInstalledInterruptHookV11(value.interruptHook)
    && typeof value.configPath === "string") {
    return value as unknown as CodexIntegrationJournal;
  }
  if (value.version === 10
    && typeof value.active === "boolean"
    && installed
    && typeof installed.openai_base_url === "string"
    && installed.experimental_realtime_webrtc_call_base_url === CODEX_REALTIME_WEBRTC_CALL_BASE_URL
    && (installed.subagent_protocol === "compatibility-v1" || installed.subagent_protocol === "native")
    && (installed.subagent_protocol !== "compatibility-v1"
      || (value.previousMultiAgent && value.previousMultiAgentV2
        && value.previousAgentMaxDepth
        && typeof installed.agent_max_depth === "number"
        && Number.isSafeInteger(installed.agent_max_depth)
        && installed.agent_max_depth >= 2))
    && value.previous
    && isPreviousAssignment(value.previousRealtimeWebrtcCallBaseUrl)
    && isInstalledInterruptHook(value.interruptHook)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV10;
  }
  if (value.version === 9
    && typeof value.active === "boolean"
    && installed
    && typeof installed.openai_base_url === "string"
    && installed.experimental_realtime_webrtc_call_base_url === CODEX_REALTIME_WEBRTC_CALL_BASE_URL
    && (installed.subagent_protocol === "compatibility-v1" || installed.subagent_protocol === "native")
    && (installed.subagent_protocol !== "compatibility-v1"
      || (value.previousMultiAgent && value.previousMultiAgentV2
        && value.previousAgentMaxDepth
        && typeof installed.agent_max_depth === "number"
        && Number.isSafeInteger(installed.agent_max_depth)
        && installed.agent_max_depth >= 2))
    && value.previous
    && isPreviousAssignment(value.previousRealtimeWebrtcCallBaseUrl)
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV9;
  }
  if (value.version === 8
    && typeof value.active === "boolean"
    && installed
    && (installed.subagent_protocol === "compatibility-v1" || installed.subagent_protocol === "native")
    && (installed.subagent_protocol !== "compatibility-v1"
      || (value.previousMultiAgent && value.previousMultiAgentV2
        && value.previousAgentMaxDepth
        && typeof installed.agent_max_depth === "number"
        && Number.isSafeInteger(installed.agent_max_depth)
        && installed.agent_max_depth >= 2))
    && value.previous
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV8;
  }
  if (value.version === 7
    && typeof value.active === "boolean"
    && value.installed
    && value.previous
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV7;
  }
  if (value.version === 6
    && typeof value.active === "boolean"
    && value.installed
    && value.previous
    && value.previousRemoteCompactionV2
    && value.previousMultiAgent
    && value.previousMultiAgentV2
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV6;
  }
  if (value.version === 5
    && typeof value.active === "boolean"
    && value.installed
    && value.previous
    && value.previousRemoteCompactionV2
    && value.previousMultiAgent
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV5;
  }
  if (value.version === 4
    && typeof value.active === "boolean"
    && value.installed
    && value.previous
    && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV4;
  }
  if (value.version === 3 && value.installed && value.previous && typeof value.configPath === "string") {
    return value as unknown as LegacyCodexIntegrationJournalV3;
  }
  if (value.version === 2 && value.installed && value.previous && typeof value.providerBlock === "string"
    && (value.uninstalling === undefined || (value.uninstalling
      && typeof (value.uninstalling as Record<string, unknown>).restoredConfigSha256 === "string"
      && /^[a-f0-9]{64}$/.test((value.uninstalling as Record<string, unknown>).restoredConfigSha256 as string)))) {
    return value as unknown as LegacyCodexIntegrationJournal;
  }
  throw new Error(`Invalid Codex integration journal: ${path}`);
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
    { path: getCodexJournalPath(), data: serializeJournal(recovery) },
  ]);
  return true;
}

/** Inspect copies without invoking any journal, config or hooks recovery writes. */
export function readJournalSnapshot(options: { primaryPath?: string; recoveryPath?: string } = {}): {
  journal?: AnyCodexIntegrationJournal;
  recoveryPending: boolean;
} {
  const primaryPath = options.primaryPath ?? getCodexJournalPath();
  const recoveryPath = options.recoveryPath ?? getCodexJournalRecoveryPath();
  const primary = existsSync(primaryPath) ? parseJournal(primaryPath, readBoundedUtf8File(primaryPath)) : undefined;
  const recovery = existsSync(recoveryPath) ? parseJournal(recoveryPath, readBoundedUtf8File(recoveryPath)) : undefined;
  if (!primary && !recovery) return { recoveryPending: false };
  const identical = Boolean(primary && recovery && serializeJournal(primary) === serializeJournal(recovery));
  return { journal: primary ?? recovery, recoveryPending: !identical };
}

/** Repair journal copies on read. Hook removal requires explicit recovery intent and a pending transition. */
export function readJournal(options: { reconcileInactiveHook?: boolean } = {}): AnyCodexIntegrationJournal | undefined {
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
      writeFilesWithCompensation([
        { path: recoveryPath, data },
        { path: primaryPath, data },
      ]);
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
  if (recovery && !primaryError
    && (recovery.version !== 11 || recovery.active || recovery.interruptHook.storage !== "json"
      || (options.reconcileInactiveHook === true && pendingInactiveDisconnect))
    && recoverPendingJsonHookWrite(recovery, primary)) return recovery;
  if (primary && !recovery && !recoveryError) {
    atomicWriteFile(recoveryPath, serializeJournal(primary));
    return primary;
  }
  if (recovery && !primary && !primaryError) {
    if (!journalMatchesConfig(recovery)) {
      throw new Error("Codex integration recovery journal does not match the active config");
    }
    atomicWriteFile(primaryPath, serializeJournal(recovery));
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
  writeFilesWithCompensation([
    { path: recoveryPath, data },
    { path: primaryPath, data },
  ]);
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
