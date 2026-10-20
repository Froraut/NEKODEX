import type { HistoryMarkdownExport, HistoryMessage, HistoryPage, HistoryStatus, HistoryThread, ThreadIdentity } from "../../src/conversation-history/types";
export type { HistoryMarkdownExport, HistoryMessage, HistoryPage, HistoryStatus, HistoryThread, ThreadIdentity };
export interface ConversationHistoryApi {
  request(body: { action: string; [key: string]: unknown }): Promise<unknown>;
  copyText(text: string): Promise<unknown>;
  saveMarkdown(markdown: string): Promise<{ saved: boolean; path?: string }>;
}

export type { TranscriptSubscriptionStatus } from "../../src/conversation-history/transcript";
