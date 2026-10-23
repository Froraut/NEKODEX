import type { CodexClientControlSnapshot, CodexForkAttachmentParity, CodexStatusScope, CodexThreadMetadata } from '../electron/codex-client-control.cjs';
import type { CodexThreadHandoffReceipt, CodexThreadHandoffSnapshot } from '../electron/codex-thread-handoff.cjs';
export type { CodexClientControlSnapshot, CodexStatusScope, CodexThreadMetadata, CodexForkAction, CodexForkAttachmentParity } from '../electron/codex-client-control.cjs';
export type { CodexHandoffAction, CodexThreadHandoffReceipt, CodexThreadHandoffSnapshot } from '../electron/codex-thread-handoff.cjs';

export type NativeThreadsResult<T> = { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; rpcCode?: number } };
export type NativeThreadsPage = { data: CodexThreadMetadata[]; nextCursor: string | null; statusScope: CodexStatusScope };
export type NativeThreadReceipt = { thread: CodexThreadMetadata; statusScope: CodexStatusScope };
export type NativeThreadForkReceipt = NativeThreadReceipt & { actionId: string; sourceThreadId: string;
  lastTurnId: string | null; executionStarted: false; attachments?: CodexForkAttachmentParity };
export interface NativeThreadsApi {
  nativeThreadsSnapshot(): Promise<NativeThreadsResult<CodexClientControlSnapshot>>;
  nativeThreadsList(params?: { cursor?: string | null; limit?: number; cwd?: string; archived?: boolean }):
    Promise<NativeThreadsResult<NativeThreadsPage>>;
  nativeThreadRead(threadId: string): Promise<NativeThreadsResult<NativeThreadReceipt>>;
  nativeThreadFork(params: { threadId: string; lastTurnId?: string }): Promise<NativeThreadsResult<NativeThreadForkReceipt>>;
  nativeThreadAcknowledgeFork(params: { actionId: string; threadId: string; confirmedInspection: true }):
    Promise<NativeThreadsResult<CodexClientControlSnapshot>>;
  /** Exclusive cooperative handoff; optional so older preload bundles keep metadata-only behavior. */
  nativeThreadHandoffSnapshot?(): Promise<NativeThreadsResult<CodexThreadHandoffSnapshot>>;
  nativeThreadStopHandoff?(params: { actionId: string; threadId: string }): Promise<NativeThreadsResult<CodexThreadHandoffSnapshot>>;
  nativeThreadContinue?(params: { threadId: string; text: string }): Promise<NativeThreadsResult<CodexThreadHandoffReceipt>>;
  nativeThreadAcknowledgeHandoff?(params: { actionId: string; threadId: string; confirmedInspection: true }):
    Promise<NativeThreadsResult<CodexThreadHandoffSnapshot>>;
}
