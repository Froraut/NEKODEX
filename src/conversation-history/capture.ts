import type { ConversationHistoryStore } from "./store";
import type { CaptureRecord, RecordResult } from "./types";

/** In-process proof supplied by an authenticated producer. This is deliberately
 * never derived from a request's metadata, prompt, parser context, or headers. */
export interface ValidatedHistoryTurn {
  clientId: string;
  threadId: string;
  turnId: string;
  authority: "authenticated-native-producer";
}
export interface ValidatedUserText {
  messageId: string;
  revisionId: string;
  revisionNumber: number;
  text: string;
  author: "human" | "agent" | "unknown";
  /** Caller checked the selected text; this is not automatic redaction. */
  sensitivity: "caller-validated";
}
/** Native response adapter for producers that possess real authenticated thread
 * identity AND an explicit text/sensitivity boundary. Transport/parser role alone
 * is insufficient. The HTTP bridge does not invent either proof. */
export function captureValidatedNativeResponse(store: ConversationHistoryStore, input: {
  identity: ValidatedHistoryTurn;
  userMessages: ValidatedUserText[];
  response: unknown;
  sensitivity: "caller-validated";
  timestamp: number;
}): RecordResult[] {
  if (input.identity.authority !== "authenticated-native-producer" || input.sensitivity !== "caller-validated") throw new Error("Validated native history authority required");
  const base = { clientId: input.identity.clientId, threadId: input.identity.threadId, turnId: input.identity.turnId,
    compactionId: null, timestamp: input.timestamp, source: "native", capturePolicy: "user-assistant-text-v1", sensitivity: "caller-validated",
    coverage: "partial", coverageReason: "validated-native-text-boundary-only" } as const;
  const results: RecordResult[] = [];
  for (const user of input.userMessages) {
    if (user.sensitivity !== "caller-validated") throw new Error("Validated user text required");
    results.push(store.record({ ...base, ...user, role: "user" }));
  }
  const response = input.response as { status?: unknown; output?: unknown[] } | null;
  if (!response || !Array.isArray(response.output)) return results;
  for (const candidate of response.output) {
    const item = candidate as { type?: unknown; role?: unknown; id?: unknown; content?: unknown[] } | null;
    if (!item || item.type !== "message" || item.role !== "assistant" || typeof item.id !== "string" || !Array.isArray(item.content)) continue;
    const parts = item.content.filter((part): part is {type:"output_text";text:string} => !!part && typeof part === "object"
      && (part as {type?:unknown}).type === "output_text" && typeof (part as {text?:unknown}).text === "string");
    if (!parts.length) continue;
    // IDs and revision identity come from the completed provider message. Streaming
    // partials are intentionally not stored as invented terminal revisions.
    if (response.status !== "completed") continue;
    results.push(store.record({ ...base, messageId: item.id, revisionId: item.id, revisionNumber: 1,
      role: "assistant", author: "assistant", text: parts.map(part => part.text).join("\n") } satisfies CaptureRecord));
  }
  return results;
}
