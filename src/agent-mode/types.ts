import type { NativeSelectedAttachment } from "./native-attachment-types";
/** Internal standalone Agent-mode contracts. None of these values grant tool authority. */
export type AgentMode = "manual" | "goal" | "loop";
export type TaskStatus = "ready" | "running" | "paused" | "awaiting_input" | "review_required" | "verified_complete" | "stopped";
export type StageStatus = "pending" | "running" | "blocked" | "completed" | "failed";
export type AgentExecutionConfig = { provider: "local-responses"; model: string }
  | { provider: "owned-native"; model: string; admissionId: string };
export interface AgentBounds {
  maxConcurrent: number;
  maxTurns: number;
  /** Integer cost units chosen by the host (for example micro-USD), never guessed usage. */
  maxSpend: number | null;
}
export interface Requirement { id: string; text: string }
export interface StageInput { id: string; instruction: string; requirementIds: string[]; dependsOn?: string[] }
export interface Stage extends StageInput { status: StageStatus; dispatchId?: string; continuationFrom?: string; continuationGeneration?: number; waitingFor?: "user" | "tools"; userInput?: string }
export interface OutcomeEvidence {
  id: string;
  requirementId: string;
  taskRevision: number;
  sourceEventId: string;
  subject: string;
  subjectRevision: string;
  property: string;
  outcome: "passed" | "failed" | "unknown";
  /** A trusted host observer supplies this; model text cannot manufacture an observation. */
  observer: string;
  /** A trusted fresh observation may retire only previous facts for its exact same condition. */
  supersedes?: string[];
}
export interface OutcomeReview {
  id: string;
  generation: number;
  taskRevision: number;
  evidenceRevision: number;
  findings: string[];
  recommendation: string;
  coverage: { requirementId: string; evidenceIds: string[] }[];
  /** False when the bounded evidence/history input is incomplete. */
  completeInput: boolean;
}
export type SemanticVerdict = "pass" | "fail" | "unknown";
/** Host classification of a cited canonical tool receipt. An action receipt proves only that input ran. */
export type SemanticFactClass = "observation" | "tool-result" | "action-receipt";
export interface SemanticRequirementVerdict {
  requirementId: string;
  verdict: SemanticVerdict;
  /** Reviewer judgment of whether the cited facts establish the WHOLE requirement, not one property. */
  sufficiency: "complete" | "partial" | "none";
  /** Active observed OutcomeEvidence IDs for this requirement. */
  evidenceIds: string[];
  /** Canonical current-revision tool receipt keys from the reviewed packet. */
  toolReceiptIds: string[];
  rationale: string;
  missing: string[];
}
/** Explicitly selected reviewer. Only the existing loopback Responses owner can run it. */
export interface AgentSemanticReviewer { provider: "local-responses"; model: string }
/** Independent recommendation from a separate tool-less model context. Never self-certifies:
 * Verify still re-derives every cited fact from the store and rebuilds the reviewed input digest. */
export interface SemanticOutcomeReview {
  id: string;
  attemptId: string;
  generation: number;
  taskRevision: number;
  evidenceRevision: number;
  /** sha256 of the exact bounded review packet; any later ledger change makes this review stale. */
  inputDigest: string;
  reviewer: AgentSemanticReviewer & { context: "fresh-tool-less"; independence: "separate-provider" | "separate-model" | "separate-context"; receiptId: string };
  requirements: SemanticRequirementVerdict[];
  deliverable: { verdict: SemanticVerdict; rationale: string };
  completeInput: boolean;
  /** Fixed host normalizations applied to the reviewer's raw verdicts, e.g. pass without an observed basis. */
  hostAdjustments: string[];
  createdAt: number;
}
export interface SemanticReviewRequest { attemptId: string; taskId: string; reviewer: AgentSemanticReviewer; instructions: string; prompt: string; signal: AbortSignal }
/** Fixed reasons a reviewer terminal carried no usable verdict; recorded with its attempt. */
export type SemanticReviewInvalidReason = "turn_not_completed" | "non_message_output" | "unsupported_provenance" | "final_answer_empty"
  | "no_json_object" | "multiple_json_objects" | "unterminated_json_object" | "schema_mismatch" | "requirement_mismatch" | "unclassified";
export interface SemanticReviewTextExcerpt { bytes: number; text: string; truncated: boolean }
/** Bounded, redacted shape of one reviewer reply, retained only to diagnose an invalid output. */
export interface SemanticReviewReplyEvidence {
  items: { type: string; phase: "final_answer" | "commentary" | "none" | "other" | null; bytes: number }[];
  omittedItems: number;
  /** The final-channel text the host parsed. */
  final: SemanticReviewTextExcerpt;
  /** Commentary is kept for diagnosis only; it is never parsed as a verdict. */
  commentary: SemanticReviewTextExcerpt;
}
export interface SemanticReviewInvalidEvidence { reason: SemanticReviewInvalidReason; issues?: { path: string; code: string }[]; reply?: SemanticReviewReplyEvidence }
/** One fresh, tool-less model turn through an existing execution owner. Throwing means unknown
 * outcome, except SemanticReviewOutputError: a terminal that carried no usable verdict. */
export interface SemanticReviewPort {
  review(request: SemanticReviewRequest): Promise<{ receiptId: string; text: string; reply?: SemanticReviewReplyEvidence }>;
}
export interface AgentTask {
  schemaVersion: 1;
  id: string;
  familyId: string;
  ownerMode: "agent";
  mode: AgentMode;
  status: TaskStatus;
  generation: number;
  revision: number;
  originalRequest: string;
  corrections: { revision: number; text: string }[];
  requirements: Requirement[];
  stages: Stage[];
  bounds: AgentBounds;
  turns: number;
  spent: number;
  reserved: number;
  /** Count of terminal turns whose monetary price remains unavailable. spent is a known subtotal. */
  unpricedTurns: number;
  execution?: AgentExecutionConfig;
  /** Native bounds count admitted offers, not unobserved internal retries/compaction requests. */
  turnUnit?: "responses-requests" | "native-offers";
  workspaceSnapshotGrant?: unknown;
  nativeAttachments?: NativeSelectedAttachment[];
  ownerId?: string;
  reason?: string;
  evidenceRevision: number;
  evidence: OutcomeEvidence[];
  review?: OutcomeReview;
  /** DW9 independent semantic review of the current generation/revision/evidence and ledger digest. */
  semanticReview?: SemanticOutcomeReview;
  cycle: number;
  lastWorkKey?: string;
  loopRun?: { ownerId: string; generation: number };
  /** Set once by archive. The row and its ledger stay; the task is then read-only and hidden from listings. */
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}
export interface CreateAgentTask {
  ownerMode: "agent";
  id?: string;
  familyId?: string;
  mode: AgentMode;
  originalRequest: string;
  requirements: Requirement[];
  stages: StageInput[];
  bounds: AgentBounds;
  /** Recurrence is a separate, explicit user instruction. */
  recurringAuthorized?: boolean;
  execution?: AgentExecutionConfig;
  workspaceSnapshotGrant?: unknown;
  nativeAttachments?: NativeSelectedAttachment[];
}
export interface AgentWorker {
  id: string;
  taskId: string;
  familyId: string;
  name: string;
  state: "sleeping" | "busy" | "unknown";
  dispatchId?: string;
}
export interface MailMessage {
  id: string;
  revision: number;
  taskId: string;
  familyId: string;
  generation: number;
  sender: string;
  recipient: string;
  text: string;
  state: "pending" | "offered" | "acked";
  ackReceipt?: string;
  createdAt: number;
}
export interface AgentWorkPacket {
  workId: string;
  taskId: string;
  workKey: string;
  text: string;
  state: "pending" | "claimed" | "held";
  enqueuedGeneration: number;
  cycle?: number;
  createdAt: number;
}
/** Live runtime observation for a selected Loop source; never persisted or a tool grant. */
export interface AgentLoopSourceAuthority {
  active: true;
  runId: string;
  ownerId: string;
  familyId: string;
  generation: number;
  revision: number;
  cycle: number;
}
export type DispatchState = "admitted" | "offered" | "acked" | "unknown" | "settled" | "cancelled";
export interface ExecutionResult {
  receiptId: string;
  outcome: "completed" | "failed" | "awaiting_input" | "not_sent";
  summary: string;
  /** Null preserves unavailable usage and holds its cost reservation. */
  actualSpend: number | null;
  continuation?: AgentContinuation;
}
export interface AgentToolRequest { toolCallId: string; tool: string; arguments: Record<string, unknown>; wireName: string }
export interface AgentNativeToolRequest { protocol: "neko-agent-v1"; toolCallId: string; requestId: string; tool: string; arguments: Record<string, unknown> }
export type AgentPendingToolRequest = AgentToolRequest | AgentNativeToolRequest;
/** Private canonical Responses items, not a transcript/export or filesystem permission. */
export interface AgentResponsesContinuation {
  /** Missing on legacy saved Web continuations. */
  kind?: "responses";
  responseId: string;
  rootDispatchId: string;
  input: Record<string, unknown>[];
  output: Record<string, unknown>[];
  tools: Record<string, unknown>[];
  toolMap: { wireName: string; tool: string }[];
  pending: AgentToolRequest[];
}
export interface AgentNativeToolDefinition { id: string; description?: string; inputSchema: Record<string, unknown> }
export interface AgentNativeContinuation {
  kind: "owned-native";
  version: 1;
  protocol: "neko-agent-v1";
  rootDispatchId: string;
  taskGeneration: number;
  taskRevision: number;
  workerBindingId: string;
  workerGeneration: number;
  nativeTurnReceiptId: string;
  imageUsage?: { count: number; byteLength: number };
  catalog: AgentNativeToolDefinition[];
  catalogDigest: string;
  requestIds: string[];
  pending: AgentNativeToolRequest[];
}
export type AgentContinuation = AgentResponsesContinuation | AgentNativeContinuation;
export interface AgentToolOutcome {
  idempotencyKey: string;
  scope: { taskId: string; generation: number; toolCallId: string };
  tool: string;
  state: "completed" | "failed" | "outcome_unknown";
  result?: unknown;
  reason?: string;
}
export interface AgentToolReceiptRequest {
  scope: AgentToolOutcome["scope"];
  tool: string;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
}
/** A trusted retained provider receipt resolves uncertainty without rewriting its original record. */
export interface AgentToolReconciliation {
  id: string;
  taskId: string;
  idempotencyKey: string;
  sourceDispatchId: string;
  originalScope: AgentToolOutcome["scope"];
  sourceTaskRevision: number;
  observedTaskGeneration: number;
  observedTaskRevision: number;
  requestFingerprint: string;
  terminalReceiptDigest: string;
  outcome: AgentToolOutcome;
  late: boolean;
  createdAt: number;
}
export interface AgentToolReconciliationResult {
  task: AgentTask;
  reconciliation?: AgentToolReconciliation;
  outcome?: AgentToolOutcome;
  unchanged: boolean;
}
export interface AgentDispatch {
  id: string;
  taskId: string;
  familyId: string;
  generation: number;
  taskRevision: number;
  ownerId: string;
  workerId: string;
  stageId: string;
  messageId: string;
  /** Immutable exact mailbox packet offered to this execution, including the stage instruction. */
  messages: { id: string; revision: number }[];
  continuationOf?: string;
  state: DispatchState;
  reservedSpend: number;
  acceptanceReceipt?: string;
  transportClaim?: { id: string; payloadDigest: string };
  result?: ExecutionResult;
  usageReceipt?: { id: string; actualSpend: number };
  late?: boolean;
  createdAt: number;
}
export interface ExecutionRequest {
  dispatch: AgentDispatch;
  task: AgentTask;
  worker: AgentWorker;
  stage: Stage;
  messages: MailMessage[];
  history: { reports: { dispatchId: string; workerId: string; stageId: string; summary: string }[]; total: number; truncated: boolean };
  /** Inert canonical context, never authority to replay a tool or certify an outcome. */
  priorToolContext?: { complete: boolean; receipts: { dispatchId: string; stageId: string; taskRevision: number; outcome: AgentToolOutcome }[] };
  continuation?: { source: AgentContinuation; outcomes: AgentToolOutcome[] };
  signal: AbortSignal;
}
/** Host implements model selection, workspace/tool approvals and exact send reconciliation. */
export interface AgentExecutionPort {
  execute(request: ExecutionRequest, acknowledge: (acceptanceReceipt: string) => void): Promise<ExecutionResult>;
}
export interface OutcomeReviewPort {
  /** A recommendation only. The store separately checks current observed coverage. */
  review(task: AgentTask): Promise<OutcomeReview>;
}
export type AgentControl =
  | { action: "pause" | "stop" | "resume" }
  | { action: "reply"; text: string }
  | { action: "correct"; text: string; requirements: Requirement[]; stages: StageInput[] }
  | { action: "mode"; mode: AgentMode; recurringAuthorized?: boolean };
