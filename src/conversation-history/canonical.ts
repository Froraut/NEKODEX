import type {Database} from 'bun:sqlite';
import {canonicalFingerprint,classifyCanonicalText,type SanitizedCanonicalPage,type SanitizedCanonicalMessage} from '../../launcher/electron/canonical-history-policy.cjs';
import type {CaptureRecord,HistoryMessage,HistoryStatus,MessageIdentity,RecordResult} from './types';
const POLICY='known-pattern-filter-v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export interface CanonicalCaptureLease {sourceId:string;threadId:string;clientId:string;consentRevision:number;recordingEpoch:number;policyVersion:typeof POLICY}
interface Consent {enabled:number;revision:number;policy:string;acknowledged:number;last_refresh:string|null}
function identity(sourceId:string,threadId:string){if(typeof sourceId!=='string'||!/^[a-f0-9]{64}$/.test(sourceId)||typeof threadId!=='string'||!UUID.test(threadId))throw new Error('Invalid selected native history source/thread');}
function safeId(value:unknown){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>512||/[\u0000-\u001f]/u.test(value))throw new Error('Invalid canonical message identity');}
const REASONS=new Set(['known-secret-content','generated-instructions-or-schema','source-item-size-limit','source-page-size-limit']);
/** Leaf shares the history owner's SQLite connection/transaction. No second
 * writer, transcript discovery, subscription, timer or client/model lifecycle. */
export class CanonicalHistoryCapture {
 constructor(private readonly owner:{db:Database;record:(record:CaptureRecord)=>RecordResult;getMessage:(identity:MessageIdentity)=>HistoryMessage|null;status:()=>HistoryStatus}) {
  if(!(owner.db.query('PRAGMA table_info(settings)').all() as Array<{name:string}>).some(column=>column.name==='recording_epoch'))owner.db.exec('ALTER TABLE settings ADD COLUMN recording_epoch INTEGER NOT NULL DEFAULT 0');
  owner.db.exec(`CREATE TABLE IF NOT EXISTS canonical_history_consent(source_id TEXT NOT NULL,thread_id TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,policy TEXT NOT NULL,acknowledged INTEGER NOT NULL,last_refresh TEXT,PRIMARY KEY(source_id,thread_id));`);
 }
 private consent(sourceId:string,threadId:string){identity(sourceId,threadId);return this.owner.db.query('SELECT enabled,revision,policy,acknowledged,last_refresh FROM canonical_history_consent WHERE source_id=? AND thread_id=?').get(sourceId,threadId) as Consent|null;}
 status(sourceId:string,threadId:string){const consent=this.consent(sourceId,threadId),global=this.owner.status();return {sourceId,threadId,clientId:`codex-app-server:${sourceId}`,recordingEnabled:global.recordingEnabled,quotaReached:global.quotaReached,enabled:!!consent?.enabled&&consent.policy===POLICY&&consent.acknowledged===1,consentRevision:consent?.revision??0,policyVersion:POLICY,mode:'after-explicit-native-refresh' as const,backgroundWatcher:false,transcriptCoverage:'partial' as const,unknownSecretsPossible:true,lastRefresh:consent?.last_refresh?JSON.parse(consent.last_refresh):null};}
 setConsent(input:{sourceId:string;threadId:string;enabled:boolean;consent?:boolean;acknowledgeUnknownSecrets?:boolean}){
  identity(input.sourceId,input.threadId);if(typeof input.enabled!=='boolean'||input.enabled&&(!this.owner.status().recordingEnabled||input.consent!==true||input.acknowledgeUnknownSecrets!==true))throw new Error('Global opt-in, exact-thread content consent and unknown-secret-risk acknowledgement are required');
  const count=(this.owner.db.query('SELECT COUNT(*) AS n FROM canonical_history_consent').get() as {n:number}).n;
  if(!this.consent(input.sourceId,input.threadId)&&count>=256)throw new Error('Selected native thread policy quota reached; existing policy/history is preserved');
  this.owner.db.query('INSERT INTO canonical_history_consent(source_id,thread_id,enabled,revision,policy,acknowledged) VALUES(?,?,?,1,?,?) ON CONFLICT(source_id,thread_id) DO UPDATE SET enabled=excluded.enabled,revision=canonical_history_consent.revision+1,policy=excluded.policy,acknowledged=excluded.acknowledged').run(input.sourceId,input.threadId,input.enabled?1:0,POLICY,input.enabled?1:0);
  return this.status(input.sourceId,input.threadId);
 }
 lease(sourceId:string,threadId:string){const state=this.status(sourceId,threadId);if(!state.recordingEnabled||!state.enabled||state.quotaReached)return {lease:null,status:state};
  const epoch=(this.owner.db.query('SELECT recording_epoch FROM settings WHERE id=1').get() as {recording_epoch:number}).recording_epoch;
  const lease:CanonicalCaptureLease={sourceId,threadId,clientId:state.clientId,consentRevision:state.consentRevision,recordingEpoch:epoch,policyVersion:POLICY};return {lease,status:state};
 }
 recordPage(lease:CanonicalCaptureLease,page:SanitizedCanonicalPage){
  identity(lease?.sourceId,lease?.threadId);
  if(lease.policyVersion!==POLICY||lease.clientId!==`codex-app-server:${lease.sourceId}`||!Number.isSafeInteger(lease.consentRevision)||!Number.isSafeInteger(lease.recordingEpoch)||page?.policyVersion!==POLICY||page.threadId!==lease.threadId||!Array.isArray(page.messages)||page.messages.length>100||!Number.isSafeInteger(page.observedAt)||page.observedAt<0||!Number.isSafeInteger(page.excludedItems)||page.excludedItems<0||typeof page.complete!=='boolean'||Buffer.byteLength(JSON.stringify(page))>550000)throw new Error('Invalid canonical capture page');
  return this.owner.db.transaction(()=>{
    const active=this.lease(lease.sourceId,lease.threadId).lease;
    if(!active||active.consentRevision!==lease.consentRevision||active.recordingEpoch!==lease.recordingEpoch)return {outcome:'revoked',recorded:0,duplicates:0,rejected:0,status:this.status(lease.sourceId,lease.threadId)};
    let recorded=0,duplicates=0,rejected=0,quotaReached=false;const seen=new Set<string>();
    for(const candidate of page.messages){
      safeId(candidate?.messageId);if(candidate.turnId!==null)safeId(candidate.turnId);
      if(seen.has(candidate.messageId)||!['user','assistant'].includes(candidate.role)||typeof candidate.text!=='string'||candidate.compactionId!==null||!['complete','partial'].includes(candidate.sourceCoverage)||candidate.exclusionReason!==null&&!REASONS.has(candidate.exclusionReason)||!Number.isSafeInteger(candidate.originalBytes)||candidate.originalBytes<0||candidate.originalBytes>16*1024*1024||candidate.exclusionReason&&candidate.text!==''||!candidate.exclusionReason&&candidate.originalBytes!==Buffer.byteLength(candidate.text)||candidate.timestampMs!==null&&(!Number.isSafeInteger(candidate.timestampMs)||candidate.timestampMs<0))throw new Error('Invalid canonical user/assistant item');
      seen.add(candidate.messageId);
      const backendReason=candidate.exclusionReason??classifyCanonicalText(candidate.text);
      const item:SanitizedCanonicalMessage={messageId:candidate.messageId,turnId:candidate.turnId,role:candidate.role,text:backendReason?'':candidate.text,timestampMs:candidate.timestampMs,compactionId:null,exclusionReason:backendReason,originalBytes:candidate.originalBytes,sourceCoverage:candidate.sourceCoverage};
      const fingerprint=canonicalFingerprint(item),messageIdentity={clientId:lease.clientId,threadId:lease.threadId,messageId:item.messageId},old=this.owner.getMessage(messageIdentity);
      if(old?.canonical?.fingerprint===fingerprint){duplicates++;continue;}
      const next=(old?.revisionNumber??0)+1;
      const result=this.owner.record({...messageIdentity,revisionId:`native:${next}:${fingerprint}`,revisionNumber:next,turnId:item.turnId,compactionId:null,role:item.role,author:'unknown',source:'native',text:item.text,timestamp:item.timestampMs??page.observedAt,coverage:'partial',coverageReason:'selected-native-canonical-page-only',capturePolicy:'canonical-thread-text-v1',sensitivity:'known-pattern-filtered',canonical:{policyVersion:POLICY,fingerprint,observedAt:page.observedAt,timestampSource:item.timestampMs===null?'observed-at':'native',originalBytes:item.originalBytes,exclusionReason:item.exclusionReason,sourceCoverage:item.sourceCoverage}});
      if(result.outcome==='quota-reached'){quotaReached=true;break;}if(result.outcome==='rejected')rejected++;else if(result.outcome==='recorded')recorded++;
    }
    const summary={observedAt:page.observedAt,recorded,duplicates,rejected,sourceExcluded:page.excludedItems,received:page.messages.length,remainingNotRecorded:page.messages.length-recorded-duplicates-rejected,hasOlderPage:page.nextCursor!==null,quotaReached,coverage:'partial',policyVersion:POLICY};
    this.owner.db.query('UPDATE canonical_history_consent SET last_refresh=? WHERE source_id=? AND thread_id=?').run(JSON.stringify(summary),lease.sourceId,lease.threadId);
    return {outcome:quotaReached?'quota-reached':'captured',...summary,status:this.status(lease.sourceId,lease.threadId)};
  }).immediate();
 }
}
