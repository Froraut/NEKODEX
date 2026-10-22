export type NativeProfileState = 'fresh' | 'login-pending' | 'signed-in-checking' | 'auth-outcome-unknown' | 'login-failed' | 'cancelled';
export type NativeLoginState = 'prepared' | 'running' | 'pending' | 'cancel-requested' | 'signed-in-checking' | 'failed' | 'cancelled' | 'auth-outcome-unknown';
export interface NativeLoginProjection {
  id: string; profileId: string; epoch: string; actionId: string; state: NativeLoginState;
  verificationUrl?: string; userCode?: string; reasonCode?: string;
}
export interface NativeProfileProjection {
  id: string; profileId: string; epoch: string; label: string; state: NativeProfileState;
  login?: NativeLoginProjection;
}
export interface NativeProfileOwnerLease { readonly id: string; readonly profileId: string; readonly epoch: string; readonly actionId: string; readonly kind: 'inventory' | 'execution'; }
export interface NativeAccountReceipt {
  actionId: string; kind: 'prepare-profile' | 'device-login' | 'cancel-login' | 'profile-config' | 'remove-profile' | 'rename-profile'; profileId: string; epoch: string;
  loginAttemptId?: string; state: string; reasonCode?: string; beforeConfigSha256?: string; candidateConfigSha256?: string;
}
export interface NativeAccountSnapshot {
  available: boolean; reasonCode: string | null; profiles: NativeProfileProjection[];
  receipts: NativeAccountReceipt[]; activeCount: number; executionAvailable: false;
  storageOwner: 'current' | 'unclaimed' | 'elsewhere-or-unverified' | 'stale';
  recoverySupported?: boolean;
}
/** Trusted main only. No paths, executable capabilities, environment or credentials cross IPC.
 * Mutation errors carry actionRecorded:boolean; false proves this invocation recorded no intent.
 * True includes uncertainty and requires passive receipt reconciliation, never replay. */
export function createNativeAccountAuthority(options: {
  authorityHome: string; executable: string; executableSha256: string;
  sourceRevision?: string; cliVersion?: string; stopGraceMs?: number;
  onChange?: () => void;
  recovery?: import('./native-account-recovery.cjs').NativeOwnerRecoveryOptions;
}): {
  inspect(): NativeAccountSnapshot; snapshot(): NativeAccountSnapshot;
  previewRecovery(): Promise<import('./native-account-recovery.cjs').NativeOwnerRecoveryPreview>;
  recoverOwner(input: {actionId: string; reviewDigest: string}): Promise<import('./native-account-recovery.cjs').NativeOwnerRecoveryReceipt>;
  inspectRecovery(actionId: string): import('./native-account-recovery.cjs').NativeOwnerRecoveryReceipt | undefined;
  renameProfile(input:{actionId:string;profileId:string;epoch:string;expectedLabel:string;label:string}): NativeProfileProjection;
  prepareProfile(input: {actionId: string; label: string}): NativeProfileProjection;
  beginDeviceLogin(input: {profileId: string; epoch: string; actionId: string}): NativeLoginProjection;
  inspectLogin(loginAttemptId: string): NativeLoginProjection;
  cancelLogin(input: {loginAttemptId: string; actionId: string}): Promise<NativeLoginProjection>;
  /** Trusted-main only. Requires settled CLI success; validates auth path metadata without reading content. */
  resolveProfile(profileId: string, epoch: string, profileOwner?: NativeProfileOwnerLease): {profileId: string; epoch: string; root: string; home: string; codexHome: string; sqliteHome: string; cwd: string; tmp: string; config: string; authStat: {dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number}; configSha256: string; cliVersion: string; sourceRevision: string};
  /** Trusted-main only; writes nonsecret owner-generated config under journaled expected-byte comparison. */
  publishProfileConfig(input: {profileId: string; epoch: string; actionId: string; expectedConfigSha256: string; configText: string; profileOwner?: NativeProfileOwnerLease}): {actionId: string; profileId: string; epoch: string; configSha256: string; state: 'completed'};
  acquireProfileOwner(input: {profileId: string; epoch: string; actionId: string; kind: 'inventory' | 'execution'}): NativeProfileOwnerLease;
  /** Caller releases only after its exact child/cache operation physically settles. */
  releaseProfileOwner(profileOwner: NativeProfileOwnerLease): void;
  currentOperation(): string | null; destroy(): Promise<void>;
};
