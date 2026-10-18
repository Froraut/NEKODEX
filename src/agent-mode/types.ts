/** Internal standalone Agent-mode contracts. None of these values grant tool authority. */
export type AgentMode = "manual" | "goal" | "loop";
export type TaskStatus = "ready" | "running" | "paused" | "awaiting_input" | "review_required" | "verified_complete" | "stopped";
export type StageStatus = "pending" | "running" | "blocked" | "completed" | "failed";
export interface AgentBounds {
  maxConcurrent: number;
  maxTurns: number;
  /** Integer cost units chosen by the host (for example micro-USD), never guessed usage. */
  maxSpend: number | null;
}
export interface Requirement { id: string; text: string }
export interface StageInput { id: string; instruction: string; requirementIds: string[]; dependsOn?: string[] }
export interface Stage extends StageInput { status: StageStatus; dispatchId?: string; continuationFrom?: string; continuationGeneration?: number }
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
  execution?: { provider: "local-responses"; model: string };
  workspaceSnapshotGrant?: unknown;
  ownerId?: string;
  reason?: string;
  evidenceRevision: number;
  evidence: OutcomeEvidence[];
  review?: OutcomeReview;
  cycle: number;
  lastWorkKey?: string;
  loopRun?: { ownerId: string; generation: number };
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
  execution?: { provider: "local-responses"; model: string };
  workspaceSnapshotGrant?: unknown;
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
/** Private canonical Responses items, not a transcript/export or filesystem permission. */
export interface AgentContinuation {
  responseId: string;
  rootDispatchId: string;
  input: Record<string, unknown>[];
  output: Record<string, unknown>[];
  tools: Record<string, unknown>[];
  toolMap: { wireName: string; tool: string }[];
  pending: AgentToolRequest[];
}
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
  | { action: "correct"; text: string; requirements: Requirement[]; stages: StageInput[] }
  | { action: "mode"; mode: AgentMode; recurringAuthorized?: boolean };
