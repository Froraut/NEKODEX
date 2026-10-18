import { z } from "zod";
import { NativeRequestBodyError, readJsonRequestBody } from "../http-body";
import { AgentModeRuntime } from "./runtime";
import { activeTaskEvidence } from "./evidence";
import type { AgentDispatch, AgentTask, AgentPendingToolRequest, OutcomeEvidence } from "./types";

const identity = z.string().min(1).max(128);
const boundedText = z.string().trim().min(1).max(16_384);
const requirement = z.object({ id: identity, text: boundedText }).strict();
const stage = z.object({ id: identity, instruction: boundedText, requirementIds: z.array(identity).min(1).max(128), dependsOn: z.array(identity).max(128).optional() }).strict();
const mode = z.enum(["manual", "goal", "loop"]);
const taskScope = z.object({ familyId: identity, generation: z.number().int().positive(), revision: z.number().int().positive() }).strict();
const create = z.object({ ownerMode: z.literal("agent"), id: identity, familyId: identity.optional(), mode, recurringAuthorized: z.boolean().optional(), originalRequest: boundedText,
  requirements: z.array(requirement).min(1).max(128), stages: z.array(stage).min(1).max(128),
  bounds: z.object({ maxConcurrent: z.number().int().min(1).max(32), maxTurns: z.number().int().min(1).max(10_000), maxSpend: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable() }).strict(),
  execution: z.discriminatedUnion("provider", [z.object({ provider: z.literal("local-responses"), model: identity }).strict(),
    z.object({ provider: z.literal("owned-native"), model: identity, admissionId: identity }).strict()]),
  workspaceSnapshotGrant: z.unknown().optional(),
}).strict();
const control = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pause", "resume", "stop"]) }).strict(),
  z.object({ action: z.literal("mode"), mode, recurringAuthorized: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("correct"), text: boundedText, requirements: z.array(requirement).min(1).max(128), stages: z.array(stage).min(1).max(128) }).strict(),
]);
const evidenceReference = z.object({ sourceEventId: identity, requirementId: identity, subject: boundedText, subjectRevision: boundedText, property: boundedText,
  observedAt: z.string().max(100).optional(), actualSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(), exists: z.boolean().optional(),
}).strict();
export type AgentEvidenceReference = z.infer<typeof evidenceReference>;

export interface AgentModeRouteOptions {
  runtime: AgentModeRuntime;
  /** Must use the service's existing control bearer and local host/origin checks. */
  authorize: (request: Request) => boolean;
  path?: string;
  /** Resolves a real, permitted source event/artifact. Absence makes evidence attachment unavailable. */
  resolveEvidence?: (task: AgentTask, reference: AgentEvidenceReference) => Promise<OutcomeEvidence> | OutcomeEvidence;
  /** Validates a main-process signature and re-observes the actual selected artifact. Never trusts caller outcome fields. */
  observeWorkspaceEvidence?: (task: AgentTask, proof: unknown) => Promise<{ reference: AgentEvidenceReference; evidence: OutcomeEvidence }> | { reference: AgentEvidenceReference; evidence: OutcomeEvidence };
}

function boundedRows<T>(rows: T[], max = 100, byteLimit = 128 * 1024): { rows: T[]; total: number; truncated: boolean } {
  const selected: T[] = []; let bytes = 0;
  for (const row of rows.slice(-max).reverse()) { const size = Buffer.byteLength(JSON.stringify(row)); if (bytes + size > byteLimit) break; selected.push(row); bytes += size; }
  return { rows: selected.reverse(), total: rows.length, truncated: selected.length !== rows.length };
}
function listing(runtime: AgentModeRuntime) {
  const result = boundedRows(runtime.store.listTasks(), 50, 512 * 1024);
  return { tasks: result.rows, total: result.total, truncated: result.truncated };
}
/** Approval metadata must survive exclusion of large, immutable canonical history rows. */
function pendingToolCalls(runtime: AgentModeRuntime, task: AgentTask, dispatches: AgentDispatch[]) {
  const recorded = new Set(runtime.store.listToolOutcomes(task.id).map(row => row.idempotencyKey));
  const seen = new Set<string>();
  const pending: AgentPendingToolRequest[] = [];
  for (const dispatch of dispatches) {
    if (dispatch.generation !== task.generation || dispatch.taskRevision !== task.revision || dispatch.state !== "settled") continue;
    for (const call of dispatch.result?.continuation?.pending ?? []) {
      const key = runtime.store.toolCallReceiptKey(dispatch.id, call.toolCallId);
      if (recorded.has(key) || seen.has(key)) continue;
      const owned = runtime.resolveToolCall({ taskId: task.id, generation: task.generation, toolCallId: call.toolCallId });
      if (!owned || owned.idempotencyKey !== key || owned.tool !== call.tool || JSON.stringify(owned.arguments) !== JSON.stringify(call.arguments)) continue;
      seen.add(key); pending.push(structuredClone(call));
    }
  }
  return boundedRows(pending, 16, 128 * 1024);
}
function success(value: unknown, status = 200): Response { return Response.json({ ok: true, value }, { status }); }

/** Mount after localHttpRequestRejection; every read and mutation also checks control auth. */
export function createAgentModeRoutes(options: AgentModeRouteOptions): (request: Request) => Promise<Response | undefined> {
  const path = options.path ?? "/admin/agent-mode";
  return async request => {
    const url = new URL(request.url);
    if (url.pathname !== path) return undefined;
    if (!options.authorize(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
    try {
      const envelope = z.object({ action: z.enum(["status", "list", "get", "create", "control", "step", "run", "review", "evidence", "verify", "workspace-grant", "resume-continuation", "enqueue-work", "cycle", "workspace-evidence", "reconcile-tool"]), taskId: identity.optional(), actionId: identity.optional(), idempotencyKey: identity.optional(), dispatchId: identity.optional(), workId: identity.optional(), work: z.unknown().optional(), input: z.unknown().optional(), control: z.unknown().optional(), scope: taskScope.optional(), grant: z.unknown().optional(), proof: z.unknown().optional(), explicitUserAction: z.boolean().optional(), workerName: identity.optional(), reviewId: identity.optional(), evidence: z.unknown().optional() }).strict().parse(await readJsonRequestBody(request, 128 * 1024, 128 * 1024));
      const runtime = options.runtime;
      if (envelope.action === "status") return success({ ...runtime.status(), ...listing(runtime), capabilities: { ...runtime.status().capabilities, observedEvidence: Boolean(options.resolveEvidence || options.observeWorkspaceEvidence) } });
      if (envelope.action === "list") return success(listing(runtime));
      if (envelope.action === "create") {
        const task = runtime.create(identity.parse(envelope.actionId), create.parse(envelope.input));
        return success({ task: runtime.store.getTask(task.id) }, 201);
      }
      const taskId = identity.parse(envelope.taskId);
      if (envelope.action === "get") {
        runtime.reconcileToolReceipts(taskId);
        const task = runtime.store.getTask(taskId);
        const allDispatches = runtime.store.listDispatches(taskId);
        const dispatches = boundedRows(allDispatches);
        const pendingCalls = pendingToolCalls(runtime, task, allDispatches);
        const messages = boundedRows(runtime.store.listMessages(taskId));
        const receipts = boundedRows(runtime.store.listReceipts(taskId), 100, 64 * 1024);
        const toolOutcomes = boundedRows(runtime.store.listToolOutcomes(taskId));
        const effectiveToolOutcomes = boundedRows(runtime.store.effectiveToolOutcomes(taskId));
        const toolReconciliations = boundedRows(runtime.store.listToolReconciliations(taskId));
        const workPackets = boundedRows(runtime.store.listWork(taskId));
        const workspaceEvidence = boundedRows(runtime.workspaceEvidenceReferences(taskId));
        return success({ task, activeEvidence: activeTaskEvidence(task), workspaceEvidence: workspaceEvidence.rows, workers: runtime.store.listWorkers(taskId), pendingToolCalls: pendingCalls.rows, dispatches: dispatches.rows, messages: messages.rows, receipts: receipts.rows, toolOutcomes: toolOutcomes.rows, effectiveToolOutcomes: effectiveToolOutcomes.rows, toolReconciliations: toolReconciliations.rows, workPackets: workPackets.rows, loopSource: "mailbox", snapshotReceipts: runtime.snapshotReceipts(taskId),
          coverage: { pendingToolCalls: { total: pendingCalls.total, truncated: pendingCalls.truncated }, dispatches: { total: dispatches.total, truncated: dispatches.truncated }, messages: { total: messages.total, truncated: messages.truncated }, receipts: { total: receipts.total, truncated: receipts.truncated }, workspaceEvidence: { total: workspaceEvidence.total, truncated: workspaceEvidence.truncated }, toolReconciliations: { total: toolReconciliations.total, truncated: toolReconciliations.truncated }, effectiveToolOutcomes: { total: effectiveToolOutcomes.total, truncated: effectiveToolOutcomes.truncated } } });
      }
      const actionId = identity.parse(envelope.actionId);
      if (envelope.action === "reconcile-tool") return success(await runtime.reconcileTool(taskId, actionId, taskScope.parse(envelope.scope), identity.parse(envelope.idempotencyKey)));
      if (envelope.action === "workspace-evidence") {
        if (!options.observeWorkspaceEvidence) return Response.json({ ok: false, error: "workspace_observer_unavailable" }, { status: 503 });
        const scope = taskScope.parse(envelope.scope);
        const task = runtime.store.getTask(taskId);
        if (scope.familyId !== task.familyId || scope.generation !== task.generation || scope.revision !== task.revision) throw new Error("Stale task action scope");
        const observed = await options.observeWorkspaceEvidence(task, envelope.proof);
        if (observed.evidence.taskRevision !== task.revision || !task.requirements.some(requirement => requirement.id === observed.evidence.requirementId)) throw new Error("Stale workspace outcome scope");
        return success({ task: runtime.recordObservedEvidence(taskId, actionId, observed.evidence), reference: observed.reference, evidence: observed.evidence });
      }
      if (envelope.action === "enqueue-work") return success(runtime.enqueueWork(taskId, actionId, taskScope.parse(envelope.scope), z.object({ workId: identity, workKey: identity, text: boundedText }).strict().parse(envelope.work)));
      if (envelope.action === "cycle") {
        if (envelope.explicitUserAction !== true) return Response.json({ ok: false, error: "explicit_action_required" }, { status: 400 });
        return success({ task: runtime.cycle(taskId, actionId, taskScope.parse(envelope.scope), envelope.workId) });
      }
      if (envelope.action === "workspace-grant") return success({ task: runtime.attachWorkspaceGrant(taskId, actionId, taskScope.parse(envelope.scope), envelope.grant) });
      if (envelope.action === "resume-continuation") return success({ task: runtime.resumeContinuation(taskId, actionId, taskScope.parse(envelope.scope), identity.parse(envelope.dispatchId)) });
      if (envelope.action === "control") return success({ task: runtime.control(taskId, actionId, control.parse(envelope.control), envelope.scope) });
      if (envelope.action === "step" || envelope.action === "run") return success(runtime.step(taskId, actionId, { explicitUserAction: envelope.explicitUserAction === true, workerName: envelope.workerName, automatic: envelope.action === "run" }, envelope.scope), 202);
      if (envelope.action === "review") return success({ task: runtime.review(taskId, actionId, envelope.scope) });
      if (envelope.action === "verify") return success({ task: runtime.verify(taskId, actionId, identity.parse(envelope.reviewId), envelope.scope) });
      if (!options.resolveEvidence) return Response.json({ ok: false, error: "observed_evidence_unavailable", message: "A trusted outcome observer is not configured. Model text and caller assertions cannot verify an outcome." }, { status: 503 });
      const task = runtime.store.getTask(taskId);
      const reference = evidenceReference.parse(envelope.evidence);
      const observed = await options.resolveEvidence(task, reference);
      if (observed.taskRevision !== task.revision || observed.requirementId !== reference.requirementId || observed.sourceEventId !== reference.sourceEventId || observed.subject !== reference.subject || observed.subjectRevision !== reference.subjectRevision || observed.property !== reference.property) throw new Error("Outcome observer returned a different source scope");
      return success({ task: runtime.recordObservedEvidence(taskId, actionId, observed) });
    } catch (error) {
      if (error instanceof NativeRequestBodyError) return Response.json({ ok: false, error: "invalid_request", message: error.message }, { status: error.status });
      if (error instanceof z.ZodError) return Response.json({ ok: false, error: "invalid_request", message: "The Agent action does not match its bounded schema." }, { status: 400 });
      // Domain errors are fixed internal strings; do not echo unknown exceptions or SQL/filesystem details.
      const message = (error as { code?: unknown })?.code === "EVIDENCE_STALE" ? "The workspace file changed after observation. Inspect its current revision and observe it again before verification."
        : error instanceof Error && /^(?:Task |Manual |Unknown send|Agent provider|Select a configured|This provider|Loop requires|Stopped task|Current complete|Requirement outcome|Stale |Execution owner|Action identity|Stage is|Worker |Empty Continue|Tool receipt|Tool reconciliation)/.test(error.message) ? error.message : "The Agent action could not be completed; inspect its current durable state before retrying.";
      return Response.json({ ok: false, error: "agent_action_conflict", message }, { status: 409 });
    }
  };
}
