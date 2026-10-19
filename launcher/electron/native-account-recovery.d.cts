export interface NativeOwnerRecoveryPreview {
  state: 'reviewable' | 'blocked'; reviewDigest?: string; observedAt: number; reasonCode?: string;
  markers: Array<{ kind: 'authority' | 'execution' | 'inventory'; profileId?: string; epoch?: string; sha256: string; formerPid: number }>;
  unsettledActionCount: number;
}
export interface NativeOwnerRecoveryReceipt {
  actionId: string; reviewDigest?: string; state: 'prepared' | 'archiving' | 'completed' | 'failed' | 'unknown';
  ownerHeld: boolean; terminal: boolean; archivedCount: number; unsettledActionCount: number; reasonCode?: string;
}
export interface NativeOwnerRecoveryOptions {
  executionRoot: string; inventoryRoot: string;
  getWorkerPin(): Promise<{ executable: string; executableSha256: string }>;
  getMetadataRuntimePin(): Promise<{ bunPath: string; bunSha256: string }>;
}
export function createNativeAccountRecovery(options: NativeOwnerRecoveryOptions & {
  authorityHome: string; executable: string; executableSha256: string; isBusy(): boolean;
}): {
  previewRecovery(): Promise<NativeOwnerRecoveryPreview>;
  recoverOwner(input: { actionId: string; reviewDigest: string }): Promise<NativeOwnerRecoveryReceipt>;
  inspectRecovery(actionId: string): NativeOwnerRecoveryReceipt | undefined;
  assertNotRecovering(): void; activeCount(): number; currentOperation(): string | null; destroy(): Promise<void>;
};
