import type { createNativeAccountAuthority } from './native-account-authority.cjs';
import type { createNativeAccountInventoryService, NativeInventoryWrapperPin } from './native-account-inventory.cjs';
import type { AgentNativeAdmission } from './agent-native-bridge.cjs';
export function settleNativeConversationOwners(execution?:{destroy():Promise<void>}|null,
  conversations?:{destroy():Promise<void>}|null):Promise<void>;
export interface NativeAccountExecutionModel { id:string; label?:string; admissionId:string; provider:'owned-native'; available:true; accepting:boolean; imageInput:boolean; historySource:import('./agent-native-protocol.cjs').AgentNativeHistorySource; }
export interface NativeAccountExecutionSnapshot {
  models:NativeAccountExecutionModel[];profileId:string|null;epoch:string|null;ownerHeld:boolean; failed:boolean;
  server:null|{serverGeneration:string;pid:number|null;closed:boolean;accepting:boolean;threadIds:string[];bindings:string[];activeCount:number};
}
/** Main-owned account execution; no credential bytes, caller paths or raw RPC cross IPC. */
export function createNativeAccountExecutionService(options:{
  authority:Pick<ReturnType<typeof createNativeAccountAuthority>,'acquireProfileOwner'|'releaseProfileOwner'|'resolveProfile'|'publishProfileConfig'>;
  inventory:Pick<ReturnType<typeof createNativeAccountInventoryService>,'trustedInventory'>;
  getWrapperPin:()=>NativeInventoryWrapperPin|Promise<NativeInventoryWrapperPin>;storageRoot:string;onChange?:()=>void;
  requestTimeoutMs?:number;terminalTimeoutMs?:number;stopGraceMs?:number;maxConcurrentThreads?:number;
}):{
  admit(input:{actionId:string;inventoryActionId:string;profileId:string;epoch:string;modelIds?:string[]}):Promise<{models:NativeAccountExecutionModel[];serverGeneration:string}>;
  models():NativeAccountExecutionModel[];
  persistentContext():null|{server:ReturnType<typeof import('./owned-native-worker.cjs').createOwnedNativeAccountServer>;
    models:NativeAccountExecutionModel[];serverGeneration:string;profileId:string;epoch:string};
  resolveAdmission(admissionId:string,model:string):AgentNativeAdmission|undefined;
  inspect():NativeAccountExecutionSnapshot;currentOperation():string|null;destroy():Promise<void>;
};
