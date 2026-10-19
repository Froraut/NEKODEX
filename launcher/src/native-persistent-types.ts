export type NativeConversationMode = 'neko-json-v1' | 'canonical-text-v1';
export interface NativePersistentConversation {
  id: string;
  revision: number;
  threadId: string | null;
  model: string;
  status: 'idle' | 'running' | 'unknown' | 'unavailable' | 'unloaded';
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  lastSummary?: string;
  conversationMode?: NativeConversationMode;
  lastTextPreview?: string;
  lastTextTruncated?: boolean;
  lastTurnId?: string;
  recordingRequiredBeforeFirstSend?: boolean;
  ownerAvailable: boolean;
  resumeAvailable?: boolean;
  resumeReason?: string | null;
}

export interface NativePersistentSnapshot {
  available: boolean;
  profileId: string | null;
  epoch: string | null;
  serverGeneration: string | null;
  models: Array<{ id: string; label?: string }>;
  conversations: NativePersistentConversation[];
  actions: Array<{ actionId: string; kind: string; conversationId?: string; state: string; ownerHeld?: boolean; reasonCode?: string }>;
  observedAction?: { actionId: string; kind: string; conversationId?: string; state: string; ownerHeld?: boolean; reasonCode?: string };
  busy: boolean;
  retention: 'explicit-native-context';
  resumeSupported: boolean;
}

export interface NativePersistentContext { profileId: string; epoch: string; serverGeneration: string }

export type NativePersistentRequest =
  | { action: 'snapshot'; actionId?: string }
  | { action: 'create'; actionId: string; model: string; text: string; retainContext: true; expectedContext: NativePersistentContext;
      conversationMode?: NativeConversationMode; recordFutureText?: { consent: true; acknowledgeUnknownSecrets: true } }
  | { action: 'send'; actionId: string; conversationId: string; revision: number; text: string; expectedContext: NativePersistentContext }
  | { action: 'fork'; actionId: string; conversationId: string; revision: number; expectedContext: NativePersistentContext; lastTurnId?: string }
  | { action: 'closeIdle' | 'resume'; actionId: string; conversationId: string; revision: number; expectedContext: NativePersistentContext };

export type NativePersistentResult = { ok: true; value: NativePersistentSnapshot }
  | { ok: false; error: { code: string; message: string; knownNotStarted?: boolean; nativeTurnNotStarted?: boolean } };

export interface NativePersistentApi {
  nativePersistentRequest(body: NativePersistentRequest): Promise<NativePersistentResult>;
}
