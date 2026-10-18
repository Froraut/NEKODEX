export interface OwnedNativeCanonicalItem {
  messageId: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  timestampMs: number;
  phase?: string | null;
  authorship: 'automatic-host' | 'direct-user' | 'native-assistant';
  imageAttachments?: import('./owned-native-images.cjs').OwnedNativeImageMetadata[];
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
  inputAuthorship: 'automatic-host' | 'direct-user'; usage: OwnedNativeUsage | null;
  reasonCode?: string; nativeStatus?: 'completed' | 'failed' | 'interrupted';
  canonicalItems?: OwnedNativeCanonicalItem[];
  structuredOutput?: unknown;
  imageAttachments?: import('./owned-native-images.cjs').OwnedNativeImageMetadata[];
}
export interface OwnedNativeSnapshot {
  availability: { available: boolean; reasonCode: string | null };
  storageOwner: 'current' | 'elsewhere-or-unverified' | 'stale' | 'unclaimed';
  scope: 'private-owned-ephemeral' | 'private-owned-persistent';
  delivery: 'local-fixture-only' | 'qualified-account';
  state: 'disconnected' | 'creating' | 'ready' | 'offering' | 'unknown' | 'retiring' | 'retired';
  workerHandle: string | null;
  threadId: string | null;
  admissionId: string;
  receipts: OwnedNativeReceipt[];
  capabilities: { textInput: true; imageInput: boolean; nativeTools: false;
    foreignThreadAdoption: false; replay: false; realProviderVerified: false };
}
/** Trusted-main only. Raw configuration/schema never crosses renderer or Bun admission. */
export function createOwnedNativeWorkerService(options: {
  executable: string;
  executableSha256: string;
  /** Stock default remains unchanged; wrapper is an explicitly admitted DEV executable. */
  executableVariant?: 'stock-cli' | 'owned-wrapper';
  wrapperBuildPin?: { metadataPath: string; metadataSha256: string; sourceRoot: string; sourcePinSha256: string };
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
  /** Typed image bytes only; paths and arbitrary image URLs are unavailable. */
  offerOwnedTurn(input: { workerHandle: string; actionId: string; text: string;
    images?: import('./owned-native-images.cjs').OwnedNativeImage[];
    outputSchema?: Record<string, unknown> }): Promise<OwnedNativeReceipt>;
  /** Passive: no profile/CLI creation; inspect durable receipts rather than re-offering actions. */
  inspectOwnedWorker(workerHandle?: string): OwnedNativeSnapshot;
  retireOwnedWorker(input: { workerHandle: string; actionId: string }): Promise<OwnedNativeSnapshot>;
  currentOperation(): string | null;
  destroy(): Promise<void>;
};

/** Trusted main composition only. Private sender/request methods are never returned. */
export function createOwnedNativeAccountServer(options:{
  admission:{serverGeneration:string;paths:{cwd:string};prestart():unknown;checkEffective(read:unknown,requirements:unknown):void;
    checkAccount(account:unknown,usage:unknown):void;forBinding(binding:import('./agent-native-bridge.cjs').AgentNativeBinding):unknown;
    compileOutputSchema?:(schema:Record<string,unknown>)=>(value:unknown)=>boolean};
  requestTimeoutMs?:number;terminalTimeoutMs?:number;stopGraceMs?:number;maxConcurrentThreads?:number;onChange?:()=>void;
}):{
  createWorker(binding:import('./agent-native-bridge.cjs').AgentNativeBinding,onReceipt?:(receipt:OwnedNativeReceipt)=>void):ReturnType<typeof createOwnedNativeWorkerService>;
  /** Main-only exclusive account operation. No raw RPC or foreign-thread adoption. */
  persistentOperation<T>(action:(operation:{
    createWorker(binding:import('./agent-native-bridge.cjs').AgentNativeBinding,onReceipt?:(receipt:OwnedNativeReceipt)=>void,forkThreadId?:string):ReturnType<typeof createOwnedNativeWorkerService>;
    useWorker(worker:ReturnType<typeof createOwnedNativeWorkerService>):ReturnType<typeof createOwnedNativeWorkerService>;
  })=>Promise<T>):Promise<T>;
  inspect():{serverGeneration:string;pid:number|null;closed:boolean;accepting:boolean;threadIds:string[];bindings:string[];activeCount:number};
  currentOperation():string|null;destroy():Promise<void>;
};
