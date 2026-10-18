import { createHash } from "node:crypto";
import { compileToolInputSchema } from "../agent-tools/schema-validator";
import { z } from "zod";
import type { AgentNativeToolDefinition, ExecutionRequest } from "./types";
import type { AgentNativeHistorySource } from "../../launcher/electron/agent-native-protocol.cjs";
export type { AgentNativeHistorySource };
export type { OwnedNativeImage } from "../../launcher/electron/owned-native-images.cjs";

import { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA, AGENT_NATIVE_OUTPUT_SCHEMA_HASH, AGENT_NATIVE_TEXT_BYTES, AGENT_NATIVE_ENVELOPE_BYTES } from "../../launcher/electron/agent-native-protocol.cjs";
export { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA, AGENT_NATIVE_OUTPUT_SCHEMA_HASH, AGENT_NATIVE_TEXT_BYTES, AGENT_NATIVE_ENVELOPE_BYTES };
const id = z.string().min(1).max(128).regex(/^[^\u0000-\u0020]+$/u);
const reply = z.object({ protocol: z.literal(AGENT_NATIVE_PROTOCOL), kind: z.enum(["tool_request", "final"]),
  requestId: id.nullable(), toolId: z.string().min(1).max(240).nullable(), argumentsJson: z.string().nullable(), summary: z.string().nullable(),
}).strict();
export function nativeDigest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export interface AgentNativeScope { taskId: string; familyId: string; generation: number; revision: number; dispatchId: string; ownerId: string; agentWorkerId: string }
export function nativeScopeOf(request: ExecutionRequest): AgentNativeScope {
  return { taskId: request.task.id, familyId: request.task.familyId, generation: request.task.generation, revision: request.task.revision,
    dispatchId: request.dispatch.id, ownerId: request.dispatch.ownerId, agentWorkerId: request.worker.id };
}
export function sameNativeScope(a: AgentNativeScope, b: AgentNativeScope): boolean {
  return a.taskId === b.taskId && a.familyId === b.familyId && a.generation === b.generation && a.revision === b.revision
    && a.dispatchId === b.dispatchId && a.ownerId === b.ownerId && a.agentWorkerId === b.agentWorkerId;
}
export interface AgentNativeOfferEnvelope {
  version: 1;
  protocol: typeof AGENT_NATIVE_PROTOCOL;
  actionId: string;
  scope: AgentNativeScope;
  model: string;
  admissionId: string;
  outputSchemaId: typeof AGENT_NATIVE_OUTPUT_SCHEMA_ID;
  outputSchemaHash: string;
  authorship: "automatic-host";
  /** Fixed host-generated protocol context. No raw paths, RPC, Native tools or schema authority. */
  text: string;
  /** Typed tool-result pixels; never serialized inside automatic-host text. */
  images?: import("../../launcher/electron/owned-native-images.cjs").OwnedNativeImage[];
  continuation: null | { workerBindingId: string; workerGeneration: number; previousNativeTurnReceiptId: string };
}
export interface AgentNativeLookup { actionId: string; scope: AgentNativeScope; payloadDigest: string }
/** Trusted main projection of its exact durable worker receipt, never model-generated JSON. */
export interface AgentNativeReceipt {
  version: 1;
  actionId: string;
  scope: AgentNativeScope;
  model: string;
  admissionId: string;
  outputSchemaId: typeof AGENT_NATIVE_OUTPUT_SCHEMA_ID;
  payloadDigest: string;
  revision: number;
  state: "prepared" | "offered" | "acknowledged" | "completed" | "failed" | "unknown" | "not_sent";
  ownerHeld: boolean;
  writeDisposition: "not-written" | "written" | "unknown";
  workerBindingId: string | null;
  workerGeneration: number | null;
  nativeTurnReceiptId: string | null;
  acceptanceReceipt: string | null;
  inputAuthorship: "automatic-host";
  /** Main obtains this only from the exact owned canonical final assistant item/turn. */
  assistantText?: string;
  /** Native-issued identity/time plus main-owned source; optional history never changes execution. */
  canonicalFinal?: { source: AgentNativeHistorySource; messageId: string; turnId: string; threadId: string; timestampMs: number; rawTextSha256: string };
}
export interface AgentNativeBridge {
  /** Exactly one offer. Disconnect/timeout never authorizes re-offering this action. */
  offer(envelope: AgentNativeOfferEnvelope, options: { signal: AbortSignal; onReceipt: (receipt: AgentNativeReceipt) => void }): Promise<AgentNativeReceipt>;
  readReceipt(lookup: AgentNativeLookup, options: { signal: AbortSignal }): Promise<AgentNativeReceipt | undefined>;
  /** Bounded event wait on the SAME retained action, no RPC/send/start/retry side effect. */
  waitReceipt(lookup: AgentNativeLookup & { afterRevision: number }, options: { signal: AbortSignal }): Promise<AgentNativeReceipt | undefined>;
}
export function nativeToolCallId(dispatchId: string, requestId: string): string { return `neko:${nativeDigest([dispatchId, requestId])}`; }
export function nativeToolValidator(tool: AgentNativeToolDefinition): (value: unknown) => boolean {
  const encoded = JSON.stringify(tool.inputSchema);
  if (!tool.id || tool.id.length > 240 || Buffer.byteLength(encoded) > 64 * 1024 || encoded.includes('"$async"')) throw new Error("Unsupported Native adapter tool schema");
  const validate = compileToolInputSchema(tool.inputSchema);
  return value => validate(value) === true;
}
export function parseNativeResult(text: string, catalog: AgentNativeToolDefinition[], priorRequestIds: string[]) {
  if (Buffer.byteLength(text) > AGENT_NATIVE_TEXT_BYTES) throw new Error("Native adapter reply exceeds its bound");
  const value = reply.parse(JSON.parse(text));
  if (value.kind === "final") {
    if (value.requestId !== null || value.toolId !== null || value.argumentsJson !== null || value.summary === null || !value.summary.trim() || Buffer.byteLength(value.summary) > 16_384) throw new Error("Invalid Native final branch");
    return { kind: "final" as const, summary: value.summary };
  }
  if (value.requestId === null || value.toolId === null || value.argumentsJson === null || value.summary !== null || priorRequestIds.includes(value.requestId) || priorRequestIds.length >= 128
    || Buffer.byteLength(value.argumentsJson) > 64 * 1024) throw new Error("Invalid Native tool-request branch");
  const tool = catalog.find(tool => tool.id === value.toolId);
  const args: unknown = JSON.parse(value.argumentsJson);
  if (!tool || !args || typeof args !== "object" || Array.isArray(args) || !nativeToolValidator(tool)(args)) throw new Error("Native adapter request does not match its declared tool schema");
  return { kind: "tool_request" as const, requestId: value.requestId, tool: tool.id, arguments: args as Record<string, unknown> };
}
