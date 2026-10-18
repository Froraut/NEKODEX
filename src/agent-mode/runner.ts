import { randomUUID } from "node:crypto";
import { AgentModeStore } from "./store";
import type { AgentControl, AgentDispatch, AgentExecutionPort, AgentTask, OutcomeReviewPort } from "./types";

/** An event-driven stepper, never a background polling/Continue loop. The host owns scheduling. */
export class AgentModeRunner {
  private readonly live = new Map<string, { taskId: string; abort: AbortController }>();
  private stopping = false;
  constructor(readonly store: AgentModeStore, private readonly port: AgentExecutionPort, readonly ownerId: string = randomUUID(), private readonly options: { beforeOffer?: (input: { task: AgentTask; dispatch: AgentDispatch }) => Promise<void> } = {}) {}

  /** Exactly one persisted stage attempt. Manual tasks require an explicit user action. */
  async runNext(taskId: string, options: { reservedSpend: number; workerName?: string; explicitUserAction?: boolean }): Promise<AgentDispatch | undefined> {
    const dispatch = this.prepareNext(taskId, options);
    return dispatch ? this.executeDispatch(dispatch.id) : undefined;
  }

  /** Admission can be committed together with a host action receipt before any network call. */
  prepareNext(taskId: string, options: { reservedSpend: number; workerName?: string; explicitUserAction?: boolean }): AgentDispatch | undefined {
    let task = this.store.getTask(taskId);
    if (task.mode === "manual" && options.explicitUserAction !== true) throw new Error("Manual execution requires a user action");
    if (this.store.listDispatches(taskId).some(row => row.state === "unknown")) throw new Error("Unknown send requires reconciliation; replay forbidden");
    task = this.store.claim(taskId, this.ownerId, task.generation);
    const stage = task.stages.find(row => row.status === "pending" && (row.dependsOn ?? []).every(key => task.stages.find(dependency => dependency.id === key)?.status === "completed"));
    if (!stage) {
      if (!task.stages.some(row => row.status === "running")) this.store.hold(taskId, this.ownerId, task.generation, "no_new_work");
      return undefined;
    }
    if (task.turns >= task.bounds.maxTurns || (task.bounds.maxSpend !== null && task.spent + task.reserved + options.reservedSpend > task.bounds.maxSpend)) {
      this.store.hold(taskId, this.ownerId, task.generation, task.turns >= task.bounds.maxTurns ? "turn_bound" : "spend_bound");
      throw new Error("Task turn/spend bound");
    }
    const worker = this.store.worker(taskId, options.workerName ?? "primary");
    return this.store.admit(taskId, this.ownerId, task.generation, worker.id, stage.id, options.reservedSpend);
  }

  async executeDispatch(dispatchId: string): Promise<AgentDispatch> {
    const dispatch = this.store.getDispatch(dispatchId);
    const taskId = dispatch.taskId;
    if (this.stopping) { this.store.failBeforeOffer(dispatchId, this.ownerId); throw new Error("Task runtime admission is closed"); }
    if (this.options.beforeOffer) {
      try { await this.options.beforeOffer({ task: this.store.getTask(taskId), dispatch }); }
      catch (error) { this.store.failBeforeOffer(dispatchId, this.ownerId); throw error; }
    }
    if (this.stopping) { this.store.failBeforeOffer(dispatchId, this.ownerId); throw new Error("Task runtime admission is closed"); }
    const offered = this.store.offer(dispatchId, this.ownerId);
    const task = this.store.getTask(taskId);
    const stage = task.stages.find(row => row.id === dispatch.stageId)!;
    const worker = this.store.listWorkers(taskId).find(row => row.id === dispatch.workerId)!;
    const reports = this.store.listDispatches(taskId).filter(row => row.taskRevision === task.revision && row.state === "settled" && row.result)
      .map(row => ({ dispatchId: row.id, workerId: row.workerId, stageId: row.stageId, summary: row.result!.summary }));
    const sourceDispatch = dispatch.continuationOf ? this.store.getDispatch(dispatch.continuationOf) : undefined;
    const source = sourceDispatch?.result?.continuation;
    const outcomes = source ? this.store.listToolOutcomes(taskId).filter(row => row.scope.generation === sourceDispatch!.generation && source.pending.some(call => call.toolCallId === row.scope.toolCallId)) : [];
    if (source && (outcomes.length !== source.pending.length || outcomes.some(row => row.state === "outcome_unknown"))) { this.store.markUnknown(dispatchId, "tool_continuation_results_missing"); throw new Error("Unknown send requires complete owned tool results"); }
    const abort = new AbortController(); this.live.set(dispatch.id, { taskId, abort });
    try {
      const result = await this.port.execute({
        dispatch: offered,
        task: this.store.getTask(taskId),
        stage,
        worker,
        messages: this.store.mailbox(taskId, worker.id).filter(row => offered.messages.some(selected => selected.id === row.id && selected.revision === row.revision)),
        history: { reports: reports.slice(-8), total: reports.length, truncated: reports.length > 8 },
        ...(source ? { continuation: { source, outcomes } } : {}),
        signal: abort.signal,
      }, receipt => { this.store.acknowledge(dispatch.id, receipt); });
      // Receipt validation and persistence happen before a stage can advance.
      return this.store.settle(dispatch.id, result);
    } catch (error) {
      // A thrown promise says nothing about the external effect, including after cancellation.
      // Do not store provider error strings, which can contain credentials or private tool output.
      this.store.markUnknown(dispatch.id, "execution_outcome_unknown");
      throw error;
    } finally { this.live.delete(dispatch.id); }
  }

  control(taskId: string, action: AgentControl): AgentTask {
    const task = this.store.control(taskId, action);
    for (const operation of this.live.values()) if (operation.taskId === taskId) operation.abort.abort();
    return task;
  }

  /** DW9 comes before automatic completion: helper text is a recommendation, not outcome proof. */
  async reviewOutcome(taskId: string, helper: OutcomeReviewPort): Promise<AgentTask> {
    const task = this.store.getTask(taskId);
    if (task.review?.generation === task.generation && task.review.taskRevision === task.revision && task.review.evidenceRevision === task.evidenceRevision) return task;
    const review = await helper.review(task);
    return this.store.recordReview(taskId, review);
  }

  get liveDispatchIds(): string[] { return [...this.live.keys()]; }

  /** Graceful shutdown does not declare a physical send cancelled or free an uncertain owner. */
  abortLocalWork(): void { for (const operation of this.live.values()) operation.abort.abort(); }
  beginShutdown(): void { this.stopping = true; this.abortLocalWork(); }
}
