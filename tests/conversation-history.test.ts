import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationHistoryStore, type CaptureRecord } from "../src/conversation-history";

const homes: string[] = [];
const stores: ConversationHistoryStore[] = [];
function fixture(options: { maxMessageBytes?: number; maxStoredBytes?: number } = {}) {
  const coreHome = mkdtempSync(join(tmpdir(), "nekodex-history-synthetic-")); homes.push(coreHome);
  const store = new ConversationHistoryStore({ coreHome, ...options }); stores.push(store);
  return { store, coreHome };
}
function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return { clientId: "synthetic-client", threadId: "synthetic-thread", messageId: "m1", revisionId: "r1", revisionNumber: 1,
    turnId: "turn-1", compactionId: null, role: "user", author: "agent", source: "responses", text: "alpha original text",
    timestamp: 1000, coverage: "complete", capturePolicy: "user-assistant-text-v1", sensitivity: "caller-validated", ...overrides };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("private opt-in conversation history (real bun:sqlite)", () => {
  test("disabled by default, explicit toggle preserves data and restart state, one writer", () => {
    const { store, coreHome } = fixture();
    expect(store.status().recordingEnabled).toBe(false);
    expect(store.record(capture())).toEqual({ outcome: "disabled" });
    expect(store.status().revisions).toBe(0);
    expect(() => new ConversationHistoryStore({ coreHome })).toThrow("already has a writer");
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(coreHome, "conversation-history")).mode & 0o777).toBe(0o700);
    store.setRecordingEnabled(true); store.record(capture()); store.setRecordingEnabled(false); store.close();
    const reopened = new ConversationHistoryStore({ coreHome }); stores.push(reopened);
    expect(reopened.status()).toMatchObject({ recordingEnabled: false, totalMessages: 1, revisions: 1, indexedMessages: 1 });
    expect(reopened.search({ query: "alpha" }).items[0]?.author).toBe("agent");
    reopened.setRecordingEnabled(true);
    expect(reopened.record(capture()).outcome).toBe("duplicate");
  });

  test("atomic edits retain immutable revisions, idempotence and latest-only FTS across reopen", () => {
    const { store, coreHome } = fixture(); store.setRecordingEnabled(true);
    store.record(capture());
    const edit = capture({ revisionId: "r3", revisionNumber: 3, text: "beta revised ```code```", compactionId: "compact-1", author: "unknown" });
    expect(store.record(edit)).toMatchObject({ outcome: "recorded", latest: true });
    expect(store.record(edit).outcome).toBe("duplicate");
    expect(store.record(capture({ revisionId: "r2", revisionNumber: 2, text: "obsolete late revision" }))).toMatchObject({ latest: false });
    expect(store.search({ query: "alpha" }).total).toBe(0);
    expect(store.search({ query: "obsolete" }).total).toBe(0);
    const latest = store.search({ query: "beta code" }).items[0]!;
    expect(latest).toMatchObject({ revisionId: "r3", author: "unknown", compactionId: "compact-1" });
    expect(latest.link).toContain("message=m1&revision=r3");
    expect(store.getMessage({ ...edit, revisionId: "r1" })?.text).toBe("alpha original text");
    const exactExport = store.exportMarkdown({ ...edit, messageRevisions: [{messageId:"m1",revisionId:"r1"}] });
    expect(exactExport.markdown).toContain("alpha original text");
    expect(exactExport.markdown).not.toContain("beta revised");
    const before = store.status();
    expect(() => store.record({ ...edit, text: "conflicting content" })).toThrow("identity conflict");
    expect(() => store.record(capture({ revisionId: "r4", revisionNumber: 4, role: "assistant" }))).toThrow("role cannot change");
    expect(store.status()).toEqual(before);
    store.close();
    const reopened = new ConversationHistoryStore({ coreHome }); stores.push(reopened);
    expect(reopened.getThread(edit).items).toHaveLength(1);
    expect(reopened.search({ query: "beta" }).items[0]?.revisionId).toBe("r3");
    expect(reopened.status()).toMatchObject({ revisions: 3, totalMessages: 1, indexedMessages: 1 });
  });

  test("text bounds and unknown sensitivity reject content without silent truncation or secret hashes", () => {
    const { store } = fixture({ maxMessageBytes: 12 }); store.setRecordingEnabled(true);
    const oversized = "synthetic-secret-value-too-long";
    expect(store.record(capture({ text: oversized }))).toMatchObject({ outcome: "rejected", message: { text: null, coverage: "rejected", coverageReason: "message-size-limit", originalBytes: Buffer.byteLength(oversized) } });
    expect(store.record(capture({ messageId: "m2", text: "credential", sensitivity: "unknown" }))).toMatchObject({ outcome: "rejected", message: { text: null, coverageReason: "sensitivity-unverified" } });
    expect(store.record(capture({ messageId: "m3", text: "known slice", coverage: "partial", coverageReason: "stream-interrupted" })).outcome).toBe("recorded");
    expect(store.status()).toMatchObject({ totalMessages: 3, incompleteMessages: 3, indexedMessages: 1 });
    expect(store.search({ query: "credential" }).total).toBe(0);
    expect(store.search({ query: "known" }).items[0]?.coverage).toBe("partial");
    expect(readFileSync(store.path).includes(Buffer.from(oversized))).toBe(false);
    expect(readFileSync(store.path).includes(Buffer.from("credential"))).toBe(false);
    expect(() => store.record(capture({ role: "tool" as "user" }))).toThrow("user/assistant");
    expect(() => store.record(capture({ messageId: "m4", coverage: "partial" }))).toThrow("coverage reason");
  });

  test("quota visibly stops recording, survives toggle/reopen, explicit delete releases space and removes FTS/revisions", () => {
    const { store, coreHome } = fixture({ maxStoredBytes: 2000 }); store.setRecordingEnabled(true);
    expect(store.record(capture()).outcome).toBe("recorded");
    const prior = store.status().storedBytes;
    expect(store.record(capture({ messageId: "too-big", text: "q".repeat(1800) })).outcome).toBe("quota-reached");
    expect(store.status()).toMatchObject({ quotaReached: true, quotaRejected: 1, totalMessages: 1, storedBytes: prior });
    store.setRecordingEnabled(false); store.setRecordingEnabled(true);
    expect(store.record(capture({ messageId: "small", text: "x" })).outcome).toBe("quota-reached");
    store.close();
    const reopened = new ConversationHistoryStore({ coreHome, maxStoredBytes: 2000 }); stores.push(reopened);
    expect(reopened.status()).toMatchObject({ quotaReached: true, quotaRejected: 2 });
    expect(reopened.deleteMessage(capture())).toEqual({ deletedMessages: 1 });
    expect(reopened.status()).toMatchObject({ quotaReached: false, totalMessages: 0, indexedMessages: 0, revisions: 0, storedBytes: 0 });
    expect(reopened.search({ query: "alpha" }).total).toBe(0);
    expect(reopened.getMessage(capture())).toBeNull();
    expect(reopened.record(capture()).outcome).toBe("recorded");
    expect(reopened.deleteThread(capture())).toEqual({ deletedMessages: 1 });
  });

  test("bounded search, exact identities, pagination and selected export preserve Unicode/code and mark partial corpus", () => {
    const { store } = fixture(); store.setRecordingEnabled(true);
    const text = "Пример user text\n\n```typescript\nconst value = '<synthetic>';\n```\n\n**Markdown retained**";
    store.record(capture({ text }));
    store.record(capture({ messageId: "m2", role: "assistant", author: "assistant", text: "Пример reply", timestamp: 2000 }));
    store.record(capture({ clientId: "other-client", text: "Пример isolated", timestamp: 3000 }));
    expect(store.search({ query: "Пример", clientId: "synthetic-client", limit: 1 })).toMatchObject({ total: 2, hasMore: true, limit: 1 });
    expect(store.search({ query: "Пример", clientId: "synthetic-client", limit: 1, offset: 1 }).items[0]?.messageId).toBe("m1");
    expect(store.search({ query: '" OR * NOT ( )' }).total).toBe(0);
    expect(() => store.search({ query: "x".repeat(1025) })).toThrow("1024");
    expect(() => store.getThread({ ...capture(), offset: -1 })).toThrow("offset");
    expect(store.listThreads({ limit: 1 })).toMatchObject({ total: 2, hasMore: true });
    const exported = store.exportMarkdown({ ...capture(), messageIds: ["m1", "missing"] });
    expect(exported).toMatchObject({ exportedMessages: 1, totalMessages: 2, partial: true, hasMore: true });
    expect(exported.markdown).toContain(text);
    expect(exported.markdown).toContain("PARTIAL CORPUS");
    expect(exported.markdown).toContain("Author: agent; source: responses");
    expect(exported.markdown).not.toContain("Пример isolated");
    expect(store.exportMarkdown(capture()).markdown).toContain("assistant");
  });
});
