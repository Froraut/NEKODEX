import type { AgentTask, AgentWorker, AgentDispatch, AgentDispatchDisposition, MailMessage, AgentToolOutcome, AgentWorkPacket } from '../../src/agent-mode/types';
export type { AgentTask, AgentWorker, AgentDispatch, AgentDispatchDisposition, MailMessage, AgentToolOutcome };

/** Transport is injected by App; this surface never reaches a provider directly. */
export interface AgentWorkspaceRoot { id: string; name: string }
export interface AgentWorkspaceGrantSummary { id: string; workspaceId: string; taskId: string; familyId: string; generation: number; paths: string[]; state: 'active' | 'revoked' }
export interface AgentArtifactObservation {
  evidence: AgentTask['evidence'][number];
  reference: { observedAt?: string; actualSha256?: string | null; exists?: boolean };
}
/** Current actionable metadata from the task owner, independent of capped history. */
export interface AgentPendingToolCall {
  toolCallId: string;
  tool: string;
  arguments: Record<string, unknown>;
  wireName?: string;
}
export interface AgentToolReconciliationView {
  id: string;
  idempotencyKey: string;
  sourceDispatchId: string;
  originalScope: AgentToolOutcome['scope'];
  observedTaskGeneration: number;
  outcome: AgentToolOutcome;
  late: boolean;
  createdAt: number;
}
export interface AgentModeApi {
  request(body: Record<string, unknown>): Promise<unknown>;
  loopFileWatcherRequest?(body: import('./AgentLoopFileWatcher').LoopFileWatcherRequest): Promise<import('./AgentLoopFileWatcher').LoopFileWatcherResponse>;
  loopProducerRequest?(body: import('./AgentLoopExternalProducer').LoopExternalProducerRequest): Promise<import('./AgentLoopExternalProducer').LoopExternalProducerResponse>;
  nativeAccounts?: import('./native-accounts-types').NativeAccountsApi;
  nativeHistory?: Pick<import('./conversation-history-types').ConversationHistoryApi, 'request'>;
  workspaceRoots?(): Promise<AgentWorkspaceRoot[]>;
  workspaceGrants?(): Promise<AgentWorkspaceGrantSummary[]>;
  revokeWorkspaceGrant?(grantId: string): Promise<unknown>;
}
export interface AgentModeStatus {
  configured: boolean;
  accepting?: boolean;
  ownerId?: string;
  models: { id: string; label?: string; provider?: 'local-responses' | 'owned-native'; admissionId?: string; available?: boolean; accepting?: boolean; imageInput?: boolean; maxConcurrent?: number }[];
  capabilities: { tools: boolean; workspace: boolean; autoSchedule: boolean; observedEvidence?: boolean; loopSource?: 'mailbox'; externalWatchers?: boolean; semanticReview?: { available: boolean; providers: 'local-responses'[] } };
  tasks: AgentTask[];
  total?: number;
  truncated?: boolean;
  archived?: number;
}
export interface AgentModeDetail {
  task: AgentTask;
  loopSourceAuthority?: import('../../src/agent-mode/types').AgentLoopSourceAuthority;
  workers: AgentWorker[];
  dispatches: AgentDispatch[];
  messages: MailMessage[];
  receipts: { id: string; kind: string; body: unknown }[];
  toolOutcomes?: AgentToolOutcome[];
  pendingToolCalls?: AgentPendingToolCall[];
  toolReconciliations?: AgentToolReconciliationView[];
  /** User-recorded outcomes for unknown sends of stopped tasks; separate receipts, never dispatch-row edits. */
  dispatchDispositions?: AgentDispatchDisposition[];
  effectiveToolOutcomes?: AgentToolOutcome[];
  workPackets?: AgentWorkPacket[];
  loopSource?: 'mailbox';
  snapshotReceipts?: Array<{ dispatchId: string; state: string; failure: string | null; receipt: { id: string; snapshotId: string; grantId: string; generation: number; totalBytes: number; files: Array<{ path: string; revision: string | null; missing: boolean; size: number }> } | null }>;
  coverage?: Record<'dispatches' | 'messages' | 'receipts', { total: number; truncated: boolean }> & { pendingToolCalls?: { total: number; truncated: boolean } };
}
