import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { classifyCanonicalText } from "../../launcher/electron/canonical-history-policy.cjs";
import type { CaptureRecord, HistoryMessage, HistoryStatus, MessageIdentity, OwnedNativeHistoryMetadata, OwnedNativeHistoryProvenance, OwnedNativeHistoryScope, RecordResult } from "./types";

export type { OwnedNativeHistoryScope, OwnedNativeHistoryProvenance } from "./types";
export const OWNED_NATIVE_HISTORY_POLICY = "owned-native-final-summary-v1" as const;
const FILTER = "known-pattern-filter-v1" as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const MAX_POLICIES = 256, MAX_LEASES = 256, MAX_SUMMARY_BYTES = 16_384;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 512 || /[\u0000-\u001f]/u.test(value)) throw new Error("Invalid owned Native history identity");
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error("Invalid owned Native history generation/timestamp");
}
function scopeOf(value: OwnedNativeHistoryScope): OwnedNativeHistoryScope {
  if (!value || typeof value !== "object") throw new Error("Owned Native history scope required");
  for (const key of ["taskId", "profileId", "backendAccountId"] as const) id(value[key]);
  integer(value.generation, 1);
  if (typeof value.sourceId !== "string" || !HASH.test(value.sourceId) || typeof value.authEpoch !== "string" || !UUID.test(value.authEpoch)) throw new Error("Invalid main-admitted Native history source");
  return { taskId: value.taskId, generation: value.generation, sourceId: value.sourceId, profileId: value.profileId, backendAccountId: value.backendAccountId, authEpoch: value.authEpoch };
}
function provenanceOf(value: OwnedNativeHistoryProvenance): OwnedNativeHistoryProvenance {
  if (!value || typeof value !== "object") throw new Error("Owned Native history provenance required");
  for (const key of ["dispatchId", "workerBindingId", "nativeTurnReceiptId", "messageId", "turnId", "threadId"] as const) id(value[key]);
  integer(value.workerGeneration, 1); integer(value.timestampMs);
  return { dispatchId: value.dispatchId, workerBindingId: value.workerBindingId, workerGeneration: value.workerGeneration, nativeTurnReceiptId: value.nativeTurnReceiptId,
    messageId: value.messageId, turnId: value.turnId, threadId: value.threadId, timestampMs: value.timestampMs };
}
const sameScope = (a: OwnedNativeHistoryScope, b: OwnedNativeHistoryScope) => JSON.stringify(a) === JSON.stringify(b);
export interface OwnedNativeCaptureLease {
  leaseId: string; scope: OwnedNativeHistoryScope; dispatchId: string; consentRevision: number;
  recordingEpoch: number; policyVersion: typeof OWNED_NATIVE_HISTORY_POLICY;
}
export interface OwnedNativeHistoryStatus {
  scope: OwnedNativeHistoryScope; policyVersion: typeof OWNED_NATIVE_HISTORY_POLICY;
  recordingEnabled: boolean; quotaReached: boolean; enabled: boolean; consentRevision: number;
  mode: "future-validated-final-summaries"; transcriptCoverage: "partial"; unknownSecretsPossible: true;
}
export interface OwnedNativeFinalCapture {
  lease: OwnedNativeCaptureLease | null;
  scope: OwnedNativeHistoryScope;
  /** Already parsed/validated final branch only. Never the Native JSON envelope. */
  final: { kind: "final"; summary: string };
  provenance: OwnedNativeHistoryProvenance;
  /** Trusted composition-root resolution at write time. Never incoming HTTP proof.
   * Ignored when the owner supplied a trustedCurrentScope resolver. */
  currentScope?: OwnedNativeHistoryScope | null;
}
export type OwnedNativeFinalRecordResult = RecordResult | { outcome: "revoked" | "unavailable" };
export interface OwnedNativeHistoryPort {
  lease(scope: OwnedNativeHistoryScope, offer: { dispatchId: string }): { lease: OwnedNativeCaptureLease | null; status: OwnedNativeHistoryStatus };
  recordFinal(input: OwnedNativeFinalCapture): OwnedNativeFinalRecordResult;
  /** Finally after terminal/aborted capture processing, including non-final offers. */
  release(lease: OwnedNativeCaptureLease | null): void;
}
type Consent = { enabled: number; revision: number; acknowledged: number };

/** Synchronous leaf of the one history SQLite owner. Captures only a bounded
 * final.summary projection, with no host inputs, tools, reasoning or watchers. */
export class OwnedNativeHistoryCapture implements OwnedNativeHistoryPort {
  private readonly leases = new Map<string, OwnedNativeCaptureLease>();
  private readonly completedLeases = new Set<string>();
  constructor(private readonly owner: {
    db: Database; record: (record: CaptureRecord) => RecordResult;
    getMessage: (identity: MessageIdentity & { revisionId?: string }) => HistoryMessage | null;
    status: () => HistoryStatus;
    trustedCurrentScope?: (taskId: string) => OwnedNativeHistoryScope | null;
  }) {
    owner.db.exec(`CREATE TABLE IF NOT EXISTS owned_native_history_consent (
      scope_key TEXT PRIMARY KEY, scope_json TEXT NOT NULL, enabled INTEGER NOT NULL,
      revision INTEGER NOT NULL, acknowledged INTEGER NOT NULL);`);
  }
  private consent(scope: OwnedNativeHistoryScope): Consent | null {
    return this.owner.db.query("SELECT enabled,revision,acknowledged FROM owned_native_history_consent WHERE scope_key=?").get(digest(scope)) as Consent | null;
  }
  status(input: OwnedNativeHistoryScope): OwnedNativeHistoryStatus {
    const scope = scopeOf(input), consent = this.consent(scope), global = this.owner.status();
    return { scope, policyVersion: OWNED_NATIVE_HISTORY_POLICY, recordingEnabled: global.recordingEnabled, quotaReached: global.quotaReached,
      enabled: consent?.enabled === 1 && consent.acknowledged === 1, consentRevision: consent?.revision ?? 0,
      mode: "future-validated-final-summaries", transcriptCoverage: "partial", unknownSecretsPossible: true };
  }
  setConsent(input: { scope: OwnedNativeHistoryScope; enabled: boolean; consent?: boolean; acknowledgeUnknownSecrets?: boolean }): OwnedNativeHistoryStatus {
    const scope = scopeOf(input.scope);
    if (typeof input.enabled !== "boolean" || input.enabled && (!this.owner.status().recordingEnabled || input.consent !== true || input.acknowledgeUnknownSecrets !== true)) throw new Error("Global recording opt-in, exact task-generation consent and unknown-secret-risk acknowledgement are required");
    if (!this.consent(scope) && (this.owner.db.query("SELECT COUNT(*) AS n FROM owned_native_history_consent").get() as { n: number }).n >= MAX_POLICIES) throw new Error("Owned Native history consent quota reached; retained history is preserved");
    this.owner.db.query("INSERT INTO owned_native_history_consent(scope_key,scope_json,enabled,revision,acknowledged) VALUES(?,?,?,1,?) ON CONFLICT(scope_key) DO UPDATE SET enabled=excluded.enabled,revision=owned_native_history_consent.revision+1,acknowledged=excluded.acknowledged")
      .run(digest(scope), JSON.stringify(scope), input.enabled ? 1 : 0, input.enabled ? 1 : 0);
    // Revocation/reconfirmation invalidates every prior lease of this exact scope.
    for (const [key, lease] of this.leases) if (sameScope(lease.scope, scope)) { this.leases.delete(key); this.completedLeases.delete(key); }
    return this.status(scope);
  }
  revoke(scope: OwnedNativeHistoryScope): OwnedNativeHistoryStatus { return this.setConsent({ scope, enabled: false }); }
  /** Trusted root already validated the actual task generation. Revocation must
   * remain effective when its Native source is temporarily unadvertised. This
   * reads only bounded private consent metadata, never retained message text. */
  revokeTaskGeneration(input: { taskId: string; generation: number }) {
    id(input?.taskId); integer(input?.generation, 1);
    const matches = (scope: OwnedNativeHistoryScope) => scope.taskId === input.taskId && scope.generation === input.generation;
    const result = this.owner.db.transaction(() => {
      const rows = this.owner.db.query("SELECT scope_key,scope_json,enabled FROM owned_native_history_consent LIMIT ?").all(MAX_POLICIES + 1) as Array<{ scope_key: string; scope_json: string; enabled: number }>;
      if (rows.length > MAX_POLICIES) throw new Error("Owned Native history consent metadata exceeds its bound");
      let revokedScopes = 0;
      for (const row of rows) if (matches(scopeOf(JSON.parse(row.scope_json)))) {
        this.owner.db.query("UPDATE owned_native_history_consent SET enabled=0,acknowledged=0,revision=revision+1 WHERE scope_key=?").run(row.scope_key);
        if (row.enabled === 1) revokedScopes++;
      }
      const global = this.owner.status();
      return { taskId: input.taskId, generation: input.generation, revokedScopes, enabled: false as const,
        recordingEnabled: global.recordingEnabled, quotaReached: global.quotaReached, policyVersion: OWNED_NATIVE_HISTORY_POLICY,
        mode: "future-validated-final-summaries" as const, transcriptCoverage: "partial" as const, unknownSecretsPossible: true as const };
    }).immediate();
    for (const [key, lease] of this.leases) if (matches(lease.scope)) { this.leases.delete(key); this.completedLeases.delete(key); }
    return result;
  }
  release(lease: OwnedNativeCaptureLease | null): void {
    if (!lease) return;
    this.leases.delete(lease.leaseId); this.completedLeases.delete(lease.leaseId);
  }
  lease(input: OwnedNativeHistoryScope, offer: { dispatchId: string }): { lease: OwnedNativeCaptureLease | null; status: OwnedNativeHistoryStatus } {
    const scope = scopeOf(input), status = this.status(scope);
    id(offer?.dispatchId);
    // Keep active offers; only old terminal observations can leave the bounded
    // duplicate-observation cache. Eviction can never authorize another write.
    if (this.leases.size >= MAX_LEASES) for (const key of this.completedLeases) {
      this.leases.delete(key); this.completedLeases.delete(key); if (this.leases.size < MAX_LEASES) break;
    }
    if (!status.enabled || !status.recordingEnabled || status.quotaReached || this.leases.size >= MAX_LEASES) return { lease: null, status };
    if (this.owner.trustedCurrentScope) {
      const current = this.owner.trustedCurrentScope(scope.taskId);
      if (!current || !sameScope(scope, scopeOf(current))) return { lease: null, status };
    }
    const recordingEpoch = (this.owner.db.query("SELECT recording_epoch FROM settings WHERE id=1").get() as { recording_epoch: number }).recording_epoch;
    const lease: OwnedNativeCaptureLease = { leaseId: randomUUID(), scope, dispatchId: offer.dispatchId, consentRevision: status.consentRevision, recordingEpoch, policyVersion: OWNED_NATIVE_HISTORY_POLICY };
    this.leases.set(lease.leaseId, structuredClone(lease));
    return { lease, status };
  }
  /** History failures never change/retry Native execution or discard its receipt.
   * An absent/revoked/old lease is terminal for capture of that offered turn. */
  recordFinal(input: OwnedNativeFinalCapture): OwnedNativeFinalRecordResult {
    try {
      if (!input.lease) return { outcome: "disabled" };
      const supplied = input.lease, lease = this.leases.get(supplied.leaseId);
      if (!lease || JSON.stringify(lease) !== JSON.stringify(supplied)) return { outcome: "revoked" };
      const scope = scopeOf(input.scope);
      const current = this.owner.trustedCurrentScope ? this.owner.trustedCurrentScope(scope.taskId) : input.currentScope;
      if (!sameScope(lease.scope, scope) || !current || !sameScope(scope, scopeOf(current))) return { outcome: "revoked" };
      if (input.final?.kind !== "final" || typeof input.final.summary !== "string" || !input.final.summary.trim() || Buffer.byteLength(input.final.summary) > MAX_SUMMARY_BYTES) return { outcome: "unavailable" };
      const provenance = provenanceOf(input.provenance);
      if (provenance.dispatchId !== lease.dispatchId) return { outcome: "revoked" };
      const result = this.owner.db.transaction((): OwnedNativeFinalRecordResult => {
        const state = this.status(scope), epoch = (this.owner.db.query("SELECT recording_epoch FROM settings WHERE id=1").get() as { recording_epoch: number }).recording_epoch;
        if (!state.recordingEnabled || !state.enabled || epoch !== lease.recordingEpoch || state.consentRevision !== lease.consentRevision) return { outcome: "revoked" };
        const reason = classifyCanonicalText(input.final.summary), originalBytes = Buffer.byteLength(input.final.summary);
        // Excluded bodies are never retained or hashed. Fingerprint the safe projection only.
        const text = reason ? "" : input.final.summary;
        const fingerprint = digest({ policy: OWNED_NATIVE_HISTORY_POLICY, scope, provenance, text, originalBytes, exclusionReason: reason });
        const identity = { clientId: `owned-native:${scope.sourceId}`, threadId: provenance.threadId, messageId: provenance.messageId };
        const revisionId = `owned-native:${fingerprint}`, duplicate = this.owner.getMessage({ ...identity, revisionId });
        if (duplicate) return { outcome: "duplicate", latest: this.owner.getMessage(identity)?.revisionId === revisionId, message: duplicate };
        const prior = this.owner.getMessage(identity);
        const ownedNative: OwnedNativeHistoryMetadata = { policyVersion: OWNED_NATIVE_HISTORY_POLICY, filterPolicyVersion: FILTER, scope, provenance, fingerprint, originalBytes, exclusionReason: reason };
        return this.owner.record({ ...identity, revisionId, revisionNumber: (prior?.revisionNumber ?? 0) + 1, turnId: provenance.turnId, compactionId: null,
          role: "assistant", author: "agent", source: "native", text, timestamp: provenance.timestampMs, coverage: "partial",
          coverageReason: "validated-owned-native-final-summary-projection", capturePolicy: OWNED_NATIVE_HISTORY_POLICY, sensitivity: "known-pattern-filtered", ownedNative });
      }).immediate();
      this.completedLeases.add(lease.leaseId);
      return result;
    } catch { return { outcome: "unavailable" }; }
  }
}

/** Store validation/whitelist for private metadata; arbitrary caller extras are discarded. */
export function validatedOwnedNativeMetadata(value: OwnedNativeHistoryMetadata): OwnedNativeHistoryMetadata {
  if (!value || value.policyVersion !== OWNED_NATIVE_HISTORY_POLICY || value.filterPolicyVersion !== FILTER || !HASH.test(value.fingerprint)) throw new Error("Invalid owned Native history metadata");
  integer(value.originalBytes);
  if (value.originalBytes > MAX_SUMMARY_BYTES || value.exclusionReason !== null && !["known-secret-content", "generated-instructions-or-schema"].includes(value.exclusionReason)) throw new Error("Invalid owned Native history filtering metadata");
  return { policyVersion: OWNED_NATIVE_HISTORY_POLICY, filterPolicyVersion: FILTER, scope: scopeOf(value.scope), provenance: provenanceOf(value.provenance), fingerprint: value.fingerprint, originalBytes: value.originalBytes, exclusionReason: value.exclusionReason };
}
