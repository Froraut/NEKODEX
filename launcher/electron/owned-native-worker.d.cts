export interface OwnedNativeCanonicalItem {
  messageId: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  timestampMs: number;
  phase?: string | null;
  authorship: 'automatic-host' | 'native-assistant';
}
export interface OwnedNativeUsage {
  totalTokens: number; inputTokens: number; cachedInputTokens: number;
  cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number;
}
export interface OwnedNativeReceipt {
  actionId: string; workerHandle: string; admissionId: string; kind: 'create' | 'offer';
  threadId: string | null; turnId: string | null; clientUserMessageId: string;
  inputHash: string; schemaHash: string | null;
  state: 'prepared' | 'offered' | 'acknowledged' | 'completed' | 'failed' | 'unknown';
  retired: boolean; ownerHeld: boolean; createdAt: number; updatedAt: number;
  retirementActionId?: string;
  /** Passive observation only; another service object never proves owner loss. */
  ownerState?: 'current' | 'elsewhere-or-unverified' | 'lost';
  /** Append-only bounded state facts; held uncertainty is retained after exact reconciliation. */
  observations: Array<{ state: OwnedNativeReceipt['state']; ownerHeld: boolean; turnId: string | null;
    timestampMs: number; reasonCode?: string }>;
  inputAuthorship: 'automatic-host'; usage: OwnedNativeUsage | null;
  reasonCode?: string; nativeStatus?: 'completed' | 'failed' | 'interrupted';
  canonicalItems?: OwnedNativeCanonicalItem[];
  structuredOutput?: unknown;
}
export interface OwnedNativeSnapshot {
  availability: { available: boolean; reasonCode: string | null };
  storageOwner: 'current' | 'elsewhere-or-unverified' | 'stale' | 'unclaimed';
  scope: 'private-owned-ephemeral';
  delivery: 'local-fixture-only';
  state: 'disconnected' | 'creating' | 'ready' | 'offering' | 'unknown' | 'retired';
  workerHandle: string | null;
  threadId: string | null;
  admissionId: string;
  receipts: OwnedNativeReceipt[];
  capabilities: { textInput: true; imageInput: false; nativeTools: false;
    foreignThreadAdoption: false; replay: false; realProviderVerified: false };
}
/** Trusted-main only. Raw configuration/schema never crosses renderer or Bun admission. */
export function createOwnedNativeWorkerService(options: {
  executable: string;
  executableSha256: string;
  authorityHome: string;
  catalog: { json: string; sha256: string; modelId: string };
  route: { kind: 'official-openai' } | { kind: 'local-fixture'; baseUrl: string };
  /** ACK and terminal callbacks follow durable receipt persistence; never native RPC authority. */
  onReceipt?: (receipt: OwnedNativeReceipt) => void;
  /** Main-owned, bounded, synchronous compiler. Required when offering outputSchema. */
  compileOutputSchema?: (schema: Record<string, unknown>) => (value: unknown) => boolean;
  requestTimeoutMs?: number;
  /** Observation wait only. On expiry returns held unknown; never interrupts/closes inference. */
  terminalTimeoutMs?: number;
  stopGraceMs?: number;
}): {
  createOwnedWorker(input: { actionId: string }): Promise<{ workerHandle: string; threadId: string;
    admissionId: string; receipt: OwnedNativeReceipt }>;
  /** Text only; future public adapter must resolve an admitted fixed schema ID in main. */
  offerOwnedTurn(input: { workerHandle: string; actionId: string; text: string;
    outputSchema?: Record<string, unknown> }): Promise<OwnedNativeReceipt>;
  /** Passive: no profile/CLI creation; inspect durable receipts rather than re-offering actions. */
  inspectOwnedWorker(workerHandle?: string): OwnedNativeSnapshot;
  retireOwnedWorker(input: { workerHandle: string; actionId: string }): Promise<OwnedNativeSnapshot>;
  currentOperation(): string | null;
  destroy(): Promise<void>;
};
