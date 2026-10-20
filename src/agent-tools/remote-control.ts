import { z } from "zod";
import { readJsonRequestBody } from "../http-body";
import { remoteTaskScopeSchema, remoteToolRequestSchema } from "../remote-workspace/protocol";
import type { AgentModeRuntime } from "../agent-mode/runtime";
import type { AgentToolsComposition } from "./composition";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("validate-task"), scope: remoteTaskScopeSchema }).strict(),
  z.object({ action: z.literal("validate-intent"), request: remoteToolRequestSchema }).strict(),
  z.object({ action: z.literal("validate-invalidation"), taskId: z.string().min(1).max(200), familyId: z.string().min(1).max(200), beforeGeneration: z.number().int().positive() }).strict(),
]);
/** Reads actual task and already-begun journal authority. It cannot grant, invoke or replay tools. */
export function createAgentRemoteControlRoutes(options: {
  runtime(): AgentModeRuntime; tools(): AgentToolsComposition;
  authorize(request: Request): boolean; canStart(): boolean;
}) {
  return async (request: Request): Promise<Response> => {
    if (!options.authorize(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
    try {
      const body = bodySchema.parse(await readJsonRequestBody(request, 72 * 1024, 72 * 1024));
      const runtime = options.runtime();
      const taskId = body.action === "validate-task" ? body.scope.taskId : body.action === "validate-intent" ? body.request.scope.taskId : body.taskId;
      const task = runtime.store.getTask(taskId);
      if (body.action === "validate-invalidation") {
        if (task.familyId !== body.familyId || task.generation < body.beforeGeneration) throw new Error("Stale remote generation fence");
        return Response.json({ ok: true, value: { taskId, familyId: task.familyId, beforeGeneration: body.beforeGeneration } });
      }
      if (!options.canStart() || task.ownerMode !== "agent" || task.ownerId && task.ownerId !== runtime.runner.ownerId
        || !["ready", "running", "awaiting_input"].includes(task.status)) throw new Error("Current remote task authority is unavailable");
      if (body.action === "validate-task") {
        if (task.familyId !== body.scope.familyId || task.generation !== body.scope.generation || task.revision !== body.scope.revision) throw new Error("Stale remote attachment scope");
      } else {
        if (task.generation !== body.request.scope.generation) throw new Error("Stale remote tool generation");
        options.tools().validateBegunRemoteInvocation(body.request);
      }
      return Response.json({ ok: true, value: { taskId, familyId: task.familyId, generation: task.generation, revision: task.revision } });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof z.ZodError ? "invalid_request" : "remote_scope_conflict" }, { status: error instanceof z.ZodError ? 400 : 409 });
    }
  };
}
