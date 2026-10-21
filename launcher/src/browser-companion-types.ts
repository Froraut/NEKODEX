/** The reviewed Chrome artifact pins its manifest key, so Chrome loads it with this ID from any path. */
export const BROWSER_COMPANION_CHROME_ID = 'bocnhdmjkjcoedkephdeoeipmmfbanpc';
/** The reviewed Firefox artifact ID; its moz-extension://UUID origin is per profile. */
export const BROWSER_COMPANION_FIREFOX_ID = 'browser-companion@nekodex.local';
export interface BrowserCompanionApi {
  request(body: { action: 'status' | 'enable' | 'disable' | 'create-pairing' | 'revoke' | 'unbind-chatgpt'; extensionId?: string; extensionOrigin?: string }
    | { action: 'bind-chatgpt'; chatgpt: BrowserCompanionChatGptBind }
    | { action: 'release-chatgpt-held'; operationId: string }): Promise<unknown>;
  copyPairing?(text: string): Promise<{ copied: boolean }>;
}
export interface BrowserCompanionChatGptBind {
  modelId: 'gpt-5.6-sol' | 'gpt-5.6-luna'; reasoning: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; modelFamily?: string;
}
export interface BrowserCompanionChatGptStatus {
  sendSupported: true;
  state: 'unbound' | 'bound' | 'sending' | 'held';
  bound: { modelId: string; reasoning: string; modelFamily?: string; modelLabel: string; accountFingerprint: string; identityEpoch: string; tabId: number; documentId: string; boundAt: number } | null;
  held: { operationId: string; stage: 'send' | 'response'; reason: string; heldAt: number; userMessageId?: string } | null;
  lastTurn: { operationId: string; traceId: string; userMessageId: string; assistantMessageId?: string; path: string; identityEpoch: string; answerSha256: string; completedAt: number } | null;
}
export interface BrowserCompanionPairing {
  version: 1; origin: string; hostId: string; pairingCode: string; extensionId: string; extensionOrigin?: string;
}
export interface BrowserCompanionStatus {
  enabled: boolean;
  state: 'disabled' | 'listening' | 'unavailable' | 'transitioning' | 'closed';
  origin: string; extensionId: string; extensionOrigin?: string; reason: string | null; restartPolicy: 'off';
  extensionArtifact: { directory: string; manifestPath: string; available: boolean };
  companion: {
    version: number; hostId: string; extensionId: string; extensionOrigin?: string; paired: boolean; connected: boolean;
    selected: { tabId: number; windowId: number; frameId: 0; documentId: string; documentEpoch: string; scopeId: string; observationId: string } | null;
    operation: { operationId: string; phase: 'queued' | 'dispatched' | 'unknown' } | null;
    features?: string[];
  } | null;
  lastReceipt: { operationId: string; outcome: string; cancelRequested: boolean; reason?: string } | null;
  chatGptSendSupported: boolean;
  chatGpt?: BrowserCompanionChatGptStatus;
}
