import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentModeRunner, AgentModeRuntime, AgentModeStore, createAgentModeRoutes, createLocalResponsesExecutionPort } from "../src/agent-mode";
import type { AgentExecutionPort, AgentTask, CreateAgentTask, OutcomeReview } from "../src/agent-mode";

const stores: AgentModeStore[] = []; const directories: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) { try { store.close(); } catch {} } for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const model = "chatgpt-web/gpt-6-astra";
function input(id: string): CreateAgentTask {
  return { id, ownerMode: "agent", mode: "goal", originalRequest: "Produce a synthetic artifact; no real tools or accounts.", requirements: [{ id: "artifact", text: "Synthetic artifact has correct content." }],
    stages: [{ id: "write", instruction: "Write the synthetic artifact.", requirementIds: ["artifact"] }], bounds: { maxConcurrent: 1, maxTurns: 4, maxSpend: null }, execution: { provider: "local-responses", model } };
}
function open() {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-agent-archive-")); directories.push(directory);
  const path = join(directory, "agent.sqlite"); const store = new AgentModeStore(path); stores.push(store); return { store, path };
}
function review(task: AgentTask, evidenceIds: string[]): OutcomeReview {
  return { id: `review-${task.evidenceRevision}`, generation: task.generation, taskRevision: task.revision, evidenceRevision: task.evidenceRevision, findings: [], recommendation: "Synthetic review.", coverage: [{ requirementId: "artifact", evidenceIds }], completeInput: true };
}
const ledger = (store: AgentModeStore, taskId: string) => ({ dispatches: store.listDispatches(taskId), receipts: store.listReceipts(taskId), workers: store.listWorkers(taskId),
  messages: store.listMessages(taskId), toolOutcomes: store.listToolOutcomes(taskId), work: store.listWork(taskId) });

describe("Agent task archive", () => {
  test("only a settled stopped or verified task is archived; its ledger and evidence stay and it becomes read-only", async () => {
    const { store, path } = open();
    const live = store.createTask(input("live-task"));
    expect(() => store.archiveTask(live.id)).toThrow("stopped or verified complete");
    store.control(live.id, { action: "stop" });
    const before = ledger(store, live.id);
    const archived = store.archiveTask(live.id);
    expect(archived.archivedAt).toBeNumber(); expect(archived.status).toBe("stopped");
    expect(store.archiveTask(live.id)).toEqual(archived); // Idempotent.
    expect(ledger(store, live.id)).toEqual(before);
    expect(() => store.control(live.id, { action: "stop" })).toThrow("archived");
    const reopened = new AgentModeStore(path); stores.push(reopened); expect(reopened.getTask(live.id).archivedAt).toBe(archived.archivedAt);

    const verified = store.createTask(input("verified-task"));
    let sends = 0;
    const port: AgentExecutionPort = { async execute(_request, ack) { sends++; ack(`accept-${sends}`); return { receiptId: `finish-${sends}`, outcome: "completed", summary: "Synthetic port completed.", actualSpend: 1 }; } };
    await new AgentModeRunner(store, port, "owner").runNext(verified.id, { reservedSpend: 1 });
    let current = store.recordEvidence(verified.id, { id: "fact", taskRevision: 1, requirementId: "artifact", sourceEventId: "synthetic-event", subject: "synthetic-artifact", subjectRevision: "sha256:fixture", property: "exact contents", outcome: "passed", observer: "synthetic-fixture-observer" });
    store.recordReview(verified.id, review(current, ["fact"]));
    current = store.verifyComplete(verified.id, "review-1");
    expect(current.status).toBe("verified_complete");
    const evidenceBefore = ledger(store, verified.id);
    const done = store.archiveTask(verified.id);
    expect(done.evidence).toEqual(current.evidence); expect(done.review).toEqual(current.review);
    expect(ledger(store, verified.id)).toEqual(evidenceBefore);
    // An archived verified task cannot be reopened, corrected or re-reviewed.
    expect(() => store.control(verified.id, { action: "resume" })).toThrow("archived");
    expect(() => store.recordEvidence(verified.id, { id: "late", taskRevision: 1, requirementId: "artifact", sourceEventId: "late-event", subject: "synthetic-artifact", subjectRevision: "sha256:late", property: "exact contents", outcome: "failed", observer: "synthetic-fixture-observer" })).toThrow("archived");
  });

  test("late usage accounting still lands on an archived stopped task; nothing else does", async () => {
    const { store } = open();
    const task = store.createTask(input("unpriced-task"));
    const port: AgentExecutionPort = { async execute(_request, ack) { ack("accept-unpriced"); return { receiptId: "finish-unpriced", outcome: "completed", summary: "Synthetic port completed.", actualSpend: null }; } };
    const dispatch = (await new AgentModeRunner(store, port, "owner").runNext(task.id, { reservedSpend: 3 }))!;
    store.control(task.id, { action: "stop" });
    const archived = store.archiveTask(task.id);
    expect(archived).toMatchObject({ reserved: 3, unpricedTurns: 1 });
    store.reconcileUsage(dispatch.id, { id: "usage-receipt", actualSpend: 2 });
    expect(store.getTask(task.id)).toMatchObject({ archivedAt: archived.archivedAt, reserved: 0, spent: 2, unpricedTurns: 0, status: "stopped" });
    expect(store.listReceipts(task.id).some(row => row.kind === "usage")).toBe(true);
    expect(() => store.control(task.id, { action: "stop" })).toThrow("archived");
  });

  test("HTTP archive is scoped and idempotent, hides the task from listings and counts it", async () => {
    const { store } = open();
    const models = () => [{ id: model }];
    const runtime = new AgentModeRuntime({ store, ownerId: "synthetic-owner", models, executionPort: createLocalResponsesExecutionPort({ models, endpoint: () => "http://127.0.0.1:17841/v1/responses", fetch: (async () => { throw new Error("no send expected"); }) as unknown as typeof fetch }) });
    const handler = createAgentModeRoutes({ runtime, authorize: () => true });
    const call = async (body: unknown) => (await handler(new Request("http://127.0.0.1:17841/admin/agent-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    expect((await call({ action: "create", actionId: "create-a", input: input("task-a") })).status).toBe(201);
    expect((await call({ action: "create", actionId: "create-b", input: input("task-b") })).status).toBe(201);
    const scope = (id: string) => { const task = store.getTask(id); return { familyId: task.familyId, generation: task.generation, revision: task.revision }; };
    const refused = await call({ action: "archive", taskId: "task-a", actionId: "archive-early", scope: scope("task-a") });
    expect(refused.status).toBe(409); expect(((await refused.json()) as any).message).toContain("stopped or verified complete");
    await call({ action: "control", taskId: "task-a", actionId: "stop-a", control: { action: "stop" } });
    expect((await call({ action: "archive", taskId: "task-a", actionId: "archive-stale", scope: { ...scope("task-a"), generation: 1 } })).status).toBe(409);
    expect((await call({ action: "archive", taskId: "task-a", actionId: "archive-a" })).status).toBe(400);
    const archive = { action: "archive", taskId: "task-a", actionId: "archive-a", scope: scope("task-a") };
    const first = (await (await call(archive)).json() as any).value.task;
    expect(first.archivedAt).toBeNumber();
    expect((await (await call(archive)).json() as any).value.task).toEqual(first);
    const list = (await (await call({ action: "list" })).json() as any).value;
    expect(list.tasks.map((task: AgentTask) => task.id)).toEqual(["task-b"]); expect(list.archived).toBe(1);
    const detail = (await (await call({ action: "get", taskId: "task-a" })).json() as any).value;
    expect(detail.task.archivedAt).toBe(first.archivedAt);
    expect(detail.receipts.some((row: any) => row.kind === "archive")).toBe(true);
  });
});
