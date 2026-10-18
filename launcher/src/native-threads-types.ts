import type { CodexClientControlSnapshot, CodexStatusScope, CodexThreadMetadata } from '../electron/codex-client-control.cjs';
export type { CodexClientControlSnapshot, CodexStatusScope, CodexThreadMetadata, CodexForkAction } from '../electron/codex-client-control.cjs';

export type NativeThreadsResult<T> = { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; rpcCode?: number } };
export type NativeThreadsPage = { data: CodexThreadMetadata[]; nextCursor: string | null; statusScope: CodexStatusScope };
export type NativeThreadReceipt = { thread: CodexThreadMetadata; statusScope: CodexStatusScope };
export interface NativeThreadsApi {
  nativeThreadsSnapshot(): Promise<NativeThreadsResult<CodexClientControlSnapshot>>;
  nativeThreadsList(params?: { cursor?: string | null; limit?: number; cwd?: string; archived?: boolean }):
    Promise<NativeThreadsResult<NativeThreadsPage>>;
  nativeThreadRead(threadId: string): Promise<NativeThreadsResult<NativeThreadReceipt>>;
  nativeThreadFork(params: { threadId: string; lastTurnId?: string }): Promise<NativeThreadsResult<NativeThreadReceipt>>;
  nativeThreadAcknowledgeFork(params: { actionId: string; threadId: string; confirmedInspection: true }):
    Promise<NativeThreadsResult<CodexClientControlSnapshot>>;
}
