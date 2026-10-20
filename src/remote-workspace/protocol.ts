import { z } from "zod";
import type { ToolOutcome } from "../agent-tools/types";

const identity = z.string().min(1).max(200).regex(/^[^\u0000-\u001f]+$/u);
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const remoteTaskScopeSchema = z.object({ taskId: identity, familyId: identity, generation, revision: generation }).strict();
export const remoteScopeSchema = z.object({ taskId: identity, generation }).strict();
export const remoteToolScopeSchema = z.object({ taskId: identity, generation, toolCallId: identity }).strict();
export const remoteAgentBindingSchema = z.object({
  mainInstanceId: z.string().uuid(), attachmentId: z.string().uuid(), taskId: identity, familyId: identity, generation,
  hostId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  root: z.string().min(1).max(4096).startsWith("/").regex(/^[^\u0000\r\n]+$/u),
  connectionId: z.string().uuid(), hostname: z.string().min(1).max(253), username: z.string().min(1).max(64),
  port: z.number().int().min(1).max(65535), label: z.string().min(1).max(100),
}).strict();
const relativePath = (empty: boolean) => z.string().max(4096).refine(value => (empty || !!value) && !value.startsWith("/")
  && !/[\u0000\\\r\n]/u.test(value) && (!value || !value.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")), "Use a path within the selected remote root");
export const remoteArgumentsSchemas = {
  "remote/list": z.object({ binding: remoteAgentBindingSchema, path: relativePath(true).optional() }).strict(),
  "remote/read": z.object({ binding: remoteAgentBindingSchema, path: relativePath(false) }).strict(),
  "remote/command": z.object({ binding: remoteAgentBindingSchema, command: z.string().min(1).max(16384).refine(value => !!value.trim() && !value.includes("\0") && Buffer.byteLength(value) <= 16384), timeoutSeconds: z.number().int().min(1).max(3600) }).strict(),
};
export const remoteToolRequestSchema = z.object({ scope: remoteToolScopeSchema, tool: z.enum(["remote/list", "remote/read", "remote/command"]),
  arguments: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(1).max(240) }).strict().superRefine((request, context) => {
  const result = remoteArgumentsSchemas[request.tool].safeParse(request.arguments);
  if (!result.success) context.addIssue({ code: "custom", message: "Invalid exact remote tool arguments" });
  if (Buffer.byteLength(JSON.stringify(request)) > 64 * 1024) context.addIssue({ code: "custom", message: "Remote tool request exceeds its bound" });
});
export const remoteToolOutcomeSchema = z.object({ scope: remoteToolScopeSchema, tool: z.enum(["remote/list", "remote/read", "remote/command"]),
  idempotencyKey: z.string().min(1).max(240), state: z.enum(["completed", "failed", "outcome_unknown"]), result: z.unknown().optional(), reason: z.string().max(4096).optional() }).strict();
export type RemoteTaskScope = z.infer<typeof remoteTaskScopeSchema>;
export type RemoteScope = z.infer<typeof remoteScopeSchema>;
export type RemoteAgentBinding = z.infer<typeof remoteAgentBindingSchema>;
export type RemoteToolRequest = z.infer<typeof remoteToolRequestSchema>;
export interface RemoteAgentHost {
  id: string; label: string; hostname: string; username: string; port: number; root: string; fingerprint: string;
  connected: boolean; canonicalRoot: string | null; busy: boolean;
}
export interface RemoteAgentStatus { mainInstanceId: string; hosts: RemoteAgentHost[]; bindings: RemoteAgentBinding[]; activeCount: number }
export const remoteAgentStatusSchema = z.object({ mainInstanceId: z.string().uuid(), hosts: z.array(z.object({
  id: z.string().uuid(), label: z.string().min(1).max(100), hostname: z.string().min(1).max(253), username: z.string().min(1).max(64),
  port: z.number().int().min(1).max(65535), root: z.string().min(1).max(4096), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  connected: z.boolean(), canonicalRoot: z.string().max(4096).nullable(), busy: z.boolean(),
}).strict()).max(24), bindings: z.array(remoteAgentBindingSchema).max(64), activeCount: z.number().int().nonnegative().max(64) }).strict();
export interface AgentRemoteBridge {
  status(scope?: RemoteScope): Promise<RemoteAgentStatus>;
  attach(input: { hostId: string; scope: RemoteTaskScope; explicitUserAction: true }): Promise<RemoteAgentStatus>;
  revoke(scope: RemoteScope): Promise<RemoteAgentStatus>;
  invalidate(input: { taskId: string; familyId: string; beforeGeneration: number }): Promise<unknown>;
  execute(request: RemoteToolRequest): Promise<ToolOutcome>;
  receipt(request: RemoteToolRequest): Promise<ToolOutcome | undefined>;
}
export const sameRemoteBinding = (a: RemoteAgentBinding, b: RemoteAgentBinding) => Object.keys(remoteAgentBindingSchema.shape).every(key => a[key as keyof RemoteAgentBinding] === b[key as keyof RemoteAgentBinding]);
