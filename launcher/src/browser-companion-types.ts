export interface BrowserCompanionApi {
  request(body: { action: 'status' | 'enable' | 'disable' | 'create-pairing' | 'revoke'; extensionId?: string }): Promise<unknown>;
  copyPairing?(text: string): Promise<{ copied: boolean }>;
}
export interface BrowserCompanionPairing {
  version: 1; origin: string; hostId: string; pairingCode: string; extensionId: string;
}
export interface BrowserCompanionStatus {
  enabled: boolean;
  state: 'disabled' | 'listening' | 'unavailable' | 'transitioning' | 'closed';
  origin: string; extensionId: string; reason: string | null; restartPolicy: 'off';
  extensionArtifact: { directory: string; manifestPath: string; available: boolean };
  companion: {
    version: number; hostId: string; extensionId: string; paired: boolean; connected: boolean;
    selected: { tabId: number; windowId: number; frameId: 0; documentId: string; documentEpoch: string; scopeId: string; observationId: string } | null;
    operation: { operationId: string; phase: 'queued' | 'dispatched' | 'unknown' } | null;
  } | null;
  lastReceipt: { operationId: string; outcome: string; cancelRequested: boolean; reason?: string } | null;
  chatGptSendSupported: false;
}
