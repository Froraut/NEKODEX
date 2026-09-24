import { randomBytes } from "node:crypto";
import type { ChatGptTurnEnvironment } from "./environment";

export interface BrokerToolRequest {
  callId: string;
  wireName: string;
  freeform: boolean;
  arguments?: Record<string, unknown>;
  input?: string;
}

export interface BrokerToolResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: unknown;
}

export type OwnedOperationState = "running" | "completed" | "failed" | "cancelled" | "expired";

export type BrokerOwnedOperationSnapshot =
  | { operationId: string; state: "running" }
  | { operationId: string; state: "completed"; deliveryId: string; result: BrokerToolResult }
  | { operationId: string; state: "failed" | "cancelled" | "expired"; deliveryId: string; error: string;
      cancellationScope?: "queued" | "observation_only" }
  | { operationId: string; state: "acknowledged" };

export type BrokerOwnedOperationStartResult = BrokerOwnedOperationSnapshot
  | { state: "control"; result: BrokerToolResult };

export interface BrokerOwnedOperationStatus {
  operations: Array<{
    operation_id: string;
    state: OwnedOperationState | "acknowledged";
    acknowledgement_required: boolean;
    cancellation_scope?: "queued" | "observation_only";
  }>;
  limit: number;
  truncated: boolean;
  omitted?: number;
}

export type BrokerCompletionFenceStart =
  | { revision: number }
  | { blockedReason: "active_work" | "unacknowledged_async_result"; blockedCount: number };

interface BrokerRequestFields {
  id: string;
  token?: string;
  bindingId?: string;
  wireName?: string;
  freeform?: boolean;
  arguments?: Record<string, unknown>;
  input?: string;
  environment?: ChatGptTurnEnvironment;
  ttlMs?: number;
  traceId?: string;
  callId?: string;
  activityId?: string;
  revision?: number;
  toolResult?: BrokerToolResult;
  handoffId?: string;
  summary?: string;
  surfaceNonce?: string;
  finalAnswer?: string;
  contract?: "native" | "safe";
  operationId?: string;
  deliveryId?: string;
  waitMs?: number;
}

export interface BrokerResponse {
  id: string;
  result?: unknown;
  error?: string;
}

export interface TurnBrokerOwner {
  register(environment: ChatGptTurnEnvironment, ttlMs?: number, traceId?: string): Promise<string>;
  registerSafe(
    environment: ChatGptTurnEnvironment,
    surfaceNonce: string,
    ttlMs?: number,
    traceId?: string,
  ): Promise<string>;
  updateEnvironment(token: string, environment: ChatGptTurnEnvironment): void | Promise<void>;
  confirmSafeTurnSent(
    token: string,
    surfaceNonce: string,
  ): { confirmed: true; duplicate: boolean } | Promise<{ confirmed: true; duplicate: boolean }>;
  nextToolBatch(token: string, signal?: AbortSignal): Promise<BrokerToolRequest[]>;
  completeTool(token: string, callId: string, result: BrokerToolResult): void | Promise<void>;
  waitForSafeStart(token: string, signal?: AbortSignal): Promise<void>;
  waitForSafeCompletion(token: string, signal?: AbortSignal): Promise<string>;
  requestCompaction(token: string, queuedResult: BrokerToolResult): number | Promise<number>;
  compactionDeliveryCount(token: string): number | Promise<number>;
  beginCompletionFence(token: string): BrokerCompletionFenceStart | Promise<BrokerCompletionFenceStart>;
  commitCompletionFence(token: string, revision: number): boolean | Promise<boolean>;
  waitForRetirement(token: string, signal?: AbortSignal): Promise<void>;
  revoke(token: string, reason?: Error): void | Promise<void>;
}

export const MAX_BROKER_LINE_CHARS = 67_108_864;
export const MAX_BROKER_REQUEST_ID_CHARS = 256;
export function brokerResponseLineChars(result: unknown): number {
  // A request id is arbitrary validated text. NUL forces JSON's longest six-character escape, so
  // this envelope is at least as large as any accepted id and the same serializer is used on write.
  const worstCaseId = "\0".repeat(MAX_BROKER_REQUEST_ID_CHARS);
  return `${JSON.stringify({ id: worstCaseId, result } satisfies BrokerResponse)}\n`.length;
}

export function opaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function assertSurfaceNonce(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20,256}$/.test(value)) {
    throw new Error("Manual mode local browser binding is invalid");
  }
}

export const BROKER_PROTOCOL_VERSION = 5;

const requestFields = {
  claim: ["token", "contract", "activityId"],
  resolve: ["bindingId"],
  release: ["bindingId"],
  invoke: ["bindingId", "wireName", "freeform", "arguments", "input"],
  invoke_async: ["bindingId", "wireName", "freeform", "arguments", "input", "operationId"],
  operation_status: ["token"],
  operation_poll: ["token", "operationId", "deliveryId", "waitMs"],
  operation_cancel: ["token", "operationId"],
  owner_status: [],
  owner_register: ["environment", "ttlMs", "traceId"],
  owner_register_safe: ["environment", "ttlMs", "traceId", "surfaceNonce"],
  owner_update: ["token", "environment"],
  owner_safe_sent: ["token", "surfaceNonce"],
  owner_next: ["token"],
  owner_complete: ["token", "callId", "toolResult"],
  owner_completion_fence_begin: ["token"],
  owner_completion_fence_commit: ["token", "revision"],
  owner_wait_retirement: ["token"],
  owner_revoke: ["token"],
  owner_safe_wait_start: ["token"],
  owner_safe_wait_completion: ["token"],
  owner_request_compaction: ["token", "toolResult"],
  owner_compaction_delivery_count: ["token"],
  safe_start: ["token"],
  safe_complete: ["token", "finalAnswer"],
  activity_complete: ["token", "activityId"],
  submit_compaction_handoff: ["token", "handoffId", "summary"],
} as const satisfies Record<string, readonly (keyof BrokerRequestFields)[]>;

/** Compatibility input for existing generic callers; dispatch uses the method-keyed union. */
export type BrokerCallRequest = BrokerRequestFields & { method: keyof typeof requestFields };

export type BrokerRequest = {
  [M in keyof typeof requestFields]: { id: string; method: M }
    & Pick<BrokerRequestFields, (typeof requestFields)[M][number]>
}[keyof typeof requestFields];

/** Decode shape only. Capability checks and required fields remain with the broker. */
export function decodeBrokerRequest(value: unknown): BrokerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("turn broker request id is invalid");
  const packet = value as Record<string, unknown>;
  if (typeof packet.id !== "string" || packet.id.length === 0 || packet.id.length > MAX_BROKER_REQUEST_ID_CHARS) {
    throw new Error("turn broker request id is invalid");
  }
  if (typeof packet.method !== "string" || !Object.hasOwn(requestFields, packet.method)) {
    throw new Error("turn broker method is invalid");
  }
  for (const [field, entry] of Object.entries(packet)) {
    if (entry === undefined || field === "id" || field === "method") continue;
    const expected = field === "freeform" ? "boolean"
      : ["ttlMs", "revision", "waitMs"].includes(field) ? "number"
      : ["arguments", "environment", "toolResult"].includes(field) ? "object" : "string";
    // Ignore extension fields as before; validate recognized fields before method narrowing.
    if (!Object.values(requestFields).some(fields => fields.some(name => name === field))) continue;
    if (typeof entry !== expected || (expected === "object" && (entry === null || Array.isArray(entry)))) {
      throw new Error(`turn broker ${field} is invalid`);
    }
  }
  if (packet.contract !== undefined && packet.contract !== "native" && packet.contract !== "safe") {
    throw new Error("turn broker contract is invalid");
  }
  return value as BrokerRequest;
}
