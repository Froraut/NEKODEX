import { z } from 'zod';
import type { StandaloneBuiltinToolsProvider, ToolScope } from './types';
export const OAUTH_MCP_SERVER_ID = 'oauth_mcp_tools';
export const oauthMcpScopeSchema = z.object({ taskId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/), generation: z.number().int().positive(), toolCallId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/) }).strict();
export const oauthMcpInvocationSchema = z.object({ scope: oauthMcpScopeSchema, tool: z.string().regex(/^oauth_mcp_tools\/[a-f0-9]{16}__[a-zA-Z0-9_.-]{1,102}$/),
  arguments: z.object({ binding: z.string().regex(/^[a-f0-9]{64}$/), input: z.record(z.string(), z.unknown()) }).strict(), idempotencyKey: z.string().min(1).max(240) }).strict();
export const oauthMcpDescriptorSchema = z.object({ id: z.string().max(161), serverId: z.literal(OAUTH_MCP_SERVER_ID), name: z.string().regex(/^[a-f0-9]{16}__[a-zA-Z0-9_.-]{1,102}$/), description: z.string().max(4000).optional(), inputSchema: z.record(z.string(), z.unknown()), supported: z.literal(true) }).strict();
export const oauthMcpOutcomeSchema = z.object({ state: z.enum(['completed', 'failed', 'outcome_unknown']), result: z.unknown().optional(), reason: z.string().max(1024).optional() }).strict();
export interface OAuthMcpBridge {
  discover(scope: ToolScope): Promise<z.infer<typeof oauthMcpDescriptorSchema>[]>;
  execute(request: z.infer<typeof oauthMcpInvocationSchema>): ReturnType<StandaloneBuiltinToolsProvider['execute']>;
  receipt(request: z.infer<typeof oauthMcpInvocationSchema>): Promise<Awaited<ReturnType<StandaloneBuiltinToolsProvider['execute']>> | undefined>;
  invalidate(taskId: string): Promise<void>;
}
