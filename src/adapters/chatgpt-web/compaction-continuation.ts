import { createHash } from "node:crypto";
import { decodeCompactionSummary, isReadableCompactionSummaryText, SUMMARY_PREFIX } from "../../responses/compaction";
import type { CodexParsedRequest } from "../../types";
import type { ChatGptTurnIdentity, ChatGptTurnUserRevision } from "./environment";

interface CompletedCheckpoint {
  summaryHash: string;
  sourceHashes: ReadonlySet<string>;
  source?: ChatGptTurnUserRevision;
  sourceBytes: number;
}

// Evidence of a checkpoint actually returned by this daemon, not authority inferred from text
// that happens to look like a summary. A new process must not invent a missing handoff.
const MAX_CHECKPOINTS = 256;
const MAX_SOURCE_HASHES = 2; // Original and bounded-v1 producer representations.
export const MAX_COMPACTION_SOURCE_BYTES = 1024 * 1024;
export const MAX_COMPACTION_RETAINED_SOURCE_BYTES = 8 * 1024 * 1024;

function scope(parsed: CodexParsedRequest, identity: ChatGptTurnIdentity): string | undefined {
  if (!identity.threadId || !identity.turnId) return undefined;
  return JSON.stringify([identity.threadId, identity.turnId, parsed.modelId, parsed.options.reasoning,
    parsed._chatgptModelFamily]);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceDigest(source: ChatGptTurnUserRevision): string {
  return digest([source.turnId, source.content]);
}

function pureContextAfterSummary(item: Record<string, unknown>): boolean {
  if (item.type !== "message" || item.role !== "user") return false;
  const parts = typeof item.content === "string" ? [item.content]
    : Array.isArray(item.content) ? item.content.map(part => (
      part && typeof part === "object" && !Array.isArray(part) ? (part as { text?: unknown }).text : undefined
    )) : [];
  return parts.length > 0 && parts.every(part => typeof part === "string" && (
    /^<environment_context>[\s\S]*<\/environment_context>$/.test(part.trim())
    || /^<subagent_notification>[\s\S]*<\/subagent_notification>$/.test(part.trim())
    || /^<recommended_plugins>[\s\S]*<\/recommended_plugins>$/.test(part.trim())
    || /^# AGENTS\.md instructions\s*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>$/.test(part.trim())
    || /^<app-context>[\s\S]*<\/app-context>$/.test(part.trim())
  ));
}

/** Isolated registry for focused byte-boundary checks; the exported facade remains process-local. */
export function createCompactionContinuationRegistry() {
  const checkpoints = new Map<string, CompletedCheckpoint>();
  let retainedSourceBytes = 0;

  function discardSource(checkpoint: CompletedCheckpoint): void {
    retainedSourceBytes -= checkpoint.sourceBytes;
    checkpoint.source = undefined;
    checkpoint.sourceBytes = 0;
  }

  function reserveSource(bytes: number): void {
    for (const checkpoint of checkpoints.values()) {
      if (retainedSourceBytes + bytes <= MAX_COMPACTION_RETAINED_SOURCE_BYTES) break;
      if (checkpoint.source) discardSource(checkpoint);
    }
  }

  function rememberCompactionContinuation(
    parsed: CodexParsedRequest,
    identity: ChatGptTurnIdentity,
    sources: readonly ChatGptTurnUserRevision[],
    summary: string,
  ): void {
    const key = scope(parsed, identity);
    if (!key || !parsed._compactionRequest || !summary || !sources[0]) return;
    const previous = checkpoints.get(key);
    if (previous) discardSource(previous);
    checkpoints.delete(key);
    const checkpoint: CompletedCheckpoint = {
      summaryHash: digest(summary), sourceHashes: new Set(sources.slice(0, MAX_SOURCE_HASHES).map(sourceDigest)),
      sourceBytes: 0,
    };
    const serialized = JSON.stringify(sources[0]);
    const bytes = Buffer.byteLength(serialized, "utf8") + 64;
    if (bytes <= MAX_COMPACTION_SOURCE_BYTES) {
      reserveSource(bytes);
      checkpoint.source = JSON.parse(serialized) as ChatGptTurnUserRevision;
      checkpoint.sourceBytes = bytes;
      retainedSourceBytes += bytes;
    }
    checkpoints.set(key, checkpoint);
    while (checkpoints.size > MAX_CHECKPOINTS) {
      const oldest = checkpoints.keys().next().value!;
      discardSource(checkpoints.get(oldest)!);
      checkpoints.delete(oldest);
    }
  }

  function isAcceptedCompactionContinuation(
    parsed: CodexParsedRequest,
    identity: ChatGptTurnIdentity,
    source: ChatGptTurnUserRevision,
  ): boolean {
    return acceptedCheckpoint(parsed, identity)?.checkpoint.sourceHashes.has(sourceDigest(source)) === true;
  }

  /** Recover an instruction from this daemon's completed handoff only. */
  function recoverCompactionInstruction(
    parsed: CodexParsedRequest,
    identity: ChatGptTurnIdentity,
  ): { source: ChatGptTurnUserRevision; summaryIndex: number } | undefined {
    const accepted = acceptedCheckpoint(parsed, identity);
    return accepted?.checkpoint.source
      ? { source: structuredClone(accepted.checkpoint.source), summaryIndex: accepted.summaryIndex }
      : undefined;
  }

  function acceptedCheckpoint(
    parsed: CodexParsedRequest,
    identity: ChatGptTurnIdentity,
  ): { checkpoint: CompletedCheckpoint; summaryIndex: number } | undefined {
    const key = scope(parsed, identity);
    const checkpoint = key ? checkpoints.get(key) : undefined;
    if (!key || !checkpoint) return undefined;
    const input = (parsed._rawBody as { input?: unknown[] } | undefined)?.input;
    if (!Array.isArray(input)) return undefined;
    for (let index = input.length - 1; index >= 0; index -= 1) {
      const item = input[index] as Record<string, unknown> | null;
      if (!item || typeof item !== "object") continue;
      let summary: string | null;
      if (["compaction", "compaction_summary", "context_compaction"].includes(String(item.type))) {
        summary = typeof item.encrypted_content === "string" ? decodeCompactionSummary(item.encrypted_content) : null;
      } else {
        if (item.type === "agent_message") return undefined;
        if (item.type !== "message" || item.role !== "user") continue;
        const text = typeof item.content === "string" ? item.content : Array.isArray(item.content)
          ? item.content.map(part => part?.text ?? "").join("\n") : "";
        if (!isReadableCompactionSummaryText(text)) {
          if (pureContextAfterSummary(item)) continue;
          return undefined;
        }
        summary = text.slice(SUMMARY_PREFIX.length + 1);
      }
      const owner = (item.internal_chat_message_metadata_passthrough as { turn_id?: unknown } | undefined)?.turn_id;
      if (owner !== undefined && owner !== identity.turnId) return undefined;
      return summary !== null && acceptsSummary(key, checkpoint, summary)
        ? { checkpoint, summaryIndex: index } : undefined;
    }
    return undefined;
  }

  function acceptsSummary(key: string, checkpoint: CompletedCheckpoint, summary: string): boolean {
    if (digest(summary) !== checkpoint.summaryHash) return false;
    // A long-running continuation does not become invalid merely because time passed. Memory
    // pressure may shed source payloads, but the bounded hash proof stays valid until eviction.
    checkpoints.delete(key);
    checkpoints.set(key, checkpoint);
    return true;
  }

  return { rememberCompactionContinuation, isAcceptedCompactionContinuation, recoverCompactionInstruction };
}

export const {
  rememberCompactionContinuation,
  isAcceptedCompactionContinuation,
  recoverCompactionInstruction,
} = createCompactionContinuationRegistry();
