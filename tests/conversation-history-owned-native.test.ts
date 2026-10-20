import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationHistoryStore } from "../src/conversation-history/store";
import type { OwnedNativeFinalCapture, OwnedNativeHistoryScope } from "../src/conversation-history/owned-native";

test("owned Native future final summaries share private SQLite search/export; consent leases fence late generations and never retain host/tool/secret bodies", () => {
  const home = mkdtempSync(join(tmpdir(), "nekodex-owned-native-history-"));
  const scope: OwnedNativeHistoryScope = { taskId: "task-synthetic", generation: 1, sourceId: "a".repeat(64), profileId: "profile-synthetic", backendAccountId: "account-synthetic", authEpoch: "0199a001-0000-7000-8000-000000000002" };
  let current: OwnedNativeHistoryScope | null = { ...scope };
  const store = new ConversationHistoryStore({ coreHome: home, trustedCurrentScope: () => current });
  const identity = { clientId: `owned-native:${scope.sourceId}`, threadId: "native-thread-actual-fixture", messageId: "native-message-actual-fixture" };
  let nextOffer = 0;
  const lease = () => store.ownedNative.lease(scope, { dispatchId: `dispatch-${++nextOffer}` }).lease;
  const input = (leased: ReturnType<typeof lease>, summary = "Retained recommendation from the native assistant."): OwnedNativeFinalCapture => ({
    lease: leased, scope, final: { kind: "final", summary },
    provenance: { dispatchId: leased?.dispatchId ?? "dispatch-disabled", workerBindingId: "actual-fixture-binding", workerGeneration: 1,
      nativeTurnReceiptId: "native-turn:actual-fixture-receipt", messageId: identity.messageId, turnId: "native-turn-actual-fixture", threadId: identity.threadId, timestampMs: 1770000000000 },
  });
  const enable = () => store.ownedNative.setConsent({ scope, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
  try {
    expect(store.ownedNative.status(scope)).toMatchObject({ enabled: false, recordingEnabled: false, unknownSecretsPossible: true, transcriptCoverage: "partial" });
    const beforeGlobal = lease(); expect(beforeGlobal).toBeNull();
    expect(() => enable()).toThrow("Global recording");
    store.setRecordingEnabled(true);
    expect(lease()).toBeNull();
    expect(() => store.ownedNative.setConsent({ scope, enabled: true, consent: true })).toThrow("unknown-secret-risk");
    const offeredBeforeConsent = lease(); enable();
    expect(store.ownedNative.recordFinal(input(offeredBeforeConsent)).outcome).toBe("disabled");
    expect(store.status().totalMessages).toBe(0);

    const firstLease = lease()!, firstInput = input(firstLease);
    // Only final.summary is projected. Extra model/host payloads never enter records.
    Object.assign(firstInput, { automaticHostText: "HOST-MARKER-NEVER-RETAIN", toolResults: "TOOL-RESULT-MARKER-NEVER-RETAIN", reasoning: "REASONING-MARKER-NEVER-RETAIN" });
    Object.assign(firstInput.final, { argumentsJson: "TOOL-ARGS-MARKER-NEVER-RETAIN" });
    expect(store.ownedNative.recordFinal(firstInput).outcome).toBe("recorded");
    const first = store.getMessage(identity)!;
    expect(first).toMatchObject({ role: "assistant", author: "agent", source: "native", capturePolicy: "owned-native-final-summary-v1", sensitivity: "known-pattern-filtered", coverage: "partial",
      coverageReason: "validated-owned-native-final-summary-projection", timestamp: firstInput.provenance.timestampMs, turnId: firstInput.provenance.turnId,
      ownedNative: { scope, provenance: firstInput.provenance } });
    expect(store.ownedNative.recordFinal(firstInput).outcome).toBe("duplicate");
    store.ownedNative.release(firstLease);
    expect(store.ownedNative.recordFinal(firstInput).outcome).toBe("revoked");
    expect(store.status().revisions).toBe(1);
    expect(store.search({ query: "Retained recommendation" }).items[0]?.revisionId).toBe(first.revisionId);
    const exported = store.exportMarkdown(identity);
    expect(exported).toMatchObject({ exportedMessages: 1, partial: true });
    expect(exported.markdown.toLowerCase()).toContain("unknown secrets");
    expect(exported.markdown).toContain(firstInput.provenance.nativeTurnReceiptId);
    expect(exported.markdown).toContain(scope.authEpoch);
    expect(store.canonical.status(scope.sourceId, scope.authEpoch).enabled).toBe(false);

    const revoked = lease()!; store.ownedNative.revoke(scope); enable();
    expect(store.ownedNative.recordFinal(input(revoked, "REVOKED-MARKER-NEVER-RETAIN")).outcome).toBe("revoked");
    const oldGlobal = lease()!; store.setRecordingEnabled(false); store.setRecordingEnabled(true);
    expect(store.ownedNative.recordFinal(input(oldGlobal, "OLD-EPOCH-MARKER-NEVER-RETAIN")).outcome).toBe("revoked");
    const wrongDispatch = input(lease()!); wrongDispatch.provenance.dispatchId = "different-offer";
    expect(store.ownedNative.recordFinal(wrongDispatch).outcome).toBe("revoked");
    const lateGeneration = lease()!; current = { ...scope, generation: 2 };
    expect(store.ownedNative.recordFinal(input(lateGeneration, "LATE-GENERATION-MARKER-NEVER-RETAIN")).outcome).toBe("revoked");
    expect(store.ownedNative.lease(current, { dispatchId: "generation-two" }).lease).toBeNull();
    current = { ...scope, authEpoch: "0199a001-0000-7000-8000-000000000003" };
    expect(store.ownedNative.recordFinal(input(lease(), "CHANGED-ACCOUNT-MARKER-NEVER-RETAIN")).outcome).not.toBe("recorded");
    current = { ...scope };

    const filtered = input(lease()!, "password=synthetic-sensitive-marker-never-retain");
    filtered.provenance.messageId = "native-secret-message-actual-fixture";
    expect(store.ownedNative.recordFinal(filtered).outcome).toBe("rejected");
    expect(store.getMessage({ ...identity, messageId: filtered.provenance.messageId })).toMatchObject({ text: null, coverage: "rejected", coverageReason: "known-secret-content" });
    expect(store.search({ query: "synthetic sensitive marker" }).total).toBe(0);
    const generated = input(lease()!, "<INSTRUCTIONS>GENERATED-MARKER-NEVER-RETAIN</INSTRUCTIONS>"); generated.provenance.messageId = "native-generated-message";
    expect(store.ownedNative.recordFinal(generated).outcome).toBe("rejected");
    const unsupported = input(lease()!); (unsupported.final as {kind:string}).kind = "tool_request";
    expect(store.ownedNative.recordFinal(unsupported).outcome).toBe("unavailable");
    const missingNativeId = input(lease()!); missingNativeId.provenance.messageId = "";
    expect(store.ownedNative.recordFinal(missingNativeId).outcome).toBe("unavailable");
    store.ownedNative.revoke(scope); store.setRecordingEnabled(false);
    expect(store.getMessage(identity)?.text).toBe(firstInput.final.summary);
    expect(store.search({ query: "Retained recommendation" }).total).toBe(1);
    expect(store.exportMarkdown(identity).markdown).toContain(firstInput.final.summary);
    const db = readFileSync(store.path);
    for (const marker of ["HOST-MARKER", "TOOL-RESULT-MARKER", "REASONING-MARKER", "TOOL-ARGS-MARKER", "REVOKED-MARKER", "OLD-EPOCH-MARKER", "LATE-GENERATION-MARKER", "CHANGED-ACCOUNT-MARKER", "synthetic-sensitive-marker", "GENERATED-MARKER"]) expect(db.includes(Buffer.from(marker))).toBe(false);
    expect(store.status()).toMatchObject({ totalMessages: 3, revisions: 3, indexedMessages: 1 });
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
}, 5_000);

test("task-generation privacy revocation survives unavailable Native source and preserves other consent scopes and retained text", () => {
  const home = mkdtempSync(join(tmpdir(), "nekodex-owned-history-unavailable-source-"));
  const scope: OwnedNativeHistoryScope = { taskId: "task-revoke", generation: 1, sourceId: "d".repeat(64), profileId: "profile-revoke", backendAccountId: "account-revoke", authEpoch: "0199a001-0000-7000-8000-000000000004" };
  const alternate = { ...scope, sourceId: "e".repeat(64), backendAccountId: "alternate-account" };
  const otherTask = { ...scope, taskId: "other-task" }, otherGeneration = { ...scope, generation: 2 };
  let current: OwnedNativeHistoryScope | null = scope;
  const store = new ConversationHistoryStore({ coreHome: home, trustedCurrentScope: taskId => taskId === otherTask.taskId ? otherTask : current });
  const consent = (target: OwnedNativeHistoryScope) => store.ownedNative.setConsent({ scope: target, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
  const offer = (target: OwnedNativeHistoryScope, dispatchId: string) => store.ownedNative.lease(target, { dispatchId }).lease;
  const capture = (target: OwnedNativeHistoryScope, lease: ReturnType<typeof offer>, messageId: string) => store.ownedNative.recordFinal({ scope: target, lease, final: { kind: "final", summary: "Already retained private recommendation." },
    provenance: { dispatchId: lease?.dispatchId ?? "unleased-offer", workerBindingId: "binding-retained", workerGeneration: 1, nativeTurnReceiptId: `native-turn:${messageId}`, messageId, turnId: `turn-${messageId}`, threadId: "retained-thread", timestampMs: 1770000000000 } });
  try {
    store.setRecordingEnabled(true);
    for (const target of [scope, alternate, otherTask, otherGeneration]) consent(target);
    const saved = capture(scope, offer(scope, "already-saved"), "saved-message"); expect(saved.outcome).toBe("recorded");
    const pending = offer(scope, "pending-before-source-unavailable"); expect(pending).not.toBeNull();
    const otherTaskPending = offer(otherTask, "other-task-pending");
    current = otherGeneration; const otherGenerationPending = offer(otherGeneration, "other-generation-pending");
    current = null; // The trusted live Native source no longer resolves.
    expect(store.ownedNative.revokeTaskGeneration({ taskId: scope.taskId, generation: scope.generation })).toMatchObject({ revokedScopes: 2, enabled: false, recordingEnabled: true });
    current = scope; // Same source/admission is advertised again.
    expect(capture(scope, pending, "late-old-lease").outcome).toBe("revoked");
    expect(offer(scope, "fresh-offer-after-revoke")).toBeNull();
    expect(store.ownedNative.status(alternate).enabled).toBe(false);
    expect(store.ownedNative.status(otherTask).enabled).toBe(true);
    expect(store.ownedNative.status(otherGeneration).enabled).toBe(true);
    expect(capture(otherTask, otherTaskPending, "other-task-message").outcome).toBe("recorded");
    current = otherGeneration;
    expect(capture(otherGeneration, otherGenerationPending, "other-generation-message").outcome).toBe("recorded");
    const original = store.getMessage({ clientId: `owned-native:${scope.sourceId}`, threadId: "retained-thread", messageId: "saved-message" });
    expect(original?.text).toBe("Already retained private recommendation.");
    expect(store.search({ query: "Already retained private recommendation" }).total).toBe(3);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
}, 5_000);
