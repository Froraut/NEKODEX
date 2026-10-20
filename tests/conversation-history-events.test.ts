import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationHistoryStore } from "../src/conversation-history/store";
import type { OwnedNativeHistoryScope } from "../src/conversation-history/types";
import type { TranscriptEventInput } from "../src/conversation-history/transcript";

test("consented canonical event subscriptions retain edits, deletion and scope revocation without capturing envelopes or replaying deleted revisions", () => {
  const home = mkdtempSync(join(tmpdir(), "nekodex-transcript-events-"));
  const scope: OwnedNativeHistoryScope = { taskId: "synthetic-history-task", generation: 1, sourceId: "a".repeat(64), profileId: "synthetic-profile", backendAccountId: "synthetic-account", authEpoch: "0199a001-0000-7000-8000-000000000001" };
  let current: OwnedNativeHistoryScope | null = scope;
  let store = new ConversationHistoryStore({ coreHome: home, trustedCurrentScope: () => current });
  const subscribe = () => store.transcript.subscribe(scope, { dispatchId: "synthetic-dispatch" });
  const enable = () => store.transcript.setConsent({ scope, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
  try {
    expect(subscribe()).toBeNull();
    store.setRecordingEnabled(true);
    // Existing final-summary consent never authorizes broader event capture.
    store.ownedNative.setConsent({ scope, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
    expect(subscribe()).toBeNull();
    expect(() => store.transcript.setConsent({ scope, enabled: true, consent: true })).toThrow("acknowledgement");
    enable();
    const lease = subscribe()!;
    const input: TranscriptEventInput = { lease, scope, provenance: { dispatchId: lease.dispatchId, workerBindingId: "synthetic-binding", workerGeneration: 1, nativeTurnReceiptId: "synthetic-receipt", messageId: "synthetic-message", turnId: "synthetic-turn", threadId: "synthetic-thread", timestampMs: 1770000000000 },
      event: { kind: "upsert", sourceRevision: "source-r1", revisionNumber: 1, role: "user", author: "unknown", text: "First selected conversational request.", coverage: "complete" } };
    Object.assign(input, { envelope: "FORBIDDEN-HOST-ENVELOPE", toolResult: "FORBIDDEN-TOOL-RESULT" });
    const first = store.transcript.recordEvent(input);
    expect(first.outcome).toBe("recorded");
    if (!("message" in first)) throw new Error("Missing stored message");
    expect(first.message.author).toBe("unknown");
    expect(store.transcript.recordEvent(input).outcome).toBe("stale");
    expect(store.search({ query: "First selected" }).total).toBe(1);
    const edit: TranscriptEventInput = { ...input, event: { ...input.event, kind: "upsert", sourceRevision: "source-r2", revisionNumber: 2, role: "user", author: "unknown", text: "Revised selected conversational request.", coverage: "complete" } };
    expect(store.transcript.recordEvent(edit).outcome).toBe("recorded");
    expect(store.search({ query: "First selected" }).total).toBe(0);
    expect(store.search({ query: "Revised selected" }).total).toBe(1);
    const exported = store.exportMarkdown(first.message);
    expect(exported.markdown).toContain("source-r2");
    expect(exported.markdown).toContain(scope.authEpoch);
    expect(exported.partial).toBe(true);
    expect(store.transcript.recordEvent({ ...input, event: { kind: "delete", sourceRevision: "source-r3", revisionNumber: 3 } }).outcome).toBe("deleted");
    expect(store.getMessage(first.message)).toBeNull();
    expect(store.search({ query: "Revised selected" }).total).toBe(0);
    expect(store.transcript.recordEvent(edit).outcome).toBe("stale");
    const secret: TranscriptEventInput = { ...input, provenance: { ...input.provenance, messageId: "secret-message" }, event: { kind: "upsert", sourceRevision: "secret-r1", revisionNumber: 1, role: "assistant", author: "assistant", text: "password=SYNTHETIC-SECRET-NEVER-STORE", coverage: "complete" } };
    expect(store.transcript.recordEvent(secret).outcome).toBe("rejected");
    expect(store.search({ query: "SYNTHETIC SECRET" }).total).toBe(0);
    expect(store.transcript.status(scope).activeSubscriptions).toBe(1);
    store.setRecordingEnabled(false); store.setRecordingEnabled(true);
    expect(store.transcript.recordEvent(input).outcome).toBe("revoked");
    const late = { ...input, lease: subscribe() };
    current = { ...scope, authEpoch: "0199a001-0000-7000-8000-000000000002" };
    expect(store.transcript.recordEvent(late).outcome).toBe("revoked");
    current = scope;
    store.transcript.revokeTaskGeneration({ taskId: scope.taskId, generation: scope.generation });
    expect(store.transcript.recordEvent(late).outcome).toBe("revoked");
    expect(subscribe()).toBeNull();
    for (const marker of ["FORBIDDEN-HOST-ENVELOPE", "FORBIDDEN-TOOL-RESULT", "SYNTHETIC-SECRET-NEVER-STORE"]) expect(readFileSync(store.path).includes(Buffer.from(marker))).toBe(false);
    store.close();
    store = new ConversationHistoryStore({ coreHome: home, trustedCurrentScope: () => current });
    expect(store.transcript.status(scope)).toMatchObject({ enabled: false, activeSubscriptions: 0 });
    expect(store.status().totalMessages).toBe(1);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
}, 5000);
