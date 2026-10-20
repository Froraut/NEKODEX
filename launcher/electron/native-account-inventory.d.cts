import type { NativeProfileOwnerLease, createNativeAccountAuthority } from './native-account-authority.cjs';
type NativeResolvedProfile = ReturnType<ReturnType<typeof createNativeAccountAuthority>['resolveProfile']>;
export interface NativeInventoryReceipt {
  actionId: string; profileId: string; epoch: string;
  state: 'prepared' | 'running' | 'completed' | 'unknown';
  phase: 'preflight' | 'classify' | 'bootstrap' | 'online-inventory' | 'cache-provenance' | 'complete';
  ownerHeld: boolean; createdAt: number; updatedAt: number; reasonCode?: string;
  metadata?: {
    account: {type:'chatgpt';planType:'pro'|'prolite'|'promax';email:string|null};
    usage: NativeInventoryUsage; modelCount: number; cacheSha256: string;
    nativeIdentity: string; fetchedAt: string; etag: string|null; clientVersion: '0.163.0'; executionAvailable: false;
  };
}
export interface NativeInventoryUsage {
  accountId: string; ordinaryUsageAllowed: true; identityConfidence:'native-active-account-match';
  rateLimits: unknown; rateLimitsByLimitId: unknown;
}
export interface NativeInventoryWrapperPin {
  executable: string; executableSha256: string; target: 'aarch64-apple-darwin'|'x86_64-apple-darwin';
  wrapperBuildPin: {metadataPath:string;metadataSha256:string;sourceRoot:string;sourcePinSha256:string;
    kind?:'publisher-signed-app';appBundlePath?:string;resourcesPath?:string;mainExecutablePath?:string;productionManifestSha256?:string};
  officialBootstrapCatalog: {path:string;sha256:string;bytes?:number;sourceRelativePath?:string;codexRevision?:string;bootstrapOnly?:boolean};
}
/** Main-only owner. No supplied paths, model IDs, RPC methods or environment cross renderer IPC.
 * Running inventory authorizes native metadata GETs, including its immediate background model refresh.
 * It never starts a thread or inference and never admits product models. */
export function createNativeAccountInventoryService(options: {
  authority: {
    resolveProfile(profileId:string,epoch:string,lease?:NativeProfileOwnerLease):NativeResolvedProfile;
    publishProfileConfig(input:{profileId:string;epoch:string;actionId:string;expectedConfigSha256:string;configText:string;profileOwner?:NativeProfileOwnerLease}):{configSha256:string};
    releaseProfileOwner?(lease:NativeProfileOwnerLease):void;
  };
  getWrapperPin:()=>NativeInventoryWrapperPin|Promise<NativeInventoryWrapperPin>;
  acquireProfileOwner:(input:{profileId:string;epoch:string;actionId:string;kind:'inventory'})=>NativeProfileOwnerLease|Promise<NativeProfileOwnerLease>;
  storageRoot:string;onChange?:()=>void;requestTimeoutMs?:number;stopGraceMs?:number;
}): {
  run(input:{actionId:string;profileId:string;epoch:string;explicitUserAction:true}):Promise<NativeInventoryReceipt>;
  inspect():{activeCount:number;receipts:NativeInventoryReceipt[];models:never[];executionAvailable:false};
  /** Private original full catalog. Null after restart/failure: a receipt is not refreshed catalog authority. */
  trustedInventory(actionId:string):null|{profileId:string;epoch:string;sourceRevision:string;executableSha256:string;configSha256:string;
    authStat:{dev:number;ino:number;size:number;mtimeMs:number;ctimeMs:number};
    cacheSha256:string;identity:string;fetchedAt:string;etag:string|null;clientVersion:'0.163.0';
    account:{type:'chatgpt';planType:'pro'|'prolite'|'promax';email:string|null};usage:NativeInventoryUsage;picker:unknown[];catalog:{models:Array<Record<string,unknown>>}};
  currentOperation():string|null;destroy():Promise<void>;
};
