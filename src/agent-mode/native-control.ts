import { z } from "zod";
import { readJsonRequestBody } from "../http-body";
import type { AgentModeRuntime } from "./runtime";

const identity = z.string().min(1).max(128).regex(/^[^\u0000-\u001f]+$/u);
const scope = z.object({ taskId: identity, familyId: identity, generation: z.number().int().positive(), revision: z.number().int().positive(),
  dispatchId: identity, ownerId: identity, agentWorkerId: identity }).strict();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("validate-offer"), scope, payloadDigest: z.string().regex(/^[a-f0-9]{64}$/), model: identity, admissionId: identity }).strict(),
  z.object({ action: z.literal("validate-invalidation"), taskId: identity, familyId: identity, beforeGeneration: z.number().int().positive() }).strict(),
]);
/** Read-only validation of already persisted authority. Incoming payload hashes never create a claim. */
export function createAgentNativeControlRoutes(options: { runtime: () => AgentModeRuntime; authorize: (request: Request) => boolean }) {
  return async (request: Request): Promise<Response> => {
    if (!options.authorize(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
    try {
      const body = bodySchema.parse(await readJsonRequestBody(request, 16 * 1024, 16 * 1024));
      const runtime = options.runtime();
      if (body.action === "validate-offer") return Response.json({ ok: true, value: runtime.validateNativeOffer(body) });
      const task = runtime.store.getTask(body.taskId);
      if (task.familyId !== body.familyId || task.generation < body.beforeGeneration) throw new Error("Stale Native invalidation");
      return Response.json({ ok: true, value: { taskId: task.id, familyId: task.familyId, beforeGeneration: body.beforeGeneration } });
    } catch (reason) {
      return Response.json({ ok: false, error: reason instanceof z.ZodError ? "invalid_request" : "native_scope_conflict" }, { status: reason instanceof z.ZodError ? 400 : 409 });
    }
  };
}
