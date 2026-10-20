import { z } from 'zod';
import { readJsonRequestBody } from '../http-body';
import { oauthMcpScopeSchema, oauthMcpInvocationSchema } from './oauth-mcp-types';
import type { AgentModeRuntime } from '../agent-mode/runtime';
import type { AgentToolsComposition } from './composition';
const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('validate-task'), scope: oauthMcpScopeSchema }).strict(), z.object({ action: z.literal('validate-intent'), request: oauthMcpInvocationSchema }).strict()]);
/** Independent read of actual active task and immutable already-begun ToolJournal intent. */
export function createAgentOAuthMcpControlRoutes(options: { runtime(): AgentModeRuntime; tools(): AgentToolsComposition; authorize(request: Request): boolean; canStart(): boolean }) {
  return async (request: Request) => {
    if (!options.authorize(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (request.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
    try {
      const body = schema.parse(await readJsonRequestBody(request, 112 * 1024, 112 * 1024));
      const scope = body.action === 'validate-task' ? body.scope : body.request.scope;
      const runtime = options.runtime(), task = runtime.store.getTask(scope.taskId);
      if (!options.canStart() || task.ownerMode !== 'agent' || task.ownerId && task.ownerId !== runtime.runner.ownerId
        || task.generation !== scope.generation || !['ready', 'running', 'awaiting_input'].includes(task.status)) throw new Error('Stale OAuth MCP task authority');
      if (body.action === 'validate-intent') options.tools().validateBegunOAuthMcpInvocation(body.request);
      return Response.json({ ok: true, value: scope });
    } catch (error) { return Response.json({ ok: false, error: error instanceof z.ZodError ? 'invalid_request' : 'oauth_mcp_scope_conflict' }, { status: error instanceof z.ZodError ? 400 : 409 }); }
  };
}
