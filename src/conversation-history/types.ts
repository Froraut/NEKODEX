/** Manual selections require caller validation. Canonical text requires the
 * selected-thread consent + known-pattern policy; it is not certified secret-free.
 * Never pass structured system/developer/tool payloads. Canonical role filtering
 * alone is not secret redaction; unfamiliar secrets can remain after pattern checks. */
export interface CaptureRecord extends MessageIdentity {
  revisionId: string;
  revisionNumber: number;
  turnId: string | null;
  compactionId: string | null;
  role: "user" | "assistant";
  author: "human" | "assistant" | "agent" | "automatic-host" | "unknown";
  source: "responses" | "native" | "chatgpt-web" | "manual-import" | "unknown";
  text: string;
  timestamp: number;
  /** Describes this message's text only, never the entire thread or transcript. */
  coverage: "complete" | "partial";
  coverageReason?: string;
  capturePolicy: "user-assistant-text-v1" | "canonical-thread-text-v1" | "owned-native-final-summary-v1" | "canonical-events-v1" | "owned-conversation-text-v1";
  /** Caller assertion, not a redaction claim. Unknown sensitivity retains metadata only. */
  sensitivity: "caller-validated" | "unknown" | "known-pattern-filtered";
  canonical?: {policyVersion:"known-pattern-filter-v1";fingerprint:string;observedAt:number;timestampSource:"native"|"observed-at";originalBytes:number;exclusionReason:string|null;sourceCoverage:"complete"|"partial"};
  ownedNative?: OwnedNativeHistoryMetadata;
  transcript?: TranscriptHistoryMetadata;
  ownedConversation?: OwnedConversationHistoryMetadata;
}

/** Main-admitted source identity, never renderer-supplied account proof. */
export interface OwnedNativeHistoryScope {
  taskId: string; generation: number; sourceId: string; profileId: string;
  backendAccountId: string; authEpoch: string;
}
export interface OwnedNativeHistoryProvenance {
  dispatchId: string; workerBindingId: string; workerGeneration: number;
  nativeTurnReceiptId: string; messageId: string; turnId: string; threadId: string;
  timestampMs: number;
}
export interface OwnedNativeHistoryMetadata {
  policyVersion: "owned-native-final-summary-v1";
  filterPolicyVersion: "known-pattern-filter-v1";
  scope: OwnedNativeHistoryScope;
  provenance: OwnedNativeHistoryProvenance;
  fingerprint: string; originalBytes: number; exclusionReason: string | null;
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
  captureScope: "explicit-policy-user-assistant-text";
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

/** Authenticated producer event projection. Complete applies to this message,
 * never to unobserved earlier/filtered transcript items. */
export interface TranscriptHistoryMetadata {
  policyVersion: "canonical-events-v1";
  scope: OwnedNativeHistoryScope;
  provenance: OwnedNativeHistoryProvenance;
  sourceRevision: string; originalBytes: number; exclusionReason: string | null;
}

/** A retained conversation is a different authority family from an AgentTask. */
export interface OwnedConversationHistoryScope {
  kind: "owned-conversation"; mode: "canonical-text-v1";
  conversationId: string; threadId: string; sourceId: string; profileId: string;
  backendAccountId: string; authEpoch: string; serverGeneration: string;
  workerBindingId: string; workerGeneration: number;
}
export type HistoryCaptureScope = { kind: "agent-task"; scope: OwnedNativeHistoryScope } | OwnedConversationHistoryScope;
export interface OwnedConversationHistoryProvenance {
  actionId: string; nativeActionId: string; serverGeneration: string;
  workerBindingId: string; workerGeneration: number;
  messageId: string; turnId: string; threadId: string; timestampMs: number;
}
export interface OwnedConversationHistoryMetadata {
  policyVersion: "owned-conversation-text-v1"; filterPolicyVersion: "known-pattern-filter-v1";
  scope: OwnedConversationHistoryScope; provenance: OwnedConversationHistoryProvenance;
  sourceRevision: string; cursor: number; captureEpoch: string;
  /** These are producer observation positions, not vendor sequence/revision IDs. */
  positionAuthority: "local-observation";
  attribution: "direct-human" | "automatic-host" | "assistant" | "unknown";
  phase: "commentary" | "final_answer" | null;
  originalBytes: number; exclusionReason: "known-secret-content" | "generated-instructions-or-schema" | null;
}
