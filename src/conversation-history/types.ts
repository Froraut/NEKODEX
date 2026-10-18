/** Only caller-validated user/assistant text belongs here. Never pass credentials,
 * system/developer instructions, tool calls, or raw tool output. Role filtering
 * alone does not validate/redact text; this store performs no secret detection. */
export interface CaptureRecord extends MessageIdentity {
  revisionId: string;
  revisionNumber: number;
  turnId: string | null;
  compactionId: string | null;
  role: "user" | "assistant";
  author: "human" | "assistant" | "agent" | "unknown";
  source: "responses" | "native" | "chatgpt-web" | "manual-import" | "unknown";
  text: string;
  timestamp: number;
  /** Describes this message's text only, never the entire thread or transcript. */
  coverage: "complete" | "partial";
  coverageReason?: string;
  capturePolicy: "user-assistant-text-v1";
  /** Caller assertion, not a redaction claim. Unknown sensitivity retains metadata only. */
  sensitivity: "caller-validated" | "unknown";
}

export interface ThreadIdentity { clientId: string; threadId: string }
export interface MessageIdentity extends ThreadIdentity { messageId: string }
export interface HistoryMessage extends Omit<CaptureRecord, "text" | "coverage"> {
  text: string | null;
  coverage: "complete" | "partial" | "rejected";
  originalBytes: number;
  link: string;
}
export interface HistoryStatus {
  recordingEnabled: boolean;
  quotaReached: boolean;
  quotaRejected: number;
  /** Logical serialized revision bytes; not physical SQLite/FTS file size. */
  storedBytes: number;
  maxStoredBytes: number;
  maxMessageBytes: number;
  totalMessages: number;
  indexedMessages: number;
  incompleteMessages: number;
  revisions: number;
  captureScope: "caller-validated-user-assistant-text";
  transcriptCoverage: "unknown";
}
export interface HistoryPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  coverage: Pick<HistoryStatus, "totalMessages" | "indexedMessages" | "incompleteMessages" | "transcriptCoverage">;
}
export interface HistoryThread extends ThreadIdentity {
  messages: number;
  incompleteMessages: number;
  updatedAt: number;
}
export interface HistoryPageOptions { limit?: number; offset?: number }
export interface HistorySearch extends HistoryPageOptions {
  query: string;
  clientId?: string;
  threadId?: string;
}
export type RecordResult =
  | { outcome: "disabled" | "quota-reached" }
  | { outcome: "recorded" | "duplicate" | "rejected"; latest: boolean; message: HistoryMessage };
export interface HistoryMarkdownExport {
  markdown: string;
  exportedMessages: number;
  totalMessages: number;
  incompleteMessages: number;
  partial: boolean;
  hasMore: boolean;
}
