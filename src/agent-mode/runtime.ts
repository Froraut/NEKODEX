import { randomUUID } from "node:crypto";
import { AgentModeRunner } from "./runner";
import { AgentModeStore } from "./store";
import { activeTaskEvidence } from "./evidence";
import { agentModelConfigured, type AgentModelOption } from "./provider";
import type { AgentControl, AgentDispatch, AgentExecutionPort, AgentTask, AgentToolOutcome, AgentWorkPacket, CreateAgentTask, OutcomeEvidence, OutcomeReview } from "./types";

export interface AgentModeRuntimeOptions {
  store: AgentModeStore;
  executionPort: AgentExecutionPort;
  models: () => readonly AgentModelOption[];
  ownerId?: string;
  configured?: () => boolean;
  /** Shared service admission; draining or shutdown cannot schedule another stage. */
  canStart?: () => boolean;
  beforeOffer?: (input: { task: AgentTask; dispatch: AgentDispatch }) => Promise<void>;
  toolsAvailable?: () => boolean;
  snapshotReceipts?: (task: AgentTask) => unknown[];
  lookupToolOutcome?: (idempotencyKey: string) => AgentToolOutcome | undefined;
  /** Trusted synchronous host observation immediately before final verification, including receipt retries. */
  beforeVerify?: (task: AgentTask) => void;
  workspaceEvidenceReferences?: (task: AgentTask) => unknown[];
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
  private stopping = false;
  private shutdownFinished = false;
  constructor(private readonly options: AgentModeRuntimeOptions) {
    this.store = options.store;
    this.runner = new AgentModeRunner(options.store, options.executionPort, options.ownerId, { beforeOffer: async input => {
      if (this.stopping || options.canStart?.() === false) throw new Error("Task runtime admission is closed");
      await options.beforeOffer?.(input);
      if (this.stopping || options.canStart?.() === false) throw new Error("Task runtime admission is closed");
    } });
  }
  status() {
    return { configured: this.options.configured?.() ?? this.options.models().length > 0,
      models: this.options.models(), capabilities: { tools: this.options.toolsAvailable?.() ?? false, workspace: false, autoSchedule: true, monetaryQuotes: Boolean(this.options.reserveSpend), loopSource: "mailbox", externalWatchers: false },
      ownerId: this.runner.ownerId, activeDispatchIds: this.runner.liveDispatchIds, accepting: !this.stopping && (this.options.canStart?.() ?? true) };
  }
  create(actionId: string, input: CreateAgentTask): AgentTask {
    if (!input.id) throw new Error("Stable task identity required");
    if (!input.execution || !this.options.models().some(row => row.id === input.execution?.model)) throw new Error("Select a configured Agent model");
    return this.store.command(input.id, actionId, "create", input, () => this.store.createTask(input)).result;
  }
  control(taskId: string, actionId: string, control: AgentControl, scope?: AgentActionScope): AgentTask {
    return this.store.command(taskId, actionId, "control", scope ? { control, scope } : control, () => { this.assertScope(taskId, scope); return this.runner.control(taskId, control); }).result;
  }
  step(taskId: string, actionId: string, input: { explicitUserAction: boolean; workerName?: string; automatic?: boolean }, scope?: AgentActionScope): { task: AgentTask; dispatchId?: string; duplicate: boolean } {
    if (input.explicitUserAction !== true) throw new Error("A user action is required to start Agent execution");
    if (this.stopping || this.options.canStart?.() === false) throw new Error("Task runtime admission is closed");
    const task = this.store.getTask(taskId);
    if (!agentModelConfigured(task, this.options.models()) || this.options.configured?.() === false) throw new Error("Agent provider/model is unavailable");
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
    if (!command.duplicate && command.result) this.launch(command.result, input.automatic === true);
    return { task: this.store.getTask(taskId), dispatchId: command.result?.id, duplicate: command.duplicate };
  }
  private prepare(taskId: string, input: { explicitUserAction: boolean; workerName?: string }): AgentDispatch | undefined {
    if (this.stopping || this.options.canStart?.() === false) throw new Error("Task runtime admission is closed");
    const task = this.store.getTask(taskId);
    if (task.bounds.maxSpend !== null && !this.options.reserveSpend) throw new Error("This provider has no monetary quote; choose an explicit turn bound and no monetary budget");
    return this.runner.prepareNext(taskId, { explicitUserAction: input.explicitUserAction, workerName: input.workerName, reservedSpend: task.bounds.maxSpend === null ? 0 : this.options.reserveSpend!(task) });
  }
  private launch(dispatch: AgentDispatch, automatic: boolean): void {
    const promise = this.runner.executeDispatch(dispatch.id).then(() => {
      const task = this.store.getTask(dispatch.taskId);
      if (!automatic || this.stopping || this.options.canStart?.() === false || task.generation !== dispatch.generation || task.mode === "manual") return;
      if (task.mode === "loop" && task.status === "review_required") { this.advanceLoop(task.id); return; }
      if (task.status !== "ready") return;
      const input = { explicitUserAction: false, workerName: this.store.listWorkers(task.id).find(row => row.id === dispatch.workerId)?.name };
      const next = this.store.command(task.id, `auto:${dispatch.id}`, "auto_step", input, () => this.prepare(task.id, input));
      if (!next.duplicate && next.result) this.launch(next.result, true);
    }).catch(() => {
      // Runner persisted unknown send or the bound hold. Never retry from a rejected promise.
      this.pauseAtBound(dispatch.taskId);
    }).finally(() => { this.pending.delete(dispatch.id); });
    this.pending.set(dispatch.id, promise);
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
  recordToolOutcome(outcome: AgentToolOutcome): AgentTask { return this.store.recordToolOutcome(outcome); }
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
    return this.store.command(taskId, actionId, "mailbox_cycle", { scope, workId }, () => {
      this.assertScope(taskId, scope);
      return this.store.claimNextWork(taskId, { ownerId: this.runner.ownerId, automatic: false, workId }) ?? this.store.getTask(taskId);
    }).result;
  }
  private advanceLoop(taskId: string): void {
    if (this.stopping || this.options.canStart?.() === false) return;
    const next = this.store.claimNextWork(taskId, { ownerId: this.runner.ownerId, automatic: true });
    if (!next || next.status !== "ready") return;
    try {
      const dispatch = this.prepare(taskId, { explicitUserAction: false });
      if (dispatch) this.launch(dispatch, true);
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
    if (!command.duplicate && command.result.dispatchId) this.launch(this.store.getDispatch(command.result.dispatchId), false);
    return { ...command.result, duplicate: command.duplicate };
  }
  /** Fixture/shutdown observation only; no timer or repeated polling. */
  async waitForIdle(): Promise<void> { while (this.pending.size) await Promise.allSettled([...this.pending.values()]); }
  abortLocalWork(): void { this.runner.abortLocalWork(); }
  beginShutdown(): void { this.stopping = true; this.runner.beginShutdown(); }
  finishShutdown(): void {
    if (this.shutdownFinished) return;
    if (this.pending.size) throw new Error("Agent operations have not settled");
    for (const task of this.store.listTasks()) if (task.ownerId === this.runner.ownerId) {
      this.store.recoverOwner(task.id, { ownerId: this.runner.ownerId, stopped: true, receiptId: `shutdown:${randomUUID()}` });
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
}
