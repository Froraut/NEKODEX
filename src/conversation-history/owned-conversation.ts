import type { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { classifyCanonicalText } from "../../launcher/electron/canonical-history-policy.cjs";
import type { CaptureRecord, HistoryMessage, HistoryStatus, MessageIdentity, OwnedConversationHistoryMetadata, OwnedConversationHistoryProvenance, OwnedConversationHistoryScope, RecordResult } from "./types";

export const OWNED_CONVERSATION_POLICY = "owned-conversation-text-v1" as const;
const MAX_SCOPES = 256, MAX_WATERMARKS = 10000, MAX_TEXT = 512 * 1024;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function exclusionOf(text: string): OwnedConversationHistoryMetadata["exclusionReason"] {
  // A legacy NEKO Agent machine reply is never canonical conversation text,
  // even if an adapter accidentally labels its outer item as assistant text.
  if (/"protocol"\s*:\s*"neko-agent-v1"/u.test(text)) return "generated-instructions-or-schema" as const;
  const reason = classifyCanonicalText(text);
  if (reason === null || reason === "known-secret-content" || reason === "generated-instructions-or-schema") return reason;
  throw new Error("Unsupported canonical exclusion policy");
}
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 512 || /[\u0000-\u001f]/u.test(value)) throw new Error("Invalid owned conversation identity");
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error("Invalid owned conversation observation position");
}
export function ownedConversationScope(value: OwnedConversationHistoryScope): OwnedConversationHistoryScope {
  if (!value || value.kind !== "owned-conversation" || value.mode !== "canonical-text-v1") throw new Error("Explicit owned canonical conversation mode required");
  for (const field of ["conversationId", "threadId", "profileId", "backendAccountId", "authEpoch", "serverGeneration", "workerBindingId"] as const) id(value[field]);
  if (!uuid.test(value.conversationId) || !uuid.test(value.profileId) || !uuid.test(value.authEpoch) || !uuid.test(value.serverGeneration) || !uuid.test(value.workerBindingId) || !/^[a-f0-9]{64}$/.test(value.sourceId)) throw new Error("Invalid owned conversation binding");
  integer(value.workerGeneration, 1);
  return { kind: value.kind, mode: value.mode, conversationId: value.conversationId, threadId: value.threadId, sourceId: value.sourceId, profileId: value.profileId, backendAccountId: value.backendAccountId, authEpoch: value.authEpoch, serverGeneration: value.serverGeneration, workerBindingId: value.workerBindingId, workerGeneration: value.workerGeneration };
}
function provenanceOf(value: OwnedConversationHistoryProvenance | undefined): OwnedConversationHistoryProvenance {
  if (!value) throw new Error("Canonical conversation provenance required");
  for (const field of ["actionId", "nativeActionId", "serverGeneration", "workerBindingId", "messageId", "turnId", "threadId"] as const) id(value[field]);
  integer(value.workerGeneration, 1); integer(value.timestampMs);
  return { actionId: value.actionId, nativeActionId: value.nativeActionId, serverGeneration: value.serverGeneration, workerBindingId: value.workerBindingId, workerGeneration: value.workerGeneration, messageId: value.messageId, turnId: value.turnId, threadId: value.threadId, timestampMs: value.timestampMs };
}
export interface OwnedConversationLease {
  leaseId: string; scope: OwnedConversationHistoryScope; actionId: string; nativeActionId: string;
  afterCursor: number; captureEpoch: string; consentRevision: number; recordingEpoch: number;
  policyVersion: typeof OWNED_CONVERSATION_POLICY;
}
export type OwnedConversationEvent = {
  kind: "upsert"; cursor: number; itemId: string; sourceRevision: string; revisionNumber: number;
  role: "user" | "assistant"; attribution: OwnedConversationHistoryMetadata["attribution"];
  text: string; coverage: "complete" | "partial"; coverageReason?: string;
  originalBytes: number; exclusionReason: OwnedConversationHistoryMetadata["exclusionReason"];
  phase: OwnedConversationHistoryMetadata["phase"];
} | { kind: "delete"; cursor: number; itemId: string; sourceRevision: string; revisionNumber: number }
  | { kind: "gap"; cursor: number; reason: string };
export type OwnedConversationRecordInput = {lease: OwnedConversationLease | null; scope: OwnedConversationHistoryScope} & (
  {event: Extract<OwnedConversationEvent,{kind:"gap"}>;provenance?:OwnedConversationHistoryProvenance}
  | {event: Exclude<OwnedConversationEvent,{kind:"gap"}>;provenance:OwnedConversationHistoryProvenance}
);
export type OwnedConversationRecordResult = RecordResult | { outcome: "revoked" | "unavailable" | "deleted" | "stale" | "gap" };
export interface OwnedConversationStatus {
  scope: OwnedConversationHistoryScope; policyVersion: typeof OWNED_CONVERSATION_POLICY;
  enabled: boolean; consentRevision: number; recordingEnabled: boolean; quotaReached: boolean; available: boolean;
  activeSubscriptions: number; mode: "future-supported-owned-conversation-text";
  transcriptCoverage: "partial"; unknownSecretsPossible: true; positionAuthority: "local-observation";
  lastCursor: number | null; captureEpoch: string | null; gapCount: number; lastGapReason: string | null;
  retention: "explicit-deletion-only"; externalClientsSupported: false;
  historyThread: {clientId:string;threadId:string};
}

/** Leaf of the existing SQLite owner. Only the authenticated main producer may
 * obtain leases or ingest events. Persisted consent grants no restart replay. */
export class OwnedConversationHistoryCapture {
  private readonly leases = new Map<string, OwnedConversationLease>();
  constructor(private readonly owner: {
    db: Database; status: () => HistoryStatus; record: (record: CaptureRecord) => RecordResult;
    getMessage: (identity: MessageIdentity) => HistoryMessage | null;
    deleteMessage: (identity: MessageIdentity) => { deletedMessages: number };
    trustedCurrentScope?: (conversationId: string) => OwnedConversationHistoryScope | null;
  }) {
    owner.db.exec(`CREATE TABLE IF NOT EXISTS owned_conversation_consent(scope_key TEXT PRIMARY KEY,scope_json TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owned_conversation_guard(id INTEGER PRIMARY KEY CHECK(id=1),revocation_epoch INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO owned_conversation_guard(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS owned_conversation_position(scope_key TEXT PRIMARY KEY,capture_epoch TEXT NOT NULL,last_cursor INTEGER NOT NULL,gap_count INTEGER NOT NULL DEFAULT 0,last_gap_reason TEXT);
      CREATE TABLE IF NOT EXISTS owned_conversation_watermark(message_key TEXT PRIMARY KEY,scope_key TEXT NOT NULL,revision_number INTEGER NOT NULL,source_revision TEXT NOT NULL,event_digest TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,locally_deleted INTEGER NOT NULL DEFAULT 0);`);
  }
  private consent(scope: OwnedConversationHistoryScope) { return this.owner.db.query("SELECT enabled,revision FROM owned_conversation_consent WHERE scope_key=?").get(hash(scope)) as {enabled:number;revision:number} | null; }
  private current(scope: OwnedConversationHistoryScope) {
    const current = this.owner.trustedCurrentScope?.(scope.conversationId);
    return !!current && same(ownedConversationScope(current), scope);
  }
  private recordingEpoch() { return (this.owner.db.query("SELECT recording_epoch FROM settings WHERE id=1").get() as {recording_epoch:number}).recording_epoch; }
  /** Capture before an async public selection lookup. A later privacy revoke or
   * recording transition invalidates that older request's enabling intent. */
  admissionFence() { return `${this.recordingEpoch()}:${(this.owner.db.query("SELECT revocation_epoch FROM owned_conversation_guard WHERE id=1").get() as {revocation_epoch:number}).revocation_epoch}`; }
  private active(lease: OwnedConversationLease) {
    const state = this.owner.status(), consent = this.consent(lease.scope);
    return state.recordingEnabled && !state.quotaReached && consent?.enabled === 1 && consent.revision === lease.consentRevision && this.recordingEpoch() === lease.recordingEpoch && this.current(lease.scope);
  }
  status(input: OwnedConversationHistoryScope): OwnedConversationStatus {
    const scope = ownedConversationScope(input), consent = this.consent(scope), global = this.owner.status();
    const position = this.owner.db.query("SELECT capture_epoch,last_cursor,gap_count,last_gap_reason FROM owned_conversation_position WHERE scope_key=?").get(hash(scope)) as {capture_epoch:string;last_cursor:number;gap_count:number;last_gap_reason:string|null} | null;
    return { scope, policyVersion: OWNED_CONVERSATION_POLICY, enabled: consent?.enabled === 1, consentRevision: consent?.revision ?? 0,
      recordingEnabled: global.recordingEnabled, quotaReached: global.quotaReached, available: this.current(scope), activeSubscriptions: [...this.leases.values()].filter(row => same(row.scope, scope) && this.active(row)).length,
      mode: "future-supported-owned-conversation-text", transcriptCoverage: "partial", unknownSecretsPossible: true, positionAuthority: "local-observation",
      lastCursor: position?.last_cursor ?? null, captureEpoch: position?.capture_epoch ?? null, gapCount: position?.gap_count ?? 0, lastGapReason: position?.last_gap_reason ?? null,
      retention: "explicit-deletion-only", externalClientsSupported: false, historyThread:{clientId:`owned-conversation:${hash(scope)}`,threadId:scope.threadId} };
  }
  list() {
    const rows = this.owner.db.query("SELECT scope_json FROM owned_conversation_consent LIMIT ?").all(MAX_SCOPES + 1) as Array<{scope_json:string}>;
    if (rows.length > MAX_SCOPES) throw new Error("Owned conversation consent bound exceeded");
    return rows.map(row => this.status(JSON.parse(row.scope_json)));
  }
  setConsent(input: {scope:OwnedConversationHistoryScope;enabled:boolean;consent?:boolean;acknowledgeUnknownSecrets?:boolean}) {
    const scope = ownedConversationScope(input.scope);
    if (typeof input.enabled !== "boolean" || input.enabled && (!this.current(scope) || !this.owner.status().recordingEnabled || input.consent !== true || input.acknowledgeUnknownSecrets !== true)) throw new Error("Current owned conversation, global recording consent and separate future text/unknown-secret acknowledgement required");
    if (!this.consent(scope) && (this.owner.db.query("SELECT COUNT(*) AS n FROM owned_conversation_consent").get() as {n:number}).n >= MAX_SCOPES) throw new Error("Owned conversation consent quota reached; retained history preserved");
    this.owner.db.query("INSERT INTO owned_conversation_consent VALUES(?,?,?,1) ON CONFLICT(scope_key) DO UPDATE SET enabled=excluded.enabled,revision=owned_conversation_consent.revision+1").run(hash(scope), JSON.stringify(scope), input.enabled ? 1 : 0);
    for (const [key, lease] of this.leases) if (same(lease.scope, scope)) this.leases.delete(key);
    return this.status(scope);
  }
  revokeConversation(input: {conversationId:string}) {
    id(input.conversationId); let revokedScopes = 0;
    this.owner.db.transaction(() => {
      this.owner.db.query("UPDATE owned_conversation_guard SET revocation_epoch=revocation_epoch+1 WHERE id=1").run();
      for (const row of this.list()) if (row.scope.conversationId === input.conversationId) { this.setConsent({scope:row.scope,enabled:false}); revokedScopes++; }
    }).immediate();
    return { enabled:false as const, revokedScopes };
  }
  begin(input: {scope:OwnedConversationHistoryScope;actionId:string;nativeActionId:string;afterCursor:number;captureEpoch:string}) {
    const scope = ownedConversationScope(input.scope); id(input.actionId); id(input.nativeActionId); integer(input.afterCursor);
    if (!uuid.test(input.captureEpoch)) throw new Error("Invalid producer observation epoch");
    for (const [key, row] of this.leases) if (!this.active(row)) this.leases.delete(key);
    const status = this.status(scope);
    if (!status.enabled || !status.available || !status.recordingEnabled || status.quotaReached || this.leases.size >= MAX_SCOPES) return {lease:null,status};
    // A scope has one producer epoch. A changed producer cannot replay an old
    // cursor or retain a previous lease, even while the account stays the same.
    const key = hash(scope), previous = this.owner.db.query("SELECT capture_epoch,last_cursor FROM owned_conversation_position WHERE scope_key=?").get(key) as {capture_epoch:string;last_cursor:number} | null;
    if (previous?.capture_epoch === input.captureEpoch && input.afterCursor < previous.last_cursor) throw new Error("Producer cursor regressed");
    for (const [leaseId, row] of this.leases) if (same(row.scope, scope) && row.captureEpoch !== input.captureEpoch) this.leases.delete(leaseId);
    if (!previous) this.owner.db.query("INSERT INTO owned_conversation_position(scope_key,capture_epoch,last_cursor) VALUES(?,?,?)").run(key,input.captureEpoch,input.afterCursor);
    else if (previous.capture_epoch !== input.captureEpoch) this.owner.db.query("UPDATE owned_conversation_position SET capture_epoch=?,last_cursor=?,gap_count=gap_count+1,last_gap_reason='producer-restarted' WHERE scope_key=?").run(input.captureEpoch,input.afterCursor,key);
    else if (input.afterCursor > previous.last_cursor) this.owner.db.query("UPDATE owned_conversation_position SET last_cursor=?,gap_count=gap_count+1,last_gap_reason='capture-inactive' WHERE scope_key=?").run(input.afterCursor,key);
    const lease: OwnedConversationLease = {leaseId:randomUUID(),scope,actionId:input.actionId,nativeActionId:input.nativeActionId,afterCursor:input.afterCursor,captureEpoch:input.captureEpoch,consentRevision:status.consentRevision,recordingEpoch:this.recordingEpoch(),policyVersion:OWNED_CONVERSATION_POLICY};
    this.leases.set(lease.leaseId,structuredClone(lease));
    return {lease,status:this.status(scope)};
  }
  release(lease: OwnedConversationLease | null) {
    if (!lease || !same(this.leases.get(lease.leaseId),lease)) return false;
    return this.leases.delete(lease.leaseId);
  }
  close() { this.leases.clear(); }
  /** Explicit local deletion fences all future source revisions of that item.
   * Source deletion uses the same message removal without this local fence. */
  markLocallyDeleted(messageKey: string) { this.owner.db.query("UPDATE owned_conversation_watermark SET locally_deleted=1,deleted=1 WHERE message_key=?").run(messageKey); }
  record(input: OwnedConversationRecordInput): OwnedConversationRecordResult {
    try {
      if (!input.lease) return {outcome:"disabled"};
      const lease = this.leases.get(input.lease.leaseId);
      if (!lease || !same(lease,input.lease) || !same(ownedConversationScope(input.scope),lease.scope) || !this.active(lease)) return {outcome:"revoked"};
      const event = input.event; integer(event?.cursor,1);
      const position = this.owner.db.query("SELECT capture_epoch,last_cursor FROM owned_conversation_position WHERE scope_key=?").get(hash(lease.scope)) as {capture_epoch:string;last_cursor:number};
      if (position.capture_epoch !== lease.captureEpoch || event.cursor <= lease.afterCursor) return {outcome:"revoked"};
      if (event.kind === "gap") {
        if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(event.reason)) return {outcome:"unavailable"};
        if (event.cursor <= position.last_cursor) return {outcome:"stale"};
        this.advance(lease,event.cursor,event.reason); return {outcome:"gap"};
      }
      if (!["upsert","delete"].includes(event.kind)) return {outcome:"unavailable"};
      const provenance = provenanceOf(input.provenance);
      if (provenance.actionId !== lease.actionId || provenance.nativeActionId !== lease.nativeActionId || provenance.serverGeneration !== lease.scope.serverGeneration || provenance.workerBindingId !== lease.scope.workerBindingId || provenance.workerGeneration !== lease.scope.workerGeneration || provenance.threadId !== lease.scope.threadId || provenance.messageId !== event.itemId) return {outcome:"revoked"};
      id(event.itemId); if (!/^[a-f0-9]{64}$/.test(event.sourceRevision)) return {outcome:"unavailable"}; integer(event.revisionNumber,1);
      const identity = {clientId:`owned-conversation:${hash(lease.scope)}`,threadId:lease.scope.threadId,messageId:event.itemId};
      let metadata: OwnedConversationHistoryMetadata | undefined;
      if (event.kind === "upsert") {
        integer(event.originalBytes); const reason = exclusionOf(event.text);
        if (typeof event.text !== "string" || Buffer.byteLength(event.text) > MAX_TEXT || event.originalBytes > MAX_TEXT || !["user","assistant"].includes(event.role) || !["direct-human","automatic-host","assistant","unknown"].includes(event.attribution) || !["complete","partial"].includes(event.coverage) || ![null,"commentary","final_answer"].includes(event.phase) || event.coverageReason !== undefined && (typeof event.coverageReason !== "string" || Buffer.byteLength(event.coverageReason)>1024) || event.coverage === "partial" && !event.coverageReason?.trim()) return {outcome:"unavailable"};
        if (event.role === "assistant" && event.attribution !== "assistant" || event.role === "user" && event.attribution === "assistant") return {outcome:"unavailable"};
        if (event.exclusionReason !== null && !["known-secret-content","generated-instructions-or-schema"].includes(event.exclusionReason) || event.exclusionReason && event.text !== "" || !event.exclusionReason && event.originalBytes !== Buffer.byteLength(event.text)) return {outcome:"unavailable"};
        metadata = validatedOwnedConversationMetadata({policyVersion:OWNED_CONVERSATION_POLICY,filterPolicyVersion:"known-pattern-filter-v1",scope:lease.scope,provenance,sourceRevision:event.sourceRevision,cursor:event.cursor,captureEpoch:lease.captureEpoch,positionAuthority:"local-observation",attribution:event.attribution,phase:event.phase,originalBytes:event.originalBytes,exclusionReason:reason ?? event.exclusionReason});
      }
      // Excluded bytes are never hashed. The safe digest also excludes cursor,
      // allowing a retransmitted event at a new observation position to dedupe.
      const eventDigest = hash({kind:event.kind,sourceRevision:event.sourceRevision,revisionNumber:event.revisionNumber,provenance,...(event.kind === "upsert" ? {role:event.role,attribution:event.attribution,text:metadata!.exclusionReason ? "" : event.text,coverage:event.coverage,coverageReason:event.coverageReason,originalBytes:event.originalBytes,exclusionReason:metadata!.exclusionReason,phase:event.phase} : {})});
      return this.owner.db.transaction((): OwnedConversationRecordResult => {
        if (!this.active(lease)) return {outcome:"revoked"};
        const messageKey = JSON.stringify([identity.clientId,identity.threadId,identity.messageId]);
        const previous = this.owner.db.query("SELECT revision_number,event_digest,locally_deleted FROM owned_conversation_watermark WHERE message_key=?").get(messageKey) as {revision_number:number;event_digest:string;locally_deleted:number} | null;
        if (previous && event.revisionNumber <= previous.revision_number) {
          if (event.revisionNumber === previous.revision_number && eventDigest !== previous.event_digest) return {outcome:"unavailable"};
          this.advance(lease,event.cursor);
          const prior = this.owner.getMessage(identity);
          return event.revisionNumber === previous.revision_number && prior ? {outcome:"duplicate",latest:true,message:prior} : {outcome:"stale"};
        }
        if (event.cursor <= position.last_cursor) return {outcome:"stale"};
        if (!previous && (this.owner.db.query("SELECT COUNT(*) AS n FROM owned_conversation_watermark").get() as {n:number}).n >= MAX_WATERMARKS) { this.advance(lease,event.cursor,"watermark-limit"); return {outcome:"unavailable"}; }
        let result: OwnedConversationRecordResult;
        if (event.kind === "delete" || previous?.locally_deleted) { this.owner.deleteMessage(identity); result = {outcome:"deleted"}; }
        else {
          result = this.owner.record({...identity,revisionId:`owned-conversation:${event.revisionNumber}:${eventDigest}`,revisionNumber:event.revisionNumber,turnId:provenance.turnId,compactionId:null,role:event.role,author:event.attribution === "direct-human" ? "human" : event.attribution === "automatic-host" ? "automatic-host" : event.attribution,source:"native",text:metadata!.exclusionReason ? "" : event.text,timestamp:provenance.timestampMs,coverage:event.coverage,...(event.coverageReason ? {coverageReason:event.coverageReason}:{}),capturePolicy:OWNED_CONVERSATION_POLICY,sensitivity:"known-pattern-filtered",ownedConversation:metadata});
        }
        this.advance(lease,event.cursor,result.outcome === "quota-reached" || result.outcome === "disabled" ? "capture-write-stopped" : undefined);
        if (result.outcome !== "quota-reached" && result.outcome !== "disabled") this.owner.db.query("INSERT INTO owned_conversation_watermark VALUES(?,?,?,?,?,?,0) ON CONFLICT(message_key) DO UPDATE SET revision_number=excluded.revision_number,source_revision=excluded.source_revision,event_digest=excluded.event_digest,deleted=excluded.deleted").run(messageKey,hash(lease.scope),event.revisionNumber,event.sourceRevision,eventDigest,event.kind === "delete" || previous?.locally_deleted ? 1 : 0);
        return result;
      }).immediate();
    } catch { return {outcome:"unavailable"}; }
  }
  private advance(lease: OwnedConversationLease,cursor:number,reason?:string) {
    const position = this.owner.db.query("SELECT last_cursor FROM owned_conversation_position WHERE scope_key=?").get(hash(lease.scope)) as {last_cursor:number};
    if (cursor <= position.last_cursor) return;
    const gap = reason ?? (cursor > position.last_cursor + 1 ? "cursor-gap" : null);
    this.owner.db.query("UPDATE owned_conversation_position SET last_cursor=?,gap_count=gap_count+?,last_gap_reason=COALESCE(?,last_gap_reason) WHERE scope_key=?").run(cursor,gap ? 1 : 0,gap,hash(lease.scope));
  }
}
export function validatedOwnedConversationMetadata(value: OwnedConversationHistoryMetadata): OwnedConversationHistoryMetadata {
  if (!value || value.policyVersion !== OWNED_CONVERSATION_POLICY || value.filterPolicyVersion !== "known-pattern-filter-v1" || value.positionAuthority !== "local-observation" || !/^[a-f0-9]{64}$/.test(value.sourceRevision) || !uuid.test(value.captureEpoch) || !["direct-human","automatic-host","assistant","unknown"].includes(value.attribution) || ![null,"commentary","final_answer"].includes(value.phase) || value.exclusionReason !== null && !["known-secret-content","generated-instructions-or-schema"].includes(value.exclusionReason)) throw new Error("Invalid owned conversation metadata");
  integer(value.cursor,1); integer(value.originalBytes); if (value.originalBytes > MAX_TEXT) throw new Error("Owned conversation text exceeds bound");
  return {policyVersion:OWNED_CONVERSATION_POLICY,filterPolicyVersion:"known-pattern-filter-v1",scope:ownedConversationScope(value.scope),provenance:provenanceOf(value.provenance),sourceRevision:value.sourceRevision,cursor:value.cursor,captureEpoch:value.captureEpoch,positionAuthority:"local-observation",attribution:value.attribution,phase:value.phase,originalBytes:value.originalBytes,exclusionReason:value.exclusionReason};
}
