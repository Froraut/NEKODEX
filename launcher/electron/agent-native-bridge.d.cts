import type { AgentNativeOfferEnvelope, AgentNativeLookup, AgentNativeReceipt } from '../../src/agent-mode/native-protocol';
import type { OwnedNativeReceipt, createOwnedNativeWorkerService } from './owned-native-worker.cjs';
export interface AgentNativeBinding {
  workerBindingId: string; workerGeneration: number; taskId: string; familyId: string;
  generation: number; agentWorkerId: string; admissionId: string; model: string;
}
export interface AgentNativeAdmission {
  historySource?: import('./agent-native-protocol.cjs').AgentNativeHistorySource;
  imageInput?: boolean;
  /** Same deterministic binding must resolve its retained journal before thread creation.
   * Constructor/facade creation is passive; only createOwnedWorker may start its owner. */
  createWorker(binding: Readonly<AgentNativeBinding>, onReceipt: (receipt: OwnedNativeReceipt) => void): ReturnType<typeof createOwnedNativeWorkerService>;
}
export interface AgentNativeBridgeOptions {
  resolveAdmission(admissionId: string, model: string): AgentNativeAdmission | undefined | Promise<AgentNativeAdmission | undefined>;
  /** Must verify the exact already-durable, active Bun dispatch claim; never trust caller metadata. */
  validateOffer(envelope: AgentNativeOfferEnvelope, payloadDigest: string): boolean | { scope: AgentNativeOfferEnvelope['scope']; payloadDigest: string; claimId?: string } | Promise<boolean | { scope: AgentNativeOfferEnvelope['scope']; payloadDigest: string; claimId?: string }>;
  canStart(): boolean;
  /** Observation wait only; expiry never interrupts Native work. */
  waitMs?: number;
}
export function compileAgentNativeOutputSchema(schema: Readonly<Record<string, unknown>>): (value: unknown) => boolean;
export function createAgentNativeBridge(options: AgentNativeBridgeOptions): {
  offer(envelope: AgentNativeOfferEnvelope, options?: { payloadDigest?: string; signal?: AbortSignal; onReceipt?: (receipt: AgentNativeReceipt) => void }): Promise<AgentNativeReceipt>;
  readReceipt(lookup: AgentNativeLookup, options?: { signal?: AbortSignal }): Promise<AgentNativeReceipt | undefined>;
  waitReceipt(lookup: AgentNativeLookup & { afterRevision: number }, options?: { signal?: AbortSignal }): Promise<AgentNativeReceipt | undefined>;
  status(): { destroyed: boolean; activeCount: number; bindings: Array<{ workerBindingId: string; workerGeneration: number; taskId: string; familyId: string; taskGeneration: number; retired: boolean; closed: boolean }>;
    receipts: Array<Omit<AgentNativeReceipt, 'assistantText'>>; restartRecovery: 'unavailable-without-durable-binding-metadata' };
  /** HTTP callers must supply the validated family/current-generation fence. */
  invalidateTask(taskId: string, options?: { familyId: string; beforeGeneration: number }): Promise<void>;
  destroy(): Promise<void>;
};
