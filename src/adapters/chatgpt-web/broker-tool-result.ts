import type { CodexContentPart, CodexParsedRequest, CodexToolResultMessage } from "../../types";
import { parseDataUrl } from "../image";
import type { BrokerToolResult } from "./turn-broker-protocol";

function structuredContent(text: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function brokerContent(content: string | CodexContentPart[]): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map(part => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "file") return {
      type: "resource",
      resource: {
        uri: `nekodex-file:sha256:${part.sha256}`,
        name: part.name,
        mimeType: part.mimeType,
        blob: part.base64,
      },
    };
    const parsed = parseDataUrl(part.imageUrl);
    if (parsed) return { type: "image", data: parsed.base64, mimeType: parsed.mediaType };
    return { type: "resource_link", uri: part.imageUrl, name: "Codex tool image", mimeType: "image/*" };
  });
}

/** The MCP broker payload for one Codex tool result, shared by ordinary rounds and active compaction. */
export function brokerToolResult(message: CodexToolResultMessage): BrokerToolResult {
  const content = brokerContent(message.content);
  const text = typeof message.content === "string"
    ? message.content
    : message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  const structured = structuredContent(text);
  return {
    content,
    ...(structured !== undefined ? { structuredContent: structured } : {}),
    ...(message.isError ? { isError: true } : {}),
  };
}

/** Codex results for the session's outstanding calls, keyed by call id in message order. */
export function currentToolResults(
  parsed: CodexParsedRequest,
  session: { hasOutstanding(callId: string): boolean },
): Map<string, CodexToolResultMessage> {
  const results = new Map<string, CodexToolResultMessage>();
  for (const message of parsed.context.messages) {
    if (message.role !== "toolResult" || !session.hasOutstanding(message.toolCallId)) continue;
    if (results.has(message.toolCallId)) {
      throw new Error(`Codex returned duplicate results for tool call ${message.toolCallId}`);
    }
    results.set(message.toolCallId, message);
  }
  return results;
}
