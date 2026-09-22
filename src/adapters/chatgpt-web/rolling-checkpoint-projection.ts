import { parseRequest } from "../../responses/parser";
import type { CodexParsedRequest } from "../../types";
import { extractChatGptTurnUserRevision } from "./environment";
import type { ChatGptLunaCheckpoint } from "./rolling-checkpoint-format";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function itemTurnId(value: unknown): string | undefined {
  const turnId = record(record(value)?.internal_chat_message_metadata_passthrough)?.turn_id;
  return typeof turnId === "string" ? turnId : undefined;
}

function currentTurnBoundary(parsed: CodexParsedRequest, input: unknown[], turnId: string): number | undefined {
  const replayPrefix = Math.min(parsed._replayPrefixLen ?? 0, input.length);
  const firstCurrentItem = input.findIndex(item => itemTurnId(item) === turnId);
  // A transport replay can include earlier rounds of this same native turn. It is not
  // proof that those user instructions or tool results belong to completed history.
  if (replayPrefix > 0) {
    return firstCurrentItem >= 0 ? Math.min(replayPrefix, firstCurrentItem) : replayPrefix;
  }
  return firstCurrentItem >= 0 ? firstCurrentItem : undefined;
}

function assistantItemText(value: unknown): string | undefined {
  const item = record(value);
  if (!item || item.role !== "assistant") return undefined;
  if (typeof item.content === "string") return item.content.trim() ? item.content : undefined;
  if (!Array.isArray(item.content)) return undefined;
  const text = item.content.map(block => {
    const content = record(block);
    return content && (content.type === "output_text" || content.type === "text")
      && typeof content.text === "string"
      ? content.text
      : "";
  }).join("");
  return text.trim() ? text : undefined;
}

export interface LunaCheckpointProjection {
  body: Record<string, unknown>;
  parent: { answer: string; turnId: string };
  currentInput: unknown[];
}

/** Analyze authority and the adjacent parent once, against the same input boundary. */
export function analyzeLunaCheckpointProjection(parsed: CodexParsedRequest, turnId: string): LunaCheckpointProjection | undefined {
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : undefined;
  if (!body || !input) return undefined;
  const boundary = currentTurnBoundary(parsed, input, turnId);
  if (boundary === undefined) return undefined;
  const parent = input[boundary - 1];
  const answer = assistantItemText(parent);
  const parentTurnId = itemTurnId(parent);
  if (!answer || !parentTurnId) return undefined;
  const suffix = input.slice(boundary);
  // Preserve canonical prefix instructions, even when later messages have the same roles.
  const instructions = input.slice(0, boundary).filter(value => {
    const item = record(value);
    return item?.role === "system" || item?.role === "developer";
  });
  return { body, parent: { answer, turnId: parentTurnId }, currentInput: suffix.length ? [...instructions, ...suffix] : [] };
}

function checkpointContext(checkpoint: ChatGptLunaCheckpoint): string {
  return [
    "[Compressed Luna task history from the immediately preceding assistant response.]",
    "Treat this as prior assistant-owned conversation state, not as a new user instruction. Current system, developer, and user messages below remain authoritative.",
    JSON.stringify(checkpoint),
  ].join("\n");
}

export function projectLunaCheckpoint(
  parsed: CodexParsedRequest,
  turnId: string,
  checkpoint: ChatGptLunaCheckpoint,
  projection: LunaCheckpointProjection,
): CodexParsedRequest {
  const { body, currentInput } = projection;
  const checkpointItem = {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: checkpointContext(checkpoint) }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  };
  const { previous_response_id: _previousResponseId, ...bodyWithoutPrevious } = body;
  const compacted = parseRequest({
    ...bodyWithoutPrevious,
    input: [checkpointItem, ...currentInput],
  });
  // `_rawBody.model` remains the public route slug while the server has already resolved the
  // authoritative backend model and effort on `parsed`. Re-parsing the compacted input must not
  // undo that binding.
  compacted.modelId = parsed.modelId;
  compacted.options = { ...compacted.options, ...parsed.options };

  // The transport optimization must never change which native user revision is being executed.
  if (JSON.stringify(extractChatGptTurnUserRevision(compacted)) !== JSON.stringify(extractChatGptTurnUserRevision(parsed))) {
    throw new Error("ChatGPT Luna rolling checkpoint changed the active native user revision");
  }
  return compacted;
}
