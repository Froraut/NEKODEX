export interface CanonicalNativeMessage {messageId:string;turnId:string|null;role:'user'|'assistant';text:string;timestampMs:number|null;compactionId:null;coverage:'complete'|'partial';coverageReason?:string}
export interface CanonicalNativePage {threadId:string;observedAt:number;messages:CanonicalNativeMessage[];complete:boolean;nextCursor:string|null;excludedItems:number}
export interface SanitizedCanonicalMessage {messageId:string;turnId:string|null;role:'user'|'assistant';text:string;timestampMs:number|null;compactionId:null;exclusionReason:string|null;originalBytes:number;sourceCoverage:'complete'|'partial'}
export interface SanitizedCanonicalPage {threadId:string;observedAt:number;messages:SanitizedCanonicalMessage[];complete:boolean;nextCursor:string|null;excludedItems:number;policyExcluded:number;budgetExcluded:number;policyVersion:'known-pattern-filter-v1'}
export const CANONICAL_HISTORY_POLICY:'known-pattern-filter-v1';
export function sanitizeCanonicalPage(page:CanonicalNativePage,input:{threadId:string;knownSecrets?:readonly string[]}):SanitizedCanonicalPage;
export function canonicalFingerprint(item:SanitizedCanonicalMessage):string;
export function classifyCanonicalText(text:string,knownSecrets?:readonly string[]):string|null;
