import { z } from 'zod';
import { readJsonRequestBody } from '../http-body';
import type { AgentModeRuntime } from '../agent-mode/runtime';
import type { AgentToolsComposition } from '../agent-tools/composition';
import { VM_LIMITS, sha256 } from './protocol';

const scope = z.object({ taskId: z.string().uuid(), generation: z.number().int().positive() }).strict();
const toolScope = scope.extend({ toolCallId: z.string().min(1).max(200) }).strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const request = z.object({ scope: toolScope, tool: z.literal('vm-shell/export'), arguments: z.object({ reviewId: z.string().uuid(), reviewDigest: hash }).strict(), idempotencyKey: z.string().min(1).max(240) }).strict();
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('validate-task'), scope }).strict(),
  z.object({ action: z.literal('validate-intent'), request }).strict(),
  z.object({ action: z.literal('candidate'), scope, operationId: hash, path: z.string().min(1).max(512), sha256: hash }).strict(),
]);
/** Private main-to-core proof/candidate reads. Never invokes a VM or grants an
 * export. Raw candidate bytes never pass through renderer tools IPC. */
export function createVmExportControlRoutes(options: {
  runtime(): AgentModeRuntime; tools(): AgentToolsComposition; authorize(request: Request): boolean; canStart(): boolean;
}) {
  return async (req: Request): Promise<Response> => {
    if (!options.authorize(req)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (req.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
    try {
      const body = bodySchema.parse(await readJsonRequestBody(req, 64 * 1024, 64 * 1024)), runtime = options.runtime();
      const selected = body.action === 'validate-intent' ? body.request.scope : body.scope;
      const task = runtime.store.getTask(selected.taskId);
      const states = body.action === 'validate-intent' ? ['ready', 'running', 'awaiting_input'] : ['ready', 'running', 'awaiting_input', 'review_required'];
      if (!options.canStart() || task.ownerMode !== 'agent' || task.ownerId && task.ownerId !== runtime.runner.ownerId
        || task.generation !== selected.generation || !states.includes(task.status)) throw new Error('vm-task-unavailable');
      if (body.action === 'validate-intent') options.tools().validateBegunVmExportInvocation(body.request);
      if (body.action === 'candidate') {
        const bytes = await options.tools().readVmCandidate(body.scope, body.operationId, body.path, body.sha256);
        if (bytes.length > VM_LIMITS.outputBytes || sha256(bytes) !== body.sha256) throw new Error('vm-candidate-mismatch');
        return Response.json({ ok: true, value: { dataBase64: Buffer.from(bytes).toString('base64'), size: bytes.length, sha256: body.sha256 } });
      }
      return Response.json({ ok: true, value: { id: task.id, familyId: task.familyId, generation: task.generation } });
    } catch (error) { return Response.json({ ok: false, error: error instanceof z.ZodError ? 'invalid_request' : 'vm_export_scope_conflict' }, { status: error instanceof z.ZodError ? 400 : 409 }); }
  };
}
