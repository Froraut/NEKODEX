import { markVerifiedParentMessage } from "./verified-parent-message";
import type { CodexParsedRequest } from "../../types";
import { getCodexHome } from "../../codex-integration-shared";
import { contextualUserMessage, extractChatGptThreadSpawnLineage, extractChatGptTurnIdentity } from "./environment";
import { verifyNativeDelegation } from "./codex-rollout-environment";

function decodeDelegationXml(text: string): string {
  const entities: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_, entity: string) => entities[entity]!);
}

export function normalizeNativeDelegation(parsed: CodexParsedRequest,
  verify = verifyNativeDelegation, codexHome = getCodexHome()): unknown | undefined {
  const body = parsed._rawBody as { input?: Array<Record<string, unknown>> } | undefined;
  if (!Array.isArray(body?.input) || parsed._compactionRequest) return undefined;
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.threadId || !identity.turnId) return undefined;
  const input = body.input;
  const lineage = extractChatGptThreadSpawnLineage(parsed);
  // A later ordinary human instruction supersedes a delivery. Never promote an
  // old delivery from history or a tool's quotation of the envelope.
  for (let index = input.length - 1; index >= 0; index--) {
    const item = input[index]!;
    if (item.type === "message" && item.role === "user") {
      if (lineage && contextualUserMessage(item)) continue;
      return undefined;
    }
    if (lineage && item.type === "agent_message") return undefined;
    if (item.type !== "function_call_output" || item.namespace !== "codex_app"
      || item.name !== "send_message_to_thread" || typeof item.id !== "string"
      || typeof item.output !== "string") continue;
    const provenance = item.internal_chat_message_metadata_passthrough as { turn_id?: string } | undefined;
    if (provenance?.turn_id !== identity.turnId) return undefined;
    const envelope = /^<codex_delegation>\s*<source_thread_id>([0-9a-f-]{36})<\/source_thread_id>\s*<input>([\s\S]+)<\/input>\s*<\/codex_delegation>\s*$/i.exec(item.output);
    if (!envelope || envelope[1] === identity.threadId) return undefined;
    if (lineage && (envelope[1] !== lineage.parentThreadId
      || typeof item.call_id !== "string" || !item.call_id || !item.id)) {
      throw new Error("Subagent instruction does not identify its direct parent and tool call");
    }
    if (!verify(codexHome, identity.threadId, identity.turnId, item, lineage)) {
      throw new Error("Cross-task instruction does not match the native current-turn delivery");
    }
    const text = decodeDelegationXml(envelope[2]!);
    if (lineage) {
      const message = markVerifiedParentMessage({
        type: "agent_message", id: item.id,
        author: lineage.parentThreadId, recipient: lineage.threadId,
        content: [{ type: "input_text", text }],
        internal_chat_message_metadata_passthrough: item.internal_chat_message_metadata_passthrough,
      });
      return { ...body, input: input.map((value, i) => i === index ? message : value) };
    }
    return { ...body, input: input.map((value, i) => i === index ? {
      type: "message", role: "user", id: item.id,
      content: [{ type: "input_text", text }],
      internal_chat_message_metadata_passthrough: item.internal_chat_message_metadata_passthrough,
    } : value) };
  }
  return undefined;
}
