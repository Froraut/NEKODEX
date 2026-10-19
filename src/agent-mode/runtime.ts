import { randomUUID } from "node:crypto";
import { AgentModeRunner } from "./runner";
import { AgentModeStore } from "./store";
import { projectNativeSelectedAttachments } from "./native-images";
import { activeTaskEvidence } from "./evidence";
import { agentModelConfigured, agentModelAccepting, agentNativeConcurrency, type AgentModelOption } from "./provider";
import { nativeScopeOf, sameNativeScope, type AgentNativeScope } from "./native-protocol";
import type { AgentControl, AgentDispatch, AgentExecutionPort, AgentTask, AgentToolOutcome, AgentToolReceiptRequest, AgentToolReconciliationResult, AgentWorkPacket, CreateAgentTask, OutcomeEvidence, OutcomeReview } from "./types";

export interface AgentModeRuntimeOptions {
  store: AgentModeStore;
  executionPort: AgentExecutionPort;
  models: () => readonly AgentModelOption[];
  ownerId?: string;
  configured?: () => boolean;
  /** Shared service admission; draining or shutdown cannot schedule another stage. */
  canStart?: () => boolean;
  /** Provider-specific admission. Native availability must not be inferred from Web readiness. */
  canExecute?: (task: AgentTask) => boolean;
  beforeOffer?: (input: { task: AgentTask; dispatch: AgentDispatch }) => Promise<void>;
  toolsAvailable?: () => boolean;
  snapshotReceipts?: (task: AgentTask) => unknown[];
  lookupToolOutcome?: (idempotencyKey: string) => AgentToolOutcome | undefined;
  /** Reads/reconciles an exact retained provider receipt. This port must never authorize, start or execute a tool. */
  reconcileToolReceipt?: (request: AgentToolReceiptRequest) => Promise<AgentToolOutcome | undefined> | AgentToolOutcome | undefined;
  /** Trusted synchronous host observation immediately before final verification, including receipt retries. */
  beforeVerify?: (task: AgentTask) => void;
  workspaceEvidenceReferences?: (task: AgentTask) => unknown[];
  /** Invalidates already queued/in-flight tool input after a committed generation change; never starts a host. */
  onTaskScopeInvalidated?: (taskId: string) => void;
  /** Real monetary upper bound. Omit for subscription providers with no monetary quotes. */
  reserveSpend?: (task: AgentTask) => number;
}
export interface ScopedAgentAction {
  taskId: string;
  actionId: string;
  familyId: string;
  generation: number;
  revision: number;
  operation: "pause" | "resume" | "stop" | "step" | "review";
}
export interface AgentActionScope { familyId: string; generation: number; revision: number }

/** Composition for the authenticated local admin surface. Opening this runtime does no work. */
export class AgentModeRuntime {
  readonly store: AgentModeStore;
  readonly runner: AgentModeRunner;
  private readonly pending = new Map<string, Promise<unknown>>();
  /** A durable run command authorizes only this live runtime and exact task scope. Never restored from status. */
  private readonly automaticRuns = new Map<string, AgentActionScope & { ownerId: string }>();
  private stopping = false;
  private shutdownFinished = false;
  constructor(private readonly options: AgentModeRuntimeOptions) {
    this.store = options.store;
    this.runner = new AgentModeRunner(options.store, options.executionPort, options.ownerId, { beforeOffer: async input => {
      if (this.stopping || options.canStart?.() === false) throw new Error("Task runtime admission is closed");
      this.assertExecutionAvailable(input.task);
      await options.beforeOffer?.(input);
      if (this.stopping || options.canStart?.() === false) throw new Error("Task runtime admission is closed");
      this.assertExecutionAvailable(this.store.getTask(input.task.id));
    } });
  }
  status() {
    return { configured: this.options.configured?.() ?? this.options.models().length > 0,
      models: this.options.models(), capabilities: { tools: this.options.toolsAvailable?.() ?? false, workspace: false, autoSchedule: true, monetaryQuotes: Boolean(this.options.reserveSpend), loopSource: "mailbox", externalWatchers: false, toolReconciliation: Boolean(this.options.reconcileToolReceipt),
        ownedNative: { configured: this.options.models().some(row => row.provider === "owned-native" && row.available === true && Boolean(row.admissionId)), imageInput: this.options.models().some(row => row.provider === "owned-native" && row.imageInput === true), turnUnit: "native-offers", actualProviderRequestCount: null } },
      ownerId: this.runner.ownerId, activeDispatchIds: this.runner.liveDispatchIds, accepting: !this.stopping && (this.options.canStart?.() ?? true) };
  }
  create(actionId: string, input: CreateAgentTask): AgentTask {
    if (!input.id) throw new Error("Stable task identity required");
    if (!agentModelConfigured(input, this.options.models())) throw new Error("Select a configured Agent model");
    return this.store.command(input.id, actionId, "create", input, () => {
      if (input.nativeAttachments !== undefined) {
        const model = this.options.models().find(row => row.id === input.execution?.model && row.provider === "owned-native" && input.execution?.provider === "owned-native" && row.admissionId === input.execution.admissionId);
        if (!model) throw new Error("Task selected attachments require Native execution");
        projectNativeSelectedAttachments({ attachments: input.nativeAttachments, modelImageInput: model.imageInput === true });
      }
      return this.store.createTask(input, input.execution?.provider === "owned-native" ? agentNativeConcurrency(input, this.options.models()) : 1);
    }).result;
  }
  control(taskId: string, actionId: string, control: AgentControl, scope?: AgentActionScope): AgentTask {
    const command = this.store.command(taskId, actionId, "control", scope ? { control, scope } : control, () => { this.assertScope(taskId, scope); return this.runner.control(taskId, control); });
    if (!command.duplicate) { this.automaticRuns.delete(taskId); this.options.onTaskScopeInvalidated?.(taskId); }
    return command.result;
  }
  /** Explicitly refresh the same selected provider/model without offering any work. */
  refreshExecution(taskId: string, actionId: string, scope: AgentActionScope, explicitUserAction: boolean): AgentTask {
    if (explicitUserAction !== true) throw new Error("Task execution refresh requires an explicit user action");
    if (this.stopping || this.options.canStart?.() === false) throw new Error("Task runtime admission is closed");
    const command = this.store.command(taskId, actionId, "refresh_execution", { scope, explicitUserAction }, () => {
      this.assertScope(taskId, scope);
      const task = this.store.getTask(taskId), old = task.execution;
      if (!old || task.ownerId && task.ownerId !== this.runner.ownerId) throw new Error("Execution owner or selected model is unavailable");
      const dispatches = this.store.listDispatches(taskId);
      if (dispatches.some(row => this.runner.liveDispatchIds.includes(row.id) || this.pending.has(row.id))) throw new Error("Task still has live execution");
      const effective = this.store.effectiveToolOutcomes(taskId);
      for (const dispatch of dispatches) for (const call of dispatch.result?.continuation?.pending ?? []) {
        const key = this.store.toolCallReceiptKey(dispatch.id, call.toolCallId);
        // A host journal intent can exist before its outcome has reached the task ledger.
        if (!effective.some(row => row.idempotencyKey === key) && this.options.lookupToolOutcome?.(key)?.state === "outcome_unknown") throw new Error("Task has an unknown tool outcome; reconcile before refreshing");
      }
      const models = this.options.models().filter(row => row.id === old.model && (row.provider ?? "local-responses") === old.provider
        && (old.provider === "owned-native" ? row.available === true && Boolean(row.admissionId) : row.available !== false) && row.accepting !== false);
      if (models.length !== 1) throw new Error("Agent provider/model has no unique available current binding");
      const execution = old.provider === "owned-native" ? { provider: old.provider, model: old.model, admissionId: models[0]!.admissionId! } : { ...old };
      this.assertExecutionAvailable({ ...task, execution });
      return this.store.refreshExecution(taskId, execution, execution.provider === "owned-native" ? agentNativeConcurrency({ execution }, models) : 1);
    });
    if (!command.duplicate) { this.automaticRuns.delete(taskId); this.options.onTaskScopeInvalidated?.(taskId); }
    return command.result;
  }
  step(taskId: string, actionId: string, input: { explicitUserAction: boolean; workerName?: string; automatic?: boolean }, scope?: AgentActionScope): { task: AgentTask; dispatchId?: string; duplicate: boolean } {
    if (input.explicitUserAction !== true) throw new Error("A user action is required to start Agent execution");
    if (this.stopping || this.options.canStart?.() === false) throw new Error("Task runtime admission is closed");
    const task = this.store.getTask(taskId);
    this.assertExecutionAvailable(task);
    if (task.execution?.provider === "owned-native" && task.bounds.maxSpend !== null) throw new Error("This provider has no monetary quote; choose an explicit Native offer bound and no monetary budget");
    if (input.automatic && task.mode === "manual") throw new Error("Manual mode runs one explicit stage at a time");
    let command: { result: AgentDispatch | undefined; duplicate: boolean };
    try { command = this.store.command(taskId, actionId, input.automatic ? "run" : "step", scope ? { input, scope } : input, () => {
      this.assertScope(taskId, scope);
      if (input.automatic && this.store.getTask(taskId).mode === "loop") {
        this.store.enableLoopRun(taskId, this.runner.ownerId);
        if (this.store.getTask(taskId).status === "review_required") {
          const next = this.store.claimNextWork(taskId, { ownerId: this.runner.ownerId, automatic: false });
          if (!next || next.status !== "ready") return undefined;
          this.store.enableLoopRun(taskId, this.runner.ownerId);
        }
      }
      return this.prepare(taskId, input);
    }); }
    catch (error) { this.pauseAtBound(taskId); throw error; }
    if (!command.duplicate && this.store.getTask(taskId).generation !== task.generation) this.options.onTaskScopeInvalidated?.(taskId);
    if (!command.duplicate) {
      if (input.automatic) this.rememberAutomaticRun(this.store.getTask(taskId));
      else this.automaticRuns.delete(taskId);
      if (command.result) {
        this.launch(command.result, input.automatic === true);
        if (input.automatic) this.continueAutomatic(command.result);
      }
    }
    return { task: this.store.getTask(taskId), dispatchId: command.result?.id, duplicate: command.duplicate };
  }
  private prepare(taskId: string, input: { explicitUserAction: boolean; workerName?: string }): AgentDispatch | undefined {
    if (this.stopping || this.options.canStart?.() === false) throw new Error("Task runtime admission is closed");
    const task = this.store.getTask(taskId);
    this.assertExecutionAvailable(task);
    if (task.execution?.provider === "owned-native" && task.bounds.maxSpend !== null) throw new Error("This provider has no monetary quote; choose an explicit Native offer bound and no monetary budget");
    if (task.bounds.maxSpend !== null && !this.options.reserveSpend) throw new Error("This provider has no monetary quote; choose an explicit turn bound and no monetary budget");
    return this.runner.prepareNext(taskId, { explicitUserAction: input.explicitUserAction, workerName: input.workerName, reservedSpend: task.bounds.maxSpend === null ? 0 : this.options.reserveSpend!(task) });
  }
  private launch(dispatch: AgentDispatch, automatic: boolean): void {
    const promise = this.runner.executeDispatch(dispatch.id).then(() => {
      if (automatic) this.continueAutomatic(dispatch);
    }).catch(() => {
      // Runner persisted unknown send or the bound hold. Never retry from a rejected promise.
      this.pauseAtBound(dispatch.taskId);
    }).finally(() => { this.pending.delete(dispatch.id); });
    this.pending.set(dispatch.id, promise);
  }
  private rememberAutomaticRun(task: AgentTask): void {
    this.automaticRuns.set(task.id, { familyId: task.familyId, generation: task.generation, revision: task.revision, ownerId: this.runner.ownerId });
  }
  private hasAutomaticRun(task: AgentTask): boolean {
    const grant = this.automaticRuns.get(task.id);
    return Boolean(grant && grant.ownerId === this.runner.ownerId && task.ownerId === this.runner.ownerId
      && grant.familyId === task.familyId && grant.generation === task.generation && grant.revision === task.revision && task.mode !== "manual");
  }
  private continueAutomatic(dispatch: AgentDispatch): void {
    const task = this.store.getTask(dispatch.taskId);
    if (!this.hasAutomaticRun(task) || this.stopping || this.options.canStart?.() === false || this.options.canExecute?.(task) === false
      || !agentModelAccepting(task, this.options.models()) || task.generation !== dispatch.generation || task.revision !== dispatch.taskRevision || dispatch.ownerId !== this.runner.ownerId) return;
    if (task.mode === "loop" && task.status === "review_required") { this.advanceLoop(task.id); return; }
    if (!["ready", "running"].includes(task.status)) return;
    // Fill only dependency-ready stages through the same durable sender. No worker
    // can make a waiting/failed sibling eligible or exceed reserved offer slots.
    for (let slot = 0; slot < task.bounds.maxConcurrent; slot++) {
      const current = this.store.getTask(task.id);
      if (!this.hasAutomaticRun(current) || !["ready", "running"].includes(current.status)) return;
      const active = this.store.listDispatches(task.id).filter(row => ["admitted", "offered", "acked", "unknown"].includes(row.state));
      if (active.length >= current.bounds.maxConcurrent) return;
      const stage = current.stages.find(row => row.status === "pending" && !row.waitingFor && (row.dependsOn ?? []).every(key => current.stages.find(dependency => dependency.id === key)?.status === "completed"));
      if (!stage) return;
      if (current.turns + active.filter(row => row.state === "admitted").length >= current.bounds.maxTurns) { if (!active.length) this.pauseAtBound(task.id); return; }
      const input = { explicitUserAction: false };
      try {
        const next = this.store.command(task.id, `auto:${dispatch.id}:${stage.id}`, "auto_step", input, () => this.prepare(task.id, input));
        if (next.duplicate || !next.result) return;
        this.launch(next.result, true);
      } catch { this.pauseAtBound(task.id); return; }
    }
  }

  /** Bounded local evidence helper; no extra, unmetered model call and no auto-send. */
  review(taskId: string, actionId: string, scope?: AgentActionScope): AgentTask {
    const task = this.store.getTask(taskId);
    return this.store.command(taskId, actionId, "review", { generation: task.generation, revision: task.revision, evidenceRevision: task.evidenceRevision, ...(scope ? { scope } : {}) }, () => {
      this.assertScope(taskId, scope);
      if (task.review?.generation === task.generation && task.review.taskRevision === task.revision && task.review.evidenceRevision === task.evidenceRevision) return task;
      const findings: string[] = [];
      const coverage = task.requirements.map(requirement => {
        const facts = activeTaskEvidence(task).filter(row => row.requirementId === requirement.id);
        if (!facts.length || facts.some(row => row.outcome !== "passed")) findings.push(`Outcome evidence is missing, failed or unknown for requirement ${requirement.id}.`);
        return { requirementId: requirement.id, evidenceIds: facts.filter(row => row.outcome === "passed").map(row => row.id) };
      });
      const review: OutcomeReview = { id: randomUUID(), generation: task.generation, taskRevision: task.revision, evidenceRevision: task.evidenceRevision, findings,
        recommendation: findings.length ? "Review the listed requirements, inspect their actual outcomes, and attach exact observed evidence before completing the goal." : "Selected observed evidence covers the declared requirements. Review its scope before explicitly verifying completion.", coverage, completeInput: true };
      return this.store.recordReview(taskId, review);
    }).result;
  }
  /** Only a host observer may construct this. The HTTP layer never accepts raw evidence from a caller. */
  recordObservedEvidence(taskId: string, actionId: string, evidence: OutcomeEvidence): AgentTask {
    return this.store.command(taskId, actionId, "observed_evidence", evidence, () => this.store.recordEvidence(taskId, evidence)).result;
  }
  resolveToolCall(scope: AgentToolOutcome["scope"]) { return this.store.resolveToolCall(scope); }
  /** Trusted provider seam, never an HTTP action that accepts a caller-chosen new digest. */
  claimNativeTransport(request: import("./types").ExecutionRequest, payloadDigest: string): void {
    const task = this.store.getTask(request.task.id); const dispatch = this.store.getDispatch(request.dispatch.id);
    const execution = task.execution;
    if (execution?.provider !== "owned-native" || request.task.execution?.provider !== "owned-native" || execution.model !== request.task.execution.model || execution.admissionId !== request.task.execution.admissionId
      || !sameNativeScope(nativeScopeOf(request), { taskId: task.id, familyId: task.familyId, generation: task.generation, revision: task.revision,
        dispatchId: dispatch.id, ownerId: dispatch.ownerId, agentWorkerId: dispatch.workerId })
      || dispatch.taskId !== task.id || dispatch.generation !== task.generation || dispatch.taskRevision !== task.revision || dispatch.ownerId !== this.runner.ownerId || task.ownerId !== this.runner.ownerId
      || dispatch.state !== "offered" || task.status !== "running" || !this.runner.liveDispatchIds.includes(dispatch.id) || this.stopping || this.options.canStart?.() === false) throw new Error("Stale Native execution claim");
    this.assertExecutionAvailable(task);
    this.store.claimTransport(dispatch.id, this.runner.ownerId, payloadDigest);
  }
  /** Main's read-only cross-check of an ALREADY committed exact offer, never authority by bearer alone. */
  validateNativeOffer(input: { scope: AgentNativeScope; payloadDigest: string; model: string; admissionId: string }): { claimId: string; payloadDigest: string; scope: AgentNativeScope } {
    const task = this.store.getTask(input.scope.taskId); const dispatch = this.store.getDispatch(input.scope.dispatchId);
    const execution = task.execution;
    if (execution?.provider !== "owned-native" || execution.model !== input.model || execution.admissionId !== input.admissionId
      || !sameNativeScope(input.scope, { taskId: task.id, familyId: task.familyId, generation: task.generation, revision: task.revision, dispatchId: dispatch.id, ownerId: dispatch.ownerId, agentWorkerId: dispatch.workerId })
      || dispatch.taskId !== task.id || dispatch.generation !== task.generation || dispatch.taskRevision !== task.revision || task.status !== "running" || task.ownerId !== this.runner.ownerId || dispatch.ownerId !== this.runner.ownerId
      || !["offered", "acked"].includes(dispatch.state) || !this.runner.liveDispatchIds.includes(dispatch.id) || !dispatch.transportClaim || !/^[a-f0-9]{64}$/.test(input.payloadDigest) || dispatch.transportClaim.payloadDigest !== input.payloadDigest
      || this.stopping || this.options.canStart?.() === false) throw new Error("Stale Native execution claim");
    this.assertExecutionAvailable(task);
    return { claimId: dispatch.transportClaim.id, payloadDigest: input.payloadDigest, scope: { ...input.scope } };
  }
  recordToolOutcome(outcome: AgentToolOutcome): AgentTask {
    const task = this.store.recordToolOutcome(outcome);
    if (outcome.state === "outcome_unknown") this.automaticRuns.delete(task.id);
    // Only this live callback may continue a previously authorized run. Passive receipt reads and reconciliation never send.
    if (outcome.state !== "outcome_unknown" && ["ready", "running"].includes(task.status) && this.hasAutomaticRun(task)) {
      const source = this.store.listDispatches(task.id).find(row => row.state === "settled" && row.result?.continuation?.pending
        .some(call => call.toolCallId === outcome.scope.toolCallId && call.tool === outcome.tool)
        && row.generation === outcome.scope.generation && this.store.toolCallReceiptKey(row.id, outcome.scope.toolCallId) === outcome.idempotencyKey);
      if (source) this.continueAutomatic(source);
    }
    return task;
  }
  async reconcileTool(taskId: string, actionId: string, scope: AgentActionScope, idempotencyKey: string): Promise<AgentToolReconciliationResult> {
    if (this.stopping) throw new Error("Task runtime admission is closed");
    const input = { scope, idempotencyKey };
    const prior = this.store.readCommandResult<AgentToolReconciliationResult>(taskId, actionId, "reconcile_tool", input);
    if (prior) return prior.result;
    this.assertScope(taskId, scope);
    const original = this.store.listToolOutcomes(taskId).find(outcome => outcome.idempotencyKey === idempotencyKey);
    if (!original || original.state !== "outcome_unknown") throw new Error("Tool receipt has no retained unknown outcome");
    const previous = this.store.listToolReconciliations(taskId).find(fact => fact.idempotencyKey === idempotencyKey);
    if (previous) return this.store.command(taskId, actionId, "reconcile_tool", input, () => ({ task: this.store.getTask(taskId), reconciliation: previous, outcome: previous.outcome, unchanged: true })).result;
    if (!this.options.reconcileToolReceipt) throw new Error("Tool receipt reconciliation is unavailable");
    const request = this.store.toolReceiptRequest(taskId, idempotencyKey);
    const operationId = `reconcile:${actionId}:${randomUUID()}`;
    const operation = (async (): Promise<AgentToolReconciliationResult> => {
      const outcome = await this.options.reconcileToolReceipt!(structuredClone(request));
      return this.store.command<AgentToolReconciliationResult>(taskId, actionId, "reconcile_tool", input, () => {
        if (!outcome || outcome.state === "outcome_unknown") return { task: this.store.getTask(taskId), outcome: original, unchanged: true };
        const reconciled = this.store.recordToolReconciliation(taskId, request, outcome, this.stopping ? undefined : this.runner.ownerId);
        return { ...reconciled, outcome: reconciled.reconciliation.outcome, unchanged: false };
      }).result;
    })();
    this.pending.set(operationId, operation);
    try { return await operation; } finally { this.pending.delete(operationId); }
  }
  snapshotReceipts(taskId: string): unknown[] { return this.options.snapshotReceipts?.(this.store.getTask(taskId)) ?? []; }
  workspaceEvidenceReferences(taskId: string): unknown[] { return this.options.workspaceEvidenceReferences?.(this.store.getTask(taskId)) ?? []; }
  reconcileToolReceipts(taskId: string): void {
    if (!this.options.lookupToolOutcome) return;
    const known = this.store.listToolOutcomes(taskId);
    for (const dispatch of this.store.listDispatches(taskId)) for (const call of dispatch.result?.continuation?.pending ?? []) {
      const key = this.store.toolCallReceiptKey(dispatch.id, call.toolCallId);
      if (known.some(outcome => outcome.idempotencyKey === key)) continue;
      const outcome = this.options.lookupToolOutcome(key);
      if (outcome) this.store.recordToolOutcome(outcome);
    }
  }
  resumeContinuation(taskId: string, actionId: string, scope: AgentActionScope, dispatchId: string): AgentTask {
    this.reconcileToolReceipts(taskId);
    return this.store.command(taskId, actionId, "resume_continuation", { scope, dispatchId }, () => {
      this.assertScope(taskId, scope); return this.store.resumeContinuation(taskId, dispatchId, `resume:${actionId}`);
    }).result;
  }
  attachWorkspaceGrant(taskId: string, actionId: string, scope: AgentActionScope, grant: unknown): AgentTask {
    return this.store.command(taskId, actionId, "workspace_snapshot_grant", { scope, grant }, () => {
      this.assertScope(taskId, scope); return this.store.attachWorkspaceSnapshotGrant(taskId, grant);
    }).result;
  }
  enqueueWork(taskId: string, actionId: string, scope: AgentActionScope, work: Pick<AgentWorkPacket, "workId" | "workKey" | "text">) {
    const command = this.store.command(taskId, actionId, "enqueue_work", { scope, work }, () => { this.assertScope(taskId, scope); return this.store.enqueueWork(taskId, work); });
    if (!command.duplicate) this.advanceLoop(taskId);
    return { ...command.result, task: this.store.getTask(taskId) };
  }
  cycle(taskId: string, actionId: string, scope: AgentActionScope, workId?: string): AgentTask {
    const command = this.store.command(taskId, actionId, "mailbox_cycle", { scope, workId }, () => {
      this.assertScope(taskId, scope);
      return this.store.claimNextWork(taskId, { ownerId: this.runner.ownerId, automatic: false, workId }) ?? this.store.getTask(taskId);
    });
    if (!command.duplicate && command.result.generation !== scope.generation) this.options.onTaskScopeInvalidated?.(taskId);
    return command.result;
  }
  private advanceLoop(taskId: string): void {
    if (this.stopping || this.options.canStart?.() === false) return;
    const current = this.store.getTask(taskId);
    if (!this.hasAutomaticRun(current)) return;
    if (this.options.canExecute?.(current) === false || !agentModelAccepting(current, this.options.models())) return;
    const generation = current.generation;
    const next = this.store.claimNextWork(taskId, { ownerId: this.runner.ownerId, automatic: true });
    if (!next) return;
    if (next.generation !== generation) this.options.onTaskScopeInvalidated?.(taskId);
    if (next.status !== "ready") return;
    this.rememberAutomaticRun(next);
    try {
      const dispatch = this.prepare(taskId, { explicitUserAction: false });
      if (dispatch) { this.launch(dispatch, true); this.continueAutomatic(dispatch); }
    } catch { this.pauseAtBound(taskId); }
  }
  verify(taskId: string, actionId: string, reviewId: string, scope?: AgentActionScope): AgentTask {
    const checkCurrent = () => {
      this.assertScope(taskId, scope);
      const checked: unknown = this.options.beforeVerify?.(this.store.getTask(taskId));
      if (checked && typeof (checked as { then?: unknown }).then === "function") {
        void Promise.resolve(checked).catch(() => {});
        throw new Error("Task evidence observer must finish synchronously before verification");
      }
    };
    const command = this.store.command(taskId, actionId, "verify", { reviewId, ...(scope ? { scope } : {}) }, () => {
      checkCurrent(); return this.store.verifyComplete(taskId, reviewId);
    });
    // A transport retry returns its durable receipt only while its selected facts remain current.
    if (command.duplicate) checkCurrent();
    return command.result;
  }
  /** External admin adapters share this owner and cannot apply stale-generation actions. */
  executeScopedAction(input: ScopedAgentAction): { task: AgentTask; dispatchId?: string; duplicate: boolean } {
    const command = this.store.command(input.taskId, input.actionId, "scoped_action", input, () => {
      const task = this.store.getTask(input.taskId);
      if (task.familyId !== input.familyId || task.generation !== input.generation || task.revision !== input.revision) throw new Error("Stale task action scope");
      if (["pause", "resume", "stop"].includes(input.operation)) return { task: this.runner.control(task.id, { action: input.operation as "pause" | "resume" | "stop" }) };
      if (input.operation === "review") return { task: this.review(task.id, `scoped-review:${input.actionId}`) };
      if (input.operation !== "step") throw new Error("Unsupported scoped Agent action");
      const dispatch = this.prepare(task.id, { explicitUserAction: true });
      return { task: this.store.getTask(task.id), dispatchId: dispatch?.id };
    });
    if (!command.duplicate && input.operation !== "review") {
      this.automaticRuns.delete(input.taskId);
      if (["pause", "resume", "stop"].includes(input.operation)) this.options.onTaskScopeInvalidated?.(input.taskId);
    }
    if (!command.duplicate && command.result.dispatchId) this.launch(this.store.getDispatch(command.result.dispatchId), false);
    return { ...command.result, duplicate: command.duplicate };
  }
  /** Fixture/shutdown observation only; no timer or repeated polling. */
  async waitForIdle(): Promise<void> { while (this.pending.size) await Promise.allSettled([...this.pending.values()]); }
  abortLocalWork(): void { this.automaticRuns.clear(); this.runner.abortLocalWork(); }
  beginShutdown(): void { this.stopping = true; this.automaticRuns.clear(); this.runner.beginShutdown(); }
  finishShutdown(): void {
    if (this.shutdownFinished) return;
    if (this.pending.size) throw new Error("Agent operations have not settled");
    for (const task of this.store.listTasks()) if (task.ownerId === this.runner.ownerId) {
      const recovered = this.store.recoverOwner(task.id, { ownerId: this.runner.ownerId, stopped: true, receiptId: `shutdown:${randomUUID()}` });
      if (recovered.generation !== task.generation) this.options.onTaskScopeInvalidated?.(task.id);
    }
    this.shutdownFinished = true;
  }
  get activeCount(): number { return this.pending.size; }
  private pauseAtBound(taskId: string): void {
    const task = this.store.getTask(taskId);
    if (task.ownerId !== this.runner.ownerId || !["ready", "running"].includes(task.status)) return;
    if (task.turns >= task.bounds.maxTurns) this.store.hold(taskId, this.runner.ownerId, task.generation, "turn_bound");
    else if (task.bounds.maxSpend !== null && this.options.reserveSpend && task.spent + task.reserved + this.options.reserveSpend(task) > task.bounds.maxSpend) this.store.hold(taskId, this.runner.ownerId, task.generation, "spend_bound");
  }
  private assertScope(taskId: string, scope?: AgentActionScope): void {
    if (!scope) return;
    const task = this.store.getTask(taskId);
    if (task.familyId !== scope.familyId || task.generation !== scope.generation || task.revision !== scope.revision) throw new Error("Stale task action scope");
  }
  private assertExecutionAvailable(task: AgentTask): void {
    if (task.execution?.provider === "owned-native" && task.bounds.maxConcurrent > agentNativeConcurrency(task, this.options.models())) throw new Error("Native task exceeds current concurrency capacity");
    if (!agentModelAccepting(task, this.options.models()) || this.options.configured?.() === false || this.options.canExecute?.(task) === false) throw new Error("Agent provider/model is unavailable");
  }
}
