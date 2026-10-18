import type { CanonicalNativePage } from './canonical-history-policy.cjs';
export interface CanonicalNativeHistoryRecorder {
  list(input?:{cursor?:string|null;limit?:number}):Promise<{items:Array<{threadId:string;name:string|null;nameTruncated:boolean}>;nextCursor:string|null;statusScope:string}>;
  status(threadId:string):Promise<unknown>;
  setConsent(threadId:string,input:{enabled:boolean;consent?:boolean;acknowledgeUnknownSecrets?:boolean}):Promise<unknown>;
  refresh(threadId:string,input?:{cursor?:string|null;limit?:number}):Promise<unknown>;
}
export function createCanonicalNativeHistoryRecorder(input:{sourceId:string;getClient:()=>{listThreads(input:{cursor:string|null;limit:number}):Promise<{data:Array<{id:string;name:string|null}>;nextCursor:string|null;statusScope:string}>;readThreadConversation(threadId:string,input:{cursor:string|null;limit:number}):Promise<CanonicalNativePage>};requestHistory:(body:Record<string,unknown>)=>Promise<any>;knownSecrets?:()=>readonly string[]}):CanonicalNativeHistoryRecorder;
