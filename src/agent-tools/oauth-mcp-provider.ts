import { oauthMcpInvocationSchema, OAUTH_MCP_SERVER_ID, type OAuthMcpBridge } from './oauth-mcp-types';
import type { StandaloneBuiltinToolsProvider, ToolScope } from './types';
import { validateToolScope } from './journal';
/** Stable aggregate namespace. Main binds each hashed tool name and schema to one reviewed pin. */
export function createAgentOAuthMcpToolsProvider(options: { bridge: OAuthMcpBridge; isScopeActive(scope: ToolScope): boolean }): StandaloneBuiltinToolsProvider {
  const active = (scope: ToolScope) => { validateToolScope(scope); if (!options.isScopeActive(scope)) throw new Error('Current OAuth MCP task scope unavailable'); };
  return {
    serverId: OAUTH_MCP_SERVER_ID,
    async discover(scope, control) { active(scope); control?.signal?.throwIfAborted(); let tools; try { tools = await options.bridge.discover(scope); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } active(scope); control?.signal?.throwIfAborted(); return tools; },
    async execute(input, control) { const request = oauthMcpInvocationSchema.parse(input); active(request.scope); control?.signal?.throwIfAborted(); return options.bridge.execute(request); },
    reconcile: input => options.bridge.receipt(oauthMcpInvocationSchema.parse(input)),
    invalidate(taskId) { if (taskId) void options.bridge.invalidate(taskId).catch(() => {}); },
  };
}
