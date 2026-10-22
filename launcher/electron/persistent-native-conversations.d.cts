import type { createOwnedNativeAccountServer } from './owned-native-worker.cjs';
export interface PersistentNativeContextIdentity { profileId:string;epoch:string;serverGeneration:string; }
export interface PersistentNativeExecutionContext extends PersistentNativeContextIdentity {
  server:ReturnType<typeof createOwnedNativeAccountServer>;models:Array<{id:string;admissionId:string;label?:string;historySource:import('./agent-native-protocol.cjs').AgentNativeHistorySource}>;
}
export interface PersistentNativeConversation {
  id:string;revision:number;threadId:string|null;model:string;status:'idle'|'running'|'unknown'|'unavailable'|'unloaded'|'archived';
  resumeAvailable:boolean;resumeReason:string|null;
  archivedAt?:number;archiveAvailable:boolean;archiveReason:string|null;
  ownerAvailable:boolean;createdAt:number;updatedAt:number;parentId?:string;lastSummary?:string;conversationMode:'neko-json-v1'|'canonical-text-v1';lastTextPreview?:string;lastTextTruncated?:boolean;lastTurnId?:string;recordingRequiredBeforeFirstSend:boolean;
}
export interface PersistentNativeConversationAction {
  actionId:string;kind:'create'|'send'|'fork'|'closeIdle'|'resume'|'archive';conversationId:string;state:'prepared'|'completed'|'failed'|'unknown';ownerHeld:boolean;reasonCode?:string;nativeTurnNotStarted?:boolean;
}
export interface PersistentNativeConversationSnapshot {
  archivedConversations:PersistentNativeConversation[];archivedCount:number;archivedConversationIds:string[];archiveNextCursor:string|null;
  quota:{conversations:number;conversationLimit:number;actions:number;actionLimit:number};
  conversations:PersistentNativeConversation[];actions:PersistentNativeConversationAction[];busy:boolean;
  retention:'explicit-native-context';resumeSupported:true;
}
export function createPersistentNativeConversations(options:{
  getExecution:()=>PersistentNativeExecutionContext|null;storageRoot?:string;storagePath?:string;onChange?:()=>void;
  transcript?:ReturnType<typeof import('./owned-conversation-transcript.cjs').createOwnedNativeTranscriptProducer>;
}):{
  list(input?:{archiveCursor?:string}):PersistentNativeConversationSnapshot;
  transcriptScope(conversationId:string):import('./owned-conversation-transcript.cjs').OwnedConversationScope|null;
  currentHistoryScopes():import('./owned-conversation-transcript.cjs').OwnedConversationScope[];
  resolveHistoryScope(input:{conversationId:string;revision:number;expectedContext:PersistentNativeContextIdentity}):import('./owned-conversation-transcript.cjs').OwnedConversationScope;
  readTranscriptPage(input:{scope:import('./owned-conversation-transcript.cjs').OwnedConversationScope;turnId?:string;cursor?:string|null;limit?:number}):ReturnType<ReturnType<typeof import('./owned-native-worker.cjs').createOwnedNativeWorkerService>['readCanonicalPage']>;
  create(input:{actionId:string;model:string;text:string;retainContext:true;conversationMode?:'neko-json-v1'|'canonical-text-v1';recordFutureText?:{consent:true;acknowledgeUnknownSecrets:true};expectedContext:PersistentNativeContextIdentity}):Promise<PersistentNativeConversationSnapshot>;
  send(input:{actionId:string;conversationId:string;revision:number;text:string;expectedContext:PersistentNativeContextIdentity}):Promise<PersistentNativeConversationSnapshot>;
  fork(input:{actionId:string;conversationId:string;revision:number;lastTurnId?:string;expectedContext:PersistentNativeContextIdentity}):Promise<PersistentNativeConversationSnapshot>;
  closeIdle(input:{actionId:string;conversationId:string;revision:number;expectedContext:PersistentNativeContextIdentity}):Promise<PersistentNativeConversationSnapshot>;
  archive(input:{actionId:string;conversationId:string;revision:number;expectedContext:PersistentNativeContextIdentity}):Promise<PersistentNativeConversationSnapshot>;
  resume(input:{actionId:string;conversationId:string;revision:number;expectedContext:PersistentNativeContextIdentity}):Promise<PersistentNativeConversationSnapshot>;
  inspectAction(actionId:string):PersistentNativeConversationAction|undefined;currentOperation():string|null;destroy():Promise<void>;
};
