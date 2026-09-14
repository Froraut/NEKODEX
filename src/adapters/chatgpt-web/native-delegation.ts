import type { CodexParsedRequest } from "../../types";
import { getCodexHome } from "../../codex-integration-shared";
import { extractChatGptTurnIdentity } from "./environment";
import { verifyNativeDelegation } from "./codex-rollout-environment";

export function normalizeNativeDelegation(parsed: CodexParsedRequest,
  verify = verifyNativeDelegation, codexHome = getCodexHome()): unknown | undefined {
  const body = parsed._rawBody as { input?: Array<Record<string, unknown>> } | undefined;
  if (!Array.isArray(body?.input) || parsed._compactionRequest) return undefined;
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.threadId || !identity.turnId) return undefined;
  const input = body.input;
  // A later ordinary human instruction supersedes a delivery. Never promote an
  // old delivery from history or a tool's quotation of the envelope.
  for (let index = input.length - 1; index >= 0; index--) {
    const item = input[index]!;
    if (item.type === "message" && item.role === "user") return undefined;
    if (item.type !== "function_call_output" || item.namespace !== "codex_app"
      || item.name !== "send_message_to_thread" || typeof item.id !== "string"
      || typeof item.output !== "string") continue;
    const provenance = item.internal_chat_message_metadata_passthrough as { turn_id?: string } | undefined;
    if (provenance?.turn_id !== identity.turnId) return undefined;
    const envelope = /^<codex_delegation>\s*<source_thread_id>([0-9a-f-]{36})<\/source_thread_id>\s*<input>([\s\S]+)<\/input>\s*<\/codex_delegation>\s*$/i.exec(item.output);
    if (!envelope || envelope[1] === identity.threadId) return undefined;
    if (!verify(codexHome, identity.threadId, identity.turnId, item)) {
      throw new Error("Cross-task instruction does not match the native current-turn delivery");
    }
    return { ...body, input: input.map((value, i) => i === index ? {
      type: "message", role: "user", id: item.id,
      content: [{ type: "input_text", text: envelope[2] }],
      internal_chat_message_metadata_passthrough: item.internal_chat_message_metadata_passthrough,
    } : value) };
  }
  return undefined;
}
