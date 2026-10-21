import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';

export type CodexHandoffPhase = 'acquiring' | 'held' | 'dispatching' | 'running' | 'releasing' | 'released';
export interface CodexHandoffAction {
  actionId: string;
  threadId: string;
  requestedAt: string;
  state: 'pending' | 'unknown';
  phase: CodexHandoffPhase;
  turnId: string | null;
  turnStatus: 'completed' | 'interrupted' | 'failed' | null;
  reasonCode: string | null;
  approvalsRefused: number;
}
export interface CodexThreadHandoffSnapshot {
  available: boolean;
  transport: 'owned-stdio-server';
  /** Codex's per-thread cross-process writer lock is the only exclusivity authority. */
  exclusivity: 'codex-thread-writer-lock';
  /** Server approval/input requests are refused; Codex settles them as denied. */
  approvals: 'refused';
  active: { actionId: string; threadId: string; phase: CodexHandoffPhase } | null;
  uncertainHandoffs: CodexHandoffAction[];
  errorCode: string | null;
}
export interface CodexThreadHandoffReceipt {
  actionId: string;
  threadId: string;
  turnId: string;
  turnStatus: 'completed' | 'interrupted' | 'failed';
  approvalsRefused: number;
  /** The owned process closed, releasing the thread writer for the external client. */
  released: true;
  executionOwner: 'released';
  assistantText: string | null;
  assistantTextTruncated: boolean;
}
export interface CodexThreadHandoff {
  /** One explicit action: acquire exclusively, send one message, await its final state, release. */
  continueThread(params: { threadId: string; text: string; userInitiated: true }): Promise<CodexThreadHandoffReceipt>;
  acknowledge(params: { actionId: string; threadId: string; confirmedInspection: true }): CodexThreadHandoffSnapshot;
  snapshot(): CodexThreadHandoffSnapshot;
  currentOperation(): string | null;
  destroy(): Promise<void>;
}
export function createCodexThreadHandoff(options: {
  executable: string;
  codexHome: string;
  journalPath?: string;
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
  interruptGraceMs?: number;
  stopGraceMs?: number;
  spawnProcess?: (executable: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;
  terminateProcess?: (child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) => void;
}): CodexThreadHandoff;
