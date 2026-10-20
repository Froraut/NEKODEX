export interface OwnedConversationScope {
  kind:'owned-conversation';mode:'canonical-text-v1';conversationId:string;threadId:string;sourceId:string;
  profileId:string;backendAccountId:string;authEpoch:string;serverGeneration:string;workerBindingId:string;workerGeneration:number;
}
export interface OwnedConversationProvenance {
  actionId:string;nativeActionId:string;serverGeneration:string;workerBindingId:string;workerGeneration:number;
  messageId:string;turnId:string;threadId:string;timestampMs:number;
}
export type OwnedConversationEvent = {kind:'upsert';cursor:number;itemId:string;sourceRevision:string;revisionNumber:number;
  role:'user'|'assistant';attribution:'direct-human'|'automatic-host'|'assistant'|'unknown';text:string;
  coverage:'complete'|'partial';coverageReason?:string;originalBytes:number;
  exclusionReason:null|'known-secret-content'|'generated-instructions-or-schema';phase:null|'commentary'|'final_answer';
} | {kind:'gap';cursor:number;reason:string};
export interface OwnedConversationHistoryPort {
  begin(input:{scope:OwnedConversationScope;actionId:string;nativeActionId:string;afterCursor:number;captureEpoch:string;enableConsent?:{consent:true;acknowledgeUnknownSecrets:true}}):Promise<{lease:unknown|null;status?:unknown}>|{lease:unknown|null;status?:unknown};
  record(input:{lease:unknown;scope:OwnedConversationScope;provenance?:OwnedConversationProvenance;event:OwnedConversationEvent}):Promise<{outcome:string}|undefined>|{outcome:string}|undefined;
  release(lease:unknown):Promise<unknown>|unknown;
}
export interface OwnedConversationRecordingAuthority { readonly producerInstanceId:string;readonly globalRevision:number;readonly scopeDigest:string|null;readonly sourceRevision:number|null;readonly conversationId:string|null;readonly conversationRevision:number|null; }
export interface OwnedConversationCapture {readonly id:string;}
export function validateOwnedConversationScope(input:unknown):OwnedConversationScope;
export function createOwnedNativeTranscriptProducer(options:{history:OwnedConversationHistoryPort;resolveScope:(scope:OwnedConversationScope)=>OwnedConversationScope|null;maxQueuedBytes?:number;maxQueuedEvents?:number}):{
  begin(input:{scope:OwnedConversationScope;actionId:string;nativeActionId:string;enableConsent?:{consent:true;acknowledgeUnknownSecrets:true};requireCapture?:boolean;expectedAuthority?:OwnedConversationRecordingAuthority}):Promise<OwnedConversationCapture|null>;
  observe(capture:OwnedConversationCapture,event:{actionId:string;threadId:string;item:import('./owned-native-worker.cjs').OwnedNativeCanonicalItem}):void;
  release(capture:OwnedConversationCapture|null):Promise<void>;
  revoke(scope?:OwnedConversationScope):Promise<void>;
  /** Call only after confirmed explicit core enable consent/global recording enable. */
  recordingStatus(conversationId:string):{conversationId:string;locallyDenied:boolean;reason:string|null};
  recordingAuthority(scope?:OwnedConversationScope):OwnedConversationRecordingAuthority;
  recordingAuthorityForConversation(conversationId:string,initialAuthority?:OwnedConversationRecordingAuthority):OwnedConversationRecordingAuthority;
  allowRecording(scope:OwnedConversationScope|undefined,expectedAuthority:OwnedConversationRecordingAuthority):void;
  revokeConversation(conversationId:string):Promise<void>;
  status():{activeCount:number;pendingCount:number;closed:boolean;globallyDenied:boolean;conversations:Array<{conversationId:string;locallyDenied:boolean;reason:string|null}>;sources:Array<{scope:OwnedConversationScope;captureEpoch:string;cursor:number;gaps:number;reason:string|null;locallyDenied:boolean}>};
  currentOperation():string|null;close():Promise<void>;
};
