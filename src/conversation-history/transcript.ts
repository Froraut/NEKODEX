import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { classifyCanonicalText } from "../../launcher/electron/canonical-history-policy.cjs";
import { provenanceOf, scopeOf } from "./owned-native";
import type { CaptureRecord, HistoryMessage, HistoryStatus, MessageIdentity, OwnedNativeHistoryProvenance, OwnedNativeHistoryScope, RecordResult, TranscriptHistoryMetadata } from "./types";

const POLICY = "canonical-events-v1" as const;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const validId = (value: unknown): value is string => typeof value === "string" && !!value.trim() && Buffer.byteLength(value) <= 512 && !/[\u0000-\u001f]/u.test(value);
export interface TranscriptLease { subscriptionId: string; scope: OwnedNativeHistoryScope; dispatchId: string; consentRevision: number; recordingEpoch: number }
export interface TranscriptSubscriptionStatus {
  scope: OwnedNativeHistoryScope; enabled: boolean; activeSubscriptions: number; recordingEnabled: boolean; quotaReached: boolean;
  consentRevision: number; policyVersion: typeof POLICY; transcriptCoverage: "partial"; mode: "future-authenticated-events"; unknownSecretsPossible: true;
}
export type TranscriptEvent = {
  kind: "upsert"; sourceRevision: string; revisionNumber: number; role: "user" | "assistant";
  author: "human" | "assistant" | "agent" | "unknown"; text: string; coverage: "complete" | "partial";
  coverageReason?: string;
} | { kind: "delete"; sourceRevision: string; revisionNumber: number };
export interface TranscriptEventInput {
  lease: TranscriptLease | null; scope: OwnedNativeHistoryScope; provenance: OwnedNativeHistoryProvenance;
  event: TranscriptEvent;
}
export interface TranscriptHistoryPort {
  subscribe(scope: OwnedNativeHistoryScope, offer: { dispatchId: string }): TranscriptLease | null;
  recordEvent(input: TranscriptEventInput): RecordResult | { outcome: "revoked" | "unavailable" | "deleted" | "stale" };
  release(lease: TranscriptLease | null): void;
}

/** A trusted producer port, not a renderer/HTTP ingestion API. Source adapters
 * must emit authenticated user/assistant text with real IDs; prompt envelopes,
 * reasoning and tools are not events. No transcript discovery or polling. */
export class TranscriptHistoryCapture implements TranscriptHistoryPort {
  private readonly subscriptions = new Map<string, TranscriptLease>();
  constructor(private readonly owner: {
    db: Database; status: () => HistoryStatus; record: (record: CaptureRecord) => RecordResult;
    getMessage: (identity: MessageIdentity) => HistoryMessage | null;
    deleteMessage: (identity: MessageIdentity) => { deletedMessages: number };
    trustedCurrentScope?: (taskId: string) => OwnedNativeHistoryScope | null;
  }) {
    owner.db.exec(`CREATE TABLE IF NOT EXISTS transcript_history_consent(scope_key TEXT PRIMARY KEY,scope_json TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS transcript_history_watermark(message_key TEXT PRIMARY KEY,scope_key TEXT NOT NULL,revision_number INTEGER NOT NULL,source_revision TEXT NOT NULL,event_digest TEXT NOT NULL);`);
  }
  private consent(scope: OwnedNativeHistoryScope) { return this.owner.db.query("SELECT enabled,revision FROM transcript_history_consent WHERE scope_key=?").get(digest(scope)) as { enabled: number; revision: number } | null; }
  status(input: OwnedNativeHistoryScope): TranscriptSubscriptionStatus {
    const scope = scopeOf(input), consent = this.consent(scope), global = this.owner.status();
    return { scope, enabled: consent?.enabled === 1, activeSubscriptions: [...this.subscriptions.values()].filter(row => same(row.scope, scope) && this.active(row)).length,
      recordingEnabled: global.recordingEnabled, quotaReached: global.quotaReached, consentRevision: consent?.revision ?? 0,
      policyVersion: POLICY, mode: "future-authenticated-events", transcriptCoverage: "partial", unknownSecretsPossible: true };
  }
  list(): TranscriptSubscriptionStatus[] {
    const rows = this.owner.db.query("SELECT scope_json FROM transcript_history_consent LIMIT 257").all() as Array<{ scope_json: string }>;
    if (rows.length > 256) throw new Error("Transcript consent metadata exceeds its bound");
    return rows.map(row => this.status(scopeOf(JSON.parse(row.scope_json))));
  }
  setConsent(input: { scope: OwnedNativeHistoryScope; enabled: boolean; consent?: boolean; acknowledgeUnknownSecrets?: boolean }) {
    const scope = scopeOf(input.scope);
    if (typeof input.enabled !== "boolean" || input.enabled && (!this.owner.status().recordingEnabled || input.consent !== true || input.acknowledgeUnknownSecrets !== true)) throw new Error("Separate transcript opt-in and unknown-secret-risk acknowledgement are required");
    if (!this.consent(scope) && (this.owner.db.query("SELECT COUNT(*) AS n FROM transcript_history_consent").get() as { n: number }).n >= 256) throw new Error("Transcript consent quota reached; retained history is preserved");
    this.owner.db.query("INSERT INTO transcript_history_consent VALUES(?,?,?,1) ON CONFLICT(scope_key) DO UPDATE SET enabled=excluded.enabled,revision=transcript_history_consent.revision+1").run(digest(scope), JSON.stringify(scope), input.enabled ? 1 : 0);
    for (const [key, lease] of this.subscriptions) if (same(lease.scope, scope)) this.subscriptions.delete(key);
    return this.status(scope);
  }
  revokeTaskGeneration(input: { taskId: string; generation: number }) {
    if (!validId(input.taskId) || !Number.isSafeInteger(input.generation) || input.generation < 1) throw new Error("Invalid transcript task generation");
    let revokedScopes = 0;
    for (const state of this.list()) if (state.scope.taskId === input.taskId && state.scope.generation === input.generation) {
      this.setConsent({ scope: state.scope, enabled: false }); revokedScopes++;
    }
    return { enabled: false, revokedScopes };
  }
  private active(lease: TranscriptLease): boolean {
    const global = this.owner.status(), consent = this.consent(lease.scope);
    const current = this.owner.trustedCurrentScope?.(lease.scope.taskId);
    const epoch = (this.owner.db.query("SELECT recording_epoch FROM settings WHERE id=1").get() as { recording_epoch: number }).recording_epoch;
    return !!current && same(scopeOf(current), lease.scope) && global.recordingEnabled && !global.quotaReached && consent?.enabled === 1 && consent.revision === lease.consentRevision && epoch === lease.recordingEpoch;
  }
  subscribe(input: OwnedNativeHistoryScope, offer: { dispatchId: string }): TranscriptLease | null {
    const scope = scopeOf(input), consent = this.consent(scope);
    if (!validId(offer?.dispatchId)) throw new Error("Invalid transcript dispatch");
    // Revoked/account-changed subscriptions have no capture authority and can be discarded.
    for (const [key, lease] of this.subscriptions) if (!this.active(lease)) this.subscriptions.delete(key);
    if (this.subscriptions.size >= 256) return null;
    const lease: TranscriptLease = { subscriptionId: randomUUID(), scope, dispatchId: offer.dispatchId, consentRevision: consent?.revision ?? 0,
      recordingEpoch: (this.owner.db.query("SELECT recording_epoch FROM settings WHERE id=1").get() as { recording_epoch: number }).recording_epoch };
    if (!this.active(lease)) return null;
    this.subscriptions.set(lease.subscriptionId, structuredClone(lease)); return lease;
  }
  release(lease: TranscriptLease | null) { if (lease) this.subscriptions.delete(lease.subscriptionId); }
  close() { this.subscriptions.clear(); }
  recordEvent(input: TranscriptEventInput): ReturnType<TranscriptHistoryPort["recordEvent"]> {
    try {
      if (!input.lease) return { outcome: "disabled" };
      const lease = this.subscriptions.get(input.lease.subscriptionId);
      if (!lease || !same(lease, input.lease) || !same(scopeOf(input.scope), lease.scope) || !this.active(lease)) return { outcome: "revoked" };
      const provenance = provenanceOf(input.provenance), event = input.event;
      if (provenance.dispatchId !== lease.dispatchId) return { outcome: "revoked" };
      if (!event || !["upsert", "delete"].includes(event.kind) || !validId(event.sourceRevision) || !Number.isSafeInteger(event.revisionNumber) || event.revisionNumber < 1) return { outcome: "unavailable" };
      const identity = { clientId: `canonical-events:${lease.scope.sourceId}:${digest(lease.scope).slice(0, 16)}`, threadId: provenance.threadId, messageId: provenance.messageId };
      let text = "", originalBytes = 0, exclusionReason: string | null = null;
      if (event.kind === "upsert") {
        if (!["user", "assistant"].includes(event.role) || !["human", "assistant", "agent", "unknown"].includes(event.author) || !["complete", "partial"].includes(event.coverage) || typeof event.text !== "string" || Buffer.byteLength(event.text) > 512 * 1024 || event.coverage === "partial" && (!event.coverageReason || Buffer.byteLength(event.coverageReason) > 1024)) return { outcome: "unavailable" };
        originalBytes = Buffer.byteLength(event.text); exclusionReason = classifyCanonicalText(event.text); text = exclusionReason ? "" : event.text;
      }
      const eventDigest = digest({ kind: event.kind, sourceRevision: event.sourceRevision, revisionNumber: event.revisionNumber, ...(event.kind === "upsert" ? { role: event.role, author: event.author, text, coverage: event.coverage, coverageReason: event.coverageReason, originalBytes, exclusionReason } : {}) });
      return this.owner.db.transaction(() => {
        if (!this.active(lease)) return { outcome: "revoked" as const };
        const messageKey = JSON.stringify([identity.clientId, identity.threadId, identity.messageId]);
        const previous = this.owner.db.query("SELECT revision_number,event_digest FROM transcript_history_watermark WHERE message_key=?").get(messageKey) as { revision_number: number; event_digest: string } | null;
        if (previous && event.revisionNumber <= previous.revision_number) {
          if (event.revisionNumber === previous.revision_number && eventDigest !== previous.event_digest) return { outcome: "unavailable" as const };
          return { outcome: "stale" as const };
        }
        if (!previous && (this.owner.db.query("SELECT COUNT(*) AS n FROM transcript_history_watermark").get() as { n: number }).n >= 10000) return { outcome: "unavailable" as const };
        let result: ReturnType<TranscriptHistoryPort["recordEvent"]>;
        if (event.kind === "delete") { this.owner.deleteMessage(identity); result = { outcome: "deleted" }; }
        else {
          const transcript: TranscriptHistoryMetadata = { policyVersion: POLICY, scope: lease.scope, provenance, sourceRevision: event.sourceRevision, originalBytes, exclusionReason };
          result = this.owner.record({ ...identity, revisionId: `event:${event.revisionNumber}:${eventDigest}`, revisionNumber: event.revisionNumber, turnId: provenance.turnId,
            compactionId: null, role: event.role, author: event.author, source: "native", text, timestamp: provenance.timestampMs, coverage: event.coverage,
            ...(event.coverageReason ? { coverageReason: event.coverageReason } : {}), capturePolicy: POLICY, sensitivity: "known-pattern-filtered", transcript });
        }
        if (result.outcome !== "quota-reached" && result.outcome !== "disabled") this.owner.db.query("INSERT INTO transcript_history_watermark VALUES(?,?,?,?,?) ON CONFLICT(message_key) DO UPDATE SET revision_number=excluded.revision_number,source_revision=excluded.source_revision,event_digest=excluded.event_digest").run(messageKey, digest(lease.scope), event.revisionNumber, event.sourceRevision, eventDigest);
        return result;
      }).immediate();
    } catch { return { outcome: "unavailable" }; }
  }
}

export function validatedTranscriptMetadata(value: TranscriptHistoryMetadata): TranscriptHistoryMetadata {
  if (!value || value.policyVersion !== POLICY || !validId(value.sourceRevision) || !Number.isSafeInteger(value.originalBytes) || value.originalBytes < 0 || value.originalBytes > 512 * 1024 || value.exclusionReason !== null && !["known-secret-content", "generated-instructions-or-schema"].includes(value.exclusionReason)) throw new Error("Invalid canonical event metadata");
  return { policyVersion: POLICY, scope: scopeOf(value.scope), provenance: provenanceOf(value.provenance), sourceRevision: value.sourceRevision, originalBytes: value.originalBytes, exclusionReason: value.exclusionReason };
}
