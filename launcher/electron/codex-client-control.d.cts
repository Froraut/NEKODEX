import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';

export type CodexThreadStatus = { type: 'notLoaded' | 'idle' | 'systemError' }
  | { type: 'active'; activeFlags: Array<'waitingOnApproval' | 'waitingOnUserInput'> };
export interface CodexThreadMetadata {
  id: string;
  sessionId: string | null;
  parentThreadId: string | null;
  forkedFromId: string | null;
  name: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  cwd: string | null;
  model: string | null;
  modelProvider: string | null;
  reasoningEffort: string | null;
  originator: string | null;
  source: string;
  status: CodexThreadStatus;
  createdAt: number | null;
  updatedAt: number | null;
  recencyAt: number | null;
}
export type CodexStatusScope = 'connection' | 'configured-server';
export type CodexMethodSupport = 'unverified' | 'supported' | 'unsupported';
export interface CodexForkAction {
  actionId: string;
  threadId: string;
  lastTurnId: string | null;
  requestedAt: string;
  state: 'pending' | 'unknown';
  reasonCode: string | null;
  observedForkId: string | null;
}
export interface CodexClientControlSnapshot {
  state: 'closed' | 'closing' | 'unavailable' | 'ready' | 'connecting' | 'disconnected';
  transport: 'existing-server-proxy' | 'owned-stdio-server';
  statusScope: CodexStatusScope;
  userAgent: string | null;
  capabilities: { list: CodexMethodSupport; read: CodexMethodSupport; fork: CodexMethodSupport;
    startTurn: false; interruptTurn: false; approve: false };
  errorCode: string | null;
  uncertainForks: CodexForkAction[];
}
export interface CodexClientControl {
  connect(): Promise<CodexClientControlSnapshot>;
  snapshot(): CodexClientControlSnapshot;
  /** Pending fork ownership only; unknown outcomes are terminal and do not block quit forever. */
  currentOperation(): string | null;
  listThreads(params?: { cursor?: string | null; limit?: number; cwd?: string; archived?: boolean },
    options?: { signal?: AbortSignal }): Promise<{ data: CodexThreadMetadata[]; nextCursor: string | null;
      statusScope: CodexStatusScope }>;
  readThread(threadId: string, options?: { signal?: AbortSignal }): Promise<{
    thread: CodexThreadMetadata; statusScope: CodexStatusScope }>;
  /** Call only from a guarded, explicit user action. No turn starts or approval overrides. */
  forkThread(params: { threadId: string; lastTurnId?: string; userInitiated: true }): Promise<{
    thread: CodexThreadMetadata; actionId: string; statusScope: CodexStatusScope }>;
  acknowledgeFork(params: { actionId: string; threadId: string; confirmedInspection: true }): CodexClientControlSnapshot;
  /** Awaits the owned client process closing. Never stops an existing server daemon. */
  destroy(): Promise<void>;
}
export function createCodexClientControl(options: {
  executable: string;
  codexHome: string;
  journalPath?: string;
  controlSocket?: string;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  stopGraceMs?: number;
  maxLineBytes?: number;
  spawnProcess?: (executable: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
  terminateProcess?: (child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) => void;
}): CodexClientControl;
