import { isAbsolute, relative, resolve } from "node:path";
import { isReadableCompactionSummaryText, OPAQUE_COMPACTION_NOTE } from "../../responses/compaction";
import type { CodexParsedRequest } from "../../types";
import {
  extractChatGptTurnEnvironment,
  extractChatGptCompactionSourceRevision,
  extractChatGptContinuationEnvironmentClaim,
  extractChatGptSteeringEnvironmentClaim,
  extractChatGptTrailingEnvironmentDeltaClaim,
  extractChatGptTurnIdentity,
  extractChatGptThreadSpawnLineage,
  extractChatGptRootThreadMetadata,
  hasCurrentChatGptEnvironmentContext,
  hasRawChatGptEnvironmentContext,
  unattributedChatGptEnvironmentMessages,
  isChatGptCompactionContinuation,
  MissingTrustedCodexEnvironmentError,
  type ChatGptTurnEnvironment,
} from "./environment";
import type { resolveCurrentCodexRolloutEnvironment } from "./codex-rollout-environment";

export interface ThreadEnvironmentResolution {
  environment: ChatGptTurnEnvironment;
  persistForThreadId?: string;
}

export interface ThreadEnvironmentResolverDependencies {
  readCache(threadId: string): Omit<ChatGptTurnEnvironment, "tools" | "producer"> | undefined;
  resolveRollout(options: Omit<Parameters<typeof resolveCurrentCodexRolloutEnvironment>[0], "codexHome" | "sqliteHome">): ChatGptTurnEnvironment | undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function itemTurnId(value: unknown): string | undefined {
  const turnId = record(record(value)?.internal_chat_message_metadata_passthrough)?.turn_id;
  return typeof turnId === "string" ? turnId : undefined;
}

function messageText(item: Record<string, unknown>): string {
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .map(part => record(part)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function messageHoldsEnvironmentEnvelope(item: Record<string, unknown>): boolean {
  if (item.type !== "message" || item.role !== "user" || !Array.isArray(item.content)) return false;
  const environmentParts = item.content.flatMap(part => {
    const text = record(part)?.text;
    return typeof text === "string" && /<\/?environment_context\b/i.test(text) ? [text.trim()] : [];
  });
  return environmentParts.length === 1
    && /^<environment_context>[\s\S]*<\/environment_context>$/.test(environmentParts[0]!);
}

function isCompactionSummaryMessage(item: Record<string, unknown>): boolean {
  if (item.type !== "message" || item.role !== "user") return false;
  const text = messageText(item).trim();
  return isReadableCompactionSummaryText(text) || text === OPAQUE_COMPACTION_NOTE;
}

function skippedMessageHasBoundedShape(item: Record<string, unknown>, turnId: string): boolean {
  const owner = itemTurnId(item);
  // An untagged item ID is only a structural bound for the observed Codex wire shape. It grants no
  // authority: resolve() accepts the projection only after matching the current native rollout.
  return owner === undefined
    ? typeof item.id === "string" && item.id.length > 0
    : owner === turnId;
}

/**
 * Codex 0.155 can place its summary between the current environment envelope and instruction, or
 * make that summary the final input item. Build only the adjacency projection consumed by the
 * existing trusted-environment parser; metadata and sandbox validation remain unchanged there.
 */
function environmentRequestAcrossCompactionSummary(parsed: CodexParsedRequest): CodexParsedRequest | undefined {
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : undefined;
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  if (!body || !input || !turnId) return undefined;

  const envelopeIndexes = input.flatMap((value, index) => {
    const item = record(value);
    return item && messageHoldsEnvironmentEnvelope(item) ? [index] : [];
  });
  if (envelopeIndexes.length !== 1) return undefined;
  const envelopeIndex = envelopeIndexes[0]!;
  const envelope = record(input[envelopeIndex]);
  if (!envelope || typeof envelope.id !== "string" || !envelope.id
    || (itemTurnId(envelope) !== undefined && itemTurnId(envelope) !== turnId)) return undefined;

  let activeInstructionIndex = -1;
  let sawSummary = false;
  let lastSummary: Record<string, unknown> | undefined;
  for (let index = input.length - 1; index > envelopeIndex; index -= 1) {
    const item = record(input[index]);
    if (!item || item.type !== "message") return undefined;
    if (isCompactionSummaryMessage(item)) {
      if (!skippedMessageHasBoundedShape(item, turnId)) return undefined;
      sawSummary = true;
      lastSummary ??= item;
      continue;
    }
    if (item.role === "developer") {
      if (!skippedMessageHasBoundedShape(item, turnId)) return undefined;
      continue;
    }
    if (item.role === "user") {
      if (activeInstructionIndex >= 0) return undefined;
      activeInstructionIndex = index;
      continue;
    }
    return undefined;
  }
  if (!sawSummary) return undefined;

  const normalized = input.filter((value, index) => {
    if (index <= envelopeIndex || (activeInstructionIndex >= 0 && index >= activeInstructionIndex)) return true;
    const item = record(value);
    return !item || !isCompactionSummaryMessage(item);
  });
  if (activeInstructionIndex < 0) {
    if (!lastSummary) return undefined;
    normalized.push({
      ...lastSummary,
      role: "user",
      content: [{ type: "input_text", text: "Continue after the native compaction summary." }],
    });
  }
  return { ...parsed, _rawBody: { ...body, input: normalized } };
}

export function pathIdentity(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function contains(root: string, path: string): boolean {
  const rel = relative(pathIdentity(root), pathIdentity(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function sameAuthority(left: ChatGptTurnEnvironment, right: ChatGptTurnEnvironment): boolean {
  const samePaths = (a: string[], b: string[]): boolean => {
    const expected = new Set(b.map(pathIdentity));
    return a.length === expected.size && a.every(path => expected.has(pathIdentity(path)));
  };
  return pathIdentity(left.cwd) === pathIdentity(right.cwd)
    && samePaths(left.roots, right.roots)
    && samePaths(left.writableRoots, right.writableRoots)
    && left.sandboxPolicy.type === right.sandboxPolicy.type
    && (left.sandboxPolicy.type === "dangerFullAccess" || (right.sandboxPolicy.type !== "dangerFullAccess"
      && left.sandboxPolicy.networkAccess === right.sandboxPolicy.networkAccess));
}

export function resolveThreadEnvironment(
  parsed: CodexParsedRequest, dependencies: ThreadEnvironmentResolverDependencies,
): ThreadEnvironmentResolution {
  // Hermes owns execution and approvals. The bridge itself receives no filesystem authority,
  // and its producer scope never enters the persistent native Codex environment cache.
  if (parsed._hermesContext) return { environment: {
    producer: "hermes",
    cwd: parsed._hermesContext.root, roots: [parsed._hermesContext.root], writableRoots: [],
    sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: parsed.context.tools ?? [],
  } };
  const identity = extractChatGptTurnIdentity(parsed);
  try {
    const environment = extractChatGptTurnEnvironment(parsed);
    return { environment, ...(identity.threadId ? { persistForThreadId: identity.threadId } : {}) };
  } catch (error) {
    if (!(error instanceof MissingTrustedCodexEnvironmentError) || !identity.threadId) throw error;
    const trailingDelta = extractChatGptTrailingEnvironmentDeltaClaim(parsed);
    if (trailingDelta) {
      const rolloutIdentity = extractChatGptThreadSpawnLineage(parsed) ?? extractChatGptRootThreadMetadata(parsed);
      if (!rolloutIdentity || rolloutIdentity.threadId !== trailingDelta.threadId
        || identity.turnId !== trailingDelta.turnId) throw error;
      const nativeEnvironment = dependencies.resolveRollout({
        lineage: rolloutIdentity,
        turnId: trailingDelta.turnId,
        tools: parsed.context.tools,
      });
      if (!nativeEnvironment) throw error;
      if (trailingDelta.sandboxType !== nativeEnvironment.sandboxPolicy.type
        || (nativeEnvironment.sandboxPolicy.type === "dangerFullAccess"
          ? trailingDelta.networkAccess !== undefined
          : trailingDelta.networkAccess === undefined
            || trailingDelta.networkAccess !== nativeEnvironment.sandboxPolicy.networkAccess)) {
        throw new Error("Trailing environment delta conflicts with its current Codex rollout");
      }
      return { environment: nativeEnvironment, persistForThreadId: identity.threadId };
    }
    const compactedRequest = environmentRequestAcrossCompactionSummary(parsed);
    if (compactedRequest) {
      const claim = extractChatGptTurnEnvironment(compactedRequest);
      const rolloutIdentity = extractChatGptThreadSpawnLineage(parsed) ?? extractChatGptRootThreadMetadata(parsed);
      const nativeEnvironment = rolloutIdentity && identity.turnId
        ? dependencies.resolveRollout({
          lineage: rolloutIdentity,
          turnId: identity.turnId,
          tools: parsed.context.tools,
        })
        : undefined;
      if (!nativeEnvironment) throw error;
      if (!sameAuthority(claim, nativeEnvironment)) {
        throw new Error("Compacted environment conflicts with its current Codex rollout");
      }
      return { environment: nativeEnvironment, persistForThreadId: identity.threadId };
    }
    const hasCurrentContext = hasCurrentChatGptEnvironmentContext(parsed);
    const lineage = extractChatGptThreadSpawnLineage(parsed);
    const currentCompaction = hasCurrentContext && isChatGptCompactionContinuation(parsed);
    const historicalMessages = hasCurrentContext && !currentCompaction && lineage
      ? unattributedChatGptEnvironmentMessages(parsed) : undefined;
    const steeringClaim = hasCurrentContext && !currentCompaction
      ? extractChatGptSteeringEnvironmentClaim(parsed) : undefined;
    if (hasCurrentContext && !currentCompaction && !historicalMessages && !steeringClaim) throw error;
    const currentClaim = currentCompaction ? extractChatGptContinuationEnvironmentClaim(parsed) : steeringClaim;
    const rolloutIdentity = lineage ?? extractChatGptRootThreadMetadata(parsed);
    // Automatic compaction has a current turn_context; standalone compaction has only its
    // source turn_context. Either must be the latest native record, never an arbitrary ancestor.
    const compactionSourceTurnId = parsed._compactionRequest
      ? extractChatGptCompactionSourceRevision(parsed).turnId : undefined;
    if (rolloutIdentity && identity.turnId) {
      const rolloutEnvironment = dependencies.resolveRollout({
        lineage: rolloutIdentity,
        turnId: identity.turnId,
        ...(compactionSourceTurnId ? { compactionSourceTurnId } : {}),
        ...(historicalMessages ? { historicalEnvironmentMessages: historicalMessages } : {}),
        tools: parsed.context.tools,
      });
      if (rolloutEnvironment) {
        if (currentClaim && !sameAuthority(currentClaim, rolloutEnvironment)) {
          throw new Error(`${currentCompaction ? "Compaction continuation" : "Steering"} environment conflicts with its current Codex rollout`);
        }
        return { environment: rolloutEnvironment, persistForThreadId: rolloutIdentity.threadId };
      }
    }
    // History may reuse this thread's earned authority, but never masks a current invalid
    // update or authorizes inheritance from a different thread (#567).
    const hasRawContext = hasRawChatGptEnvironmentContext(parsed);
    if (hasRawContext && hasCurrentContext) throw error;
    const sameThread = dependencies.readCache(identity.threadId);
    if (sameThread) return { environment: {
      cwd: sameThread.cwd,
      roots: sameThread.roots,
      writableRoots: sameThread.writableRoots,
      sandboxPolicy: sameThread.sandboxPolicy,
      tools: parsed.context.tools ?? [],
    } };

    if (hasRawContext || !lineage) throw error;
    const parent = dependencies.readCache(lineage.parentThreadId);
    if (!parent) throw error;
    if (lineage.sandboxType !== parent.sandboxPolicy.type) {
      throw new Error("ChatGPT Web subagent sandbox metadata conflicts with its trusted parent thread");
    }
    if (lineage.workspaceRoots.length > 0 && !lineage.workspaceRoots.some(root => contains(root, parent.cwd))) {
      throw new Error("ChatGPT Web subagent workspace metadata does not contain its trusted parent cwd");
    }
    if (lineage.workspaceRoots.some(root => !parent.roots.some(parentRoot => (
      contains(parentRoot, root) || contains(root, parentRoot)
    )))) {
      throw new Error("ChatGPT Web subagent workspace metadata conflicts with its trusted parent roots");
    }
    const inherited: ChatGptTurnEnvironment = {
      cwd: parent.cwd,
      roots: parent.roots,
      writableRoots: parent.writableRoots,
      sandboxPolicy: parent.sandboxPolicy,
      tools: parsed.context.tools ?? [],
    };
    return { environment: inherited, persistForThreadId: lineage.threadId };
  }
}
