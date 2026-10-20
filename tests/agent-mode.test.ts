import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRunner, AgentModeStore } from "../src/agent-mode";
import type { AgentExecutionPort, AgentTask, CreateAgentTask, ExecutionResult, OutcomeReview } from "../src/agent-mode";

const directories: string[] = [];
const openStores: AgentModeStore[] = [];
afterEach(() => {
  for (const store of openStores.splice(0)) { try { store.close(); } catch {} }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function open(path: string): AgentModeStore { const store = new AgentModeStore(path); openStores.push(store); return store; }
function fixture(overrides: Partial<CreateAgentTask> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-agent-")); directories.push(directory);
  const path = join(directory, "agent.sqlite"); const store = open(path);
  const task = store.createTask({ ownerMode: "agent", mode: "goal", originalRequest: "Produce a synthetic artifact and verify its exact contents.", requirements: [{ id: "artifact", text: "The synthetic artifact contains the requested text." }], stages: [{ id: "write", instruction: "Create the synthetic artifact.", requirementIds: ["artifact"] }, { id: "check", instruction: "Inspect exact contents of the synthetic artifact.", requirementIds: ["artifact"], dependsOn: ["write"] }], bounds: { maxConcurrent: 2, maxTurns: 8, maxSpend: 100 }, ...overrides });
  return { store, task, path };
}
function result(id: string, outcome: ExecutionResult["outcome"] = "completed", actualSpend: number | null = 2): ExecutionResult { return { receiptId: id, outcome, summary: "Synthetic port completed its isolated operation.", actualSpend }; }
function review(task: AgentTask, evidenceIds: string[] = []): OutcomeReview {
  return { id: `review-${task.evidenceRevision}`, generation: task.generation, taskRevision: task.revision, evidenceRevision: task.evidenceRevision, findings: [], recommendation: "Review the synthetic outcome coverage.", coverage: [{ requirementId: "artifact", evidenceIds }], completeInput: true };
}

describe("standalone durable Agent mode", () => {
  test("mailbox revisions, unread offers and task-family worker identities survive reopen", () => {
    const { store, task, path } = fixture();
    const worker = store.worker(task.id, "reader");
    const message = store.sendMessage({ taskId: task.id, id: "stable-message", sender: "human", recipient: worker.id, text: "Read the synthetic artifact." });
    store.offerMessage(task.id, message.id, 1, worker.id);
    const reopened = open(path);
    expect(reopened.mailbox(task.id, worker.id, true)).toHaveLength(1);
    expect(reopened.worker(task.id, "reader")).toEqual(worker);
    reopened.acknowledgeMessage(task.id, message.id, 1, worker.id, "mail-ack");
    reopened.sendMessage({ taskId: task.id, id: message.id, revision: 2, sender: "human", recipient: worker.id, text: "Read the corrected synthetic artifact." });
    expect(store.mailbox(task.id, worker.id, true).map(row => row.revision)).toEqual([2]);
    expect(() => reopened.sendMessage({ taskId: task.id, id: message.id, revision: 2, sender: "human", recipient: worker.id, text: "Changed under the same identity." })).toThrow("identity conflict");
    const other = store.createTask({ ...task, id: "other-task", stages: task.stages, ownerMode: "agent" });
    expect(store.worker(other.id, "reader").id).not.toBe(worker.id);
    expect(() => store.acknowledgeMessage(task.id, message.id, 2, "wrong-worker", "wrong-ack")).toThrow("recipient mismatch");
  });

  test("finite stages reuse sleeping worker, persist exact receipts and require observed outcome coverage", async () => {
    const { store, task, path } = fixture(); let sends = 0;
    const port: AgentExecutionPort = { async execute(request, ack) { sends++; expect(request.task.originalRequest).toBe(task.originalRequest); ack(`accept-${sends}`); return result(`finish-${sends}`); } };
    const runner = new AgentModeRunner(store, port, "owner");
    const first = (await runner.runNext(task.id, { reservedSpend: 10 }))!;
    const workerId = first.workerId;
    expect(store.listWorkers(task.id)[0]?.state).toBe("sleeping");
    const second = (await runner.runNext(task.id, { reservedSpend: 10 }))!;
    expect(second.workerId).toBe(workerId);
    expect(store.getTask(task.id)).toMatchObject({ status: "review_required", turns: 2, spent: 4, reserved: 0 });
    store.settle(second.id, result("finish-2"));
    expect(store.getTask(task.id).turns).toBe(2);
    expect(store.listDispatches(task.id)).toHaveLength(2);
    let current = store.getTask(task.id);
    store.recordReview(task.id, review(current));
    expect(() => store.verifyComplete(task.id, "review-0")).toThrow("not verified");
    current = store.recordEvidence(task.id, { id: "fact", taskRevision: 1, requirementId: "artifact", sourceEventId: "synthetic-check-event", subject: "synthetic-artifact", subjectRevision: "sha256:fixture", property: "exact contents", outcome: "passed", observer: "synthetic-fixture-observer" });
    store.recordReview(task.id, review(current, ["fact"]));
    expect(store.verifyComplete(task.id, "review-1").status).toBe("verified_complete");
    expect(open(path).getTask(task.id).status).toBe("verified_complete");
    expect(sends).toBe(2);
    expect(() => store.settle(first.id, result("changed-finish"))).toThrow("receipt conflict");
  });

  test("crash boundaries never replay offered send or lost finish, while never-offered work is safely cancelled", async () => {
    const { store, task, path } = fixture();
    store.claim(task.id, "dead-owner", 1); const worker = store.worker(task.id, "primary");
    const admitted = store.admit(task.id, "dead-owner", 1, worker.id, "write", 10);
    expect(admitted.state).toBe("admitted");
    let reopened = open(path);
    reopened.recoverOwner(task.id, { ownerId: "dead-owner", stopped: true, receiptId: "stopped-before-offer" });
    expect(reopened.getDispatch(admitted.id).state).toBe("cancelled");
    expect(reopened.getTask(task.id).reserved).toBe(0);
    reopened.control(task.id, { action: "resume" });
    let sends = 0;
    const runner = new AgentModeRunner(reopened, { async execute(request, ack) { sends++; expect(reopened.getDispatch(request.dispatch.id).state).toBe("offered"); ack("accepted-before-lost-finish"); throw new Error("synthetic process loss after acceptance"); } }, "crashed-owner");
    await expect(runner.runNext(task.id, { reservedSpend: 10 })).rejects.toThrow("synthetic process loss");
    const uncertain = reopened.listDispatches(task.id).find(row => row.state === "unknown")!;
    expect(uncertain.acceptanceReceipt).toBe("accepted-before-lost-finish");
    reopened = open(path);
    reopened.recoverOwner(task.id, { ownerId: "crashed-owner", stopped: true, receiptId: "stopped-after-ack" });
    reopened.control(task.id, { action: "resume" });
    const next = new AgentModeRunner(reopened, { async execute() { sends++; return result("must-not-send"); } }, "new-owner");
    await expect(next.runNext(task.id, { reservedSpend: 10 })).rejects.toThrow("Unknown send");
    expect(sends).toBe(1);
    // A matching external terminal receipt reconciles; the old stage is not advanced in a new generation.
    reopened.settle(uncertain.id, result("reconciled-terminal"));
    expect(reopened.getDispatch(uncertain.id).late).toBe(true);
    expect(reopened.getTask(task.id).stages[0]?.status).toBe("blocked");
    reopened.adoptLateResult(task.id, uncertain.id, "human-adopts-late-result");
    expect(reopened.getTask(task.id).stages[0]?.status).toBe("completed");
  });

  test("offered-before-ACK recovery stays unknown and only exact not-sent evidence releases its reservation", () => {
    const { store, task, path } = fixture();
    store.claim(task.id, "crashed", 1); const worker = store.worker(task.id, "primary");
    const dispatch = store.admit(task.id, "crashed", 1, worker.id, "write", 10);
    store.offer(dispatch.id, "crashed");
    const reopened = open(path);
    expect(reopened.getDispatch(dispatch.id).state).toBe("offered"); // Reopen is read-only with respect to work.
    reopened.recoverOwner(task.id, { ownerId: "crashed", stopped: true, receiptId: "stopped-offered" });
    expect(reopened.getDispatch(dispatch.id).state).toBe("unknown");
    expect(reopened.getTask(task.id).reserved).toBe(10);
    reopened.settle(dispatch.id, result("proven-not-sent", "not_sent", 0));
    expect(reopened.getTask(task.id).reserved).toBe(0);
    expect(reopened.listWorkers(task.id)[0]?.state).toBe("sleeping");
  });

  test("user correction aborts the local port and retains late results without completing its replacement", async () => {
    const { store, task } = fixture(); let finish!: (value: ExecutionResult) => void; let reached = false; let signal!: AbortSignal;
    const runner = new AgentModeRunner(store, { execute(request, ack) { reached = true; signal = request.signal; ack("old-accept"); return new Promise(resolve => { finish = resolve; }); } }, "owner");
    const running = runner.runNext(task.id, { reservedSpend: 10 });
    expect(reached).toBe(true);
    runner.control(task.id, { action: "correct", text: "Use the replacement requirement.", requirements: [{ id: "artifact", text: "Replacement contents." }], stages: [{ id: "write", instruction: "Write replacement contents.", requirementIds: ["artifact"] }] });
    expect(signal.aborted).toBe(true);
    finish(result("old-late-finish")); await running;
    const current = store.getTask(task.id);
    expect(current).toMatchObject({ revision: 2, generation: 2, status: "ready", turns: 1, spent: 2 });
    expect(current.stages[0]?.status).toBe("pending");
    expect(store.listDispatches(task.id)[0]?.late).toBe(true);
    expect(store.mailbox(task.id, "coordinator", true)).toHaveLength(1);
    expect(() => store.claim(task.id, "owner", 1)).toThrow("generation conflict");
  });

  test("one execution owner, global concurrency/turn/spend bounds and unknown usage remain durable", async () => {
    const { store, task, path } = fixture({ bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: 10 } });
    store.claim(task.id, "owner", 1);
    expect(() => open(path).claim(task.id, "another-owner", 1)).toThrow("owner or generation conflict");
    const runner = new AgentModeRunner(store, { async execute() { return result("usage-unavailable", "completed", null); } }, "owner");
    const row = (await runner.runNext(task.id, { reservedSpend: 10 }))!;
    expect(store.getTask(task.id)).toMatchObject({ status: "paused", reason: "usage_unknown", reserved: 10 });
    expect(() => store.worker(task.id, "second")).toThrow("concurrency bound");
    store.reconcileUsage(row.id, { id: "actual-usage", actualSpend: 2 });
    store.reconcileUsage(row.id, { id: "actual-usage", actualSpend: 2 });
    expect(store.getTask(task.id)).toMatchObject({ spent: 2, reserved: 0 });
    store.control(task.id, { action: "resume" });
    await expect(runner.runNext(task.id, { reservedSpend: 5 })).rejects.toThrow("turn/spend bound");
    expect(store.listDispatches(task.id)).toHaveLength(1);
  });

  test("manual execution and recurring Loop are explicit; repeated work pauses without empty Continue", async () => {
    const { store, task } = fixture({ mode: "manual", stages: [{ id: "one", instruction: "Check one synthetic input.", requirementIds: ["artifact"] }] }); let calls = 0;
    const runner = new AgentModeRunner(store, { async execute() { return result(`loop-${++calls}`); } }, "owner");
    await expect(runner.runNext(task.id, { reservedSpend: 10 })).rejects.toThrow("user action");
    expect(() => store.control(task.id, { action: "mode", mode: "loop" })).toThrow("recurrence authorization");
    store.control(task.id, { action: "mode", mode: "loop", recurringAuthorized: true });
    await runner.runNext(task.id, { reservedSpend: 10 });
    expect(store.getTask(task.id).status).toBe("review_required");
    const stages = [{ id: "one", instruction: "Check a newly arrived synthetic input.", requirementIds: ["artifact"] }];
    store.nextLoopCycle(task.id, { workKey: "new-input-1", stages });
    await runner.runNext(task.id, { reservedSpend: 10 });
    expect(store.nextLoopCycle(task.id, { workKey: "new-input-1", stages })).toMatchObject({ status: "paused", reason: "no_new_work" });
    expect(calls).toBe(2);
    store.control(task.id, { action: "stop" });
    expect(() => store.control(task.id, { action: "resume" })).toThrow("terminal");
  });

  test("a stopped pre-offer hook cannot launch late and unchanged completed checks survive a related correction", async () => {
    const { store, task } = fixture(); let finishHook!: () => void; let sends = 0;
    const runner = new AgentModeRunner(store, { async execute() { sends++; return result("never-send"); } }, "owner", { beforeOffer: () => new Promise(resolve => { finishHook = resolve; }) });
    const pending = runner.runNext(task.id, { reservedSpend: 10 });
    expect(store.listDispatches(task.id)[0]?.state).toBe("admitted");
    runner.beginShutdown(); finishHook();
    await expect(pending).rejects.toThrow("admission is closed");
    expect(sends).toBe(0); expect(store.listDispatches(task.id)[0]?.state).toBe("cancelled");
    expect(store.getTask(task.id).reserved).toBe(0);
    store.control(task.id, { action: "resume" });
    const next = new AgentModeRunner(store, { async execute() { return result("unchanged-check"); } }, "fresh-owner");
    await next.runNext(task.id, { reservedSpend: 10 });
    const requirements = store.getTask(task.id).requirements;
    store.control(task.id, { action: "correct", text: "Inspect the remaining report more carefully.", requirements, stages: [{ id: "write", instruction: "Create the synthetic artifact.", requirementIds: ["artifact"] }, { id: "check", instruction: "Inspect exact contents and the new requested property.", requirementIds: ["artifact"], dependsOn: ["write"] }] });
    expect(store.getTask(task.id).stages.map(row => row.status)).toEqual(["completed", "pending"]);
    expect(store.getTask(task.id).turns).toBe(1);
  });
});
