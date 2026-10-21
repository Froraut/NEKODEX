import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentModeRunner, AgentModeRuntime, AgentModeStore, createAgentModeRoutes } from "../src/agent-mode";
import type { AgentExecutionPort, AgentTask, CreateAgentTask } from "../src/agent-mode";

const stores: AgentModeStore[] = []; const directories: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) { try { store.close(); } catch {} } for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const model = "chatgpt-web/gpt-6-astra";
function input(id: string): CreateAgentTask {
  return { id, ownerMode: "agent", mode: "goal", originalRequest: "Produce a synthetic artifact; no real tools or accounts.", requirements: [{ id: "artifact", text: "Synthetic artifact has correct content." }],
    stages: [{ id: "write", instruction: "Write the synthetic artifact.", requirementIds: ["artifact"] }], bounds: { maxConcurrent: 1, maxTurns: 4, maxSpend: null }, execution: { provider: "local-responses", model } };
}
function open() {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-agent-dispatch-reconcile-")); directories.push(directory);
  const path = join(directory, "agent.sqlite"); const store = new AgentModeStore(path); stores.push(store); return { store, path };
}
/** A port whose send outcome is never known: it may ACK, then the transport is lost. */
function lostPort(options: { ack?: boolean } = {}) {
  const port = { sends: 0, async execute(_request, ack) { port.sends++; if (options.ack) ack(`accept-${port.sends}`); throw new Error("socket lost"); } } as AgentExecutionPort & { sends: number };
  return port;
}
const scopeOf = (task: AgentTask) => ({ familyId: task.familyId, generation: task.generation, revision: task.revision });
const ledger = (store: AgentModeStore, taskId: string) => ({ dispatches: store.listDispatches(taskId), workers: store.listWorkers(taskId), messages: store.listMessages(taskId),
  toolOutcomes: store.listToolOutcomes(taskId), work: store.listWork(taskId), receipts: store.listReceipts(taskId) });

describe("Unknown send reconciliation", () => {
  test("abandoning an unknown send records a separate receipt, resends nothing, keeps the ledger and lets archive proceed", async () => {
    const { store, path } = open();
    const port = lostPort(); const runner = new AgentModeRunner(store, port, "owner");
    const task = store.createTask(input("task-a"));
    await expect(runner.runNext(task.id, { reservedSpend: 0 })).rejects.toThrow("socket lost");
    const [dispatch] = store.listDispatches(task.id);
    expect(dispatch!.state).toBe("unknown");
    const record = (kind: "abandoned" | "confirmed_delivered", actionId: string, extra: { note?: string; scope?: ReturnType<typeof scopeOf> } = {}) =>
      store.recordDispatchDisposition(task.id, dispatch!.id, { kind, actionId, scope: extra.scope ?? scopeOf(store.getTask(task.id)), ...(extra.note !== undefined ? { note: extra.note } : {}) });
    // Only a stopped task: a paused task could still be resumed into an owner decision.
    expect(store.getTask(task.id).status).toBe("paused");
    expect(() => record("abandoned", "early")).toThrow("requires a stopped task");
    store.control(task.id, { action: "stop" });
    expect(() => store.archiveTask(task.id)).toThrow("settled execution");
    const stopped = store.getTask(task.id), before = ledger(store, task.id);
    expect(() => record("abandoned", "stale", { scope: { ...scopeOf(stopped), generation: stopped.generation - 1 } })).toThrow("Stale task action scope");
    expect(() => record("confirmed_delivered", "no-ack")).toThrow("acceptance receipt");
    expect(() => record("abandoned", "blank-note", { note: "  " })).toThrow("note must be");
    expect(() => record("abandoned", "long-note", { note: "x".repeat(2001) })).toThrow("note must be");
    expect(() => store.recordDispatchDisposition(task.id, "missing-dispatch", { kind: "abandoned", actionId: "missing", scope: scopeOf(stopped) })).toThrow("does not belong");
    expect(ledger(store, task.id)).toEqual(before); // Refusals write nothing.

    const fact = record("abandoned", "abandon-a", { note: "Checked the provider; nothing to adopt." });
    expect(fact).toMatchObject({ dispatchId: dispatch!.id, kind: "abandoned", note: "Checked the provider; nothing to adopt.", resent: false, scope: scopeOf(stopped), dispatchGeneration: dispatch!.generation });
    expect(fact.acceptanceReceipt).toBeUndefined();
    const after = ledger(store, task.id);
    // The dispatch stays unknown; worker, mail, outcomes and every earlier receipt are unchanged.
    expect({ ...after, receipts: after.receipts.slice(0, before.receipts.length) }).toEqual(before);
    expect(after.receipts.slice(before.receipts.length)).toEqual([{ id: `dispatch-disposition:${dispatch!.id}`, kind: "dispatch_disposition", body: fact }]);
    expect(store.getTask(task.id)).toEqual(stopped); // No refund, no stage advance.
    expect(() => record("abandoned", "again")).toThrow("already recorded");
    // Replay stays forbidden; the send is still unknown.
    expect(() => runner.prepareNext(task.id, { reservedSpend: 0, explicitUserAction: true })).toThrow("replay forbidden");
    expect(port.sends).toBe(1);

    const archived = store.archiveTask(task.id);
    expect(archived.archivedAt).toBeNumber();
    expect(store.getDispatch(dispatch!.id)).toEqual(before.dispatches[0]!);
    expect(() => record("abandoned", "after-archive")).toThrow("archived");
    const reopened = new AgentModeStore(path); stores.push(reopened);
    expect(reopened.listDispatchDispositions(task.id)).toEqual([fact]);
    expect(reopened.getDispatch(dispatch!.id).state).toBe("unknown");
  });

  test("confirmed delivery needs and names the dispatch's own acceptance receipt", async () => {
    const { store } = open();
    const task = store.createTask(input("task-ack"));
    await expect(new AgentModeRunner(store, lostPort({ ack: true }), "owner").runNext(task.id, { reservedSpend: 0 })).rejects.toThrow("socket lost");
    const [dispatch] = store.listDispatches(task.id);
    expect(dispatch).toMatchObject({ state: "unknown", acceptanceReceipt: "accept-1" });
    const stopped = store.control(task.id, { action: "stop" });
    const fact = store.recordDispatchDisposition(task.id, dispatch!.id, { kind: "confirmed_delivered", actionId: "deliver", scope: scopeOf(stopped) });
    expect(fact).toMatchObject({ kind: "confirmed_delivered", acceptanceReceipt: "accept-1", resent: false });
    expect(store.getDispatch(dispatch!.id)).toEqual(dispatch!);
    expect(store.archiveTask(task.id).archivedAt).toBeNumber();
  });

  test("HTTP reconcile-dispatch is scoped, command-receipted and idempotent; get lists the record; archive then proceeds", async () => {
    const { store } = open();
    const models = () => [{ id: model }];
    const port = lostPort();
    const runtime = new AgentModeRuntime({ store, ownerId: "synthetic-owner", models, executionPort: port });
    const handler = createAgentModeRoutes({ runtime, authorize: () => true });
    const call = async (body: unknown) => (await handler(new Request("http://127.0.0.1:17841/admin/agent-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })))!;
    const json = async (body: unknown) => (await (await call(body)).json()) as any;
    expect((await call({ action: "create", actionId: "create-a", input: input("task-a") })).status).toBe(201);
    expect((await call({ action: "step", taskId: "task-a", actionId: "step-a", explicitUserAction: true })).status).toBe(202);
    for (let attempt = 0; attempt < 100 && store.listDispatches("task-a")[0]?.state !== "unknown"; attempt++) await Bun.sleep(5);
    const dispatchId = store.listDispatches("task-a")[0]!.id;
    expect(store.getDispatch(dispatchId).state).toBe("unknown");
    const scope = () => scopeOf(store.getTask("task-a"));
    const request = (actionId: string, extra: Record<string, unknown> = {}) => ({ action: "reconcile-dispatch", taskId: "task-a", actionId, scope: scope(), dispatchId, disposition: { kind: "abandoned", note: "  Outcome unknown, not resent.  " }, ...extra });
    const early = await call(request("early"));
    expect(early.status).toBe(409); expect(((await early.json()) as any).message).toContain("requires a stopped task");
    expect((await call({ action: "control", taskId: "task-a", actionId: "stop-a", control: { action: "stop" } })).status).toBe(200);
    expect((await call({ ...request("no-scope"), scope: undefined })).status).toBe(400);
    expect((await call(request("bad-kind", { disposition: { kind: "settled" } }))).status).toBe(400);
    expect((await call(request("receipt-smuggle", { disposition: { kind: "abandoned", receiptId: "forged" } }))).status).toBe(400);
    const stale = await call(request("stale", { scope: { ...scope(), generation: 1 } }));
    expect(stale.status).toBe(409); expect(((await stale.json()) as any).message).toBe("Stale task action scope");

    const first = (await json(request("reconcile-a"))).value;
    expect(first.disposition).toMatchObject({ dispatchId, kind: "abandoned", note: "Outcome unknown, not resent.", actionId: "reconcile-a", resent: false });
    expect((await json(request("reconcile-a"))).value).toEqual(first); // Same action ID returns the stored command receipt.
    const changed = await call(request("reconcile-a", { disposition: { kind: "abandoned" } }));
    expect(changed.status).toBe(409); expect(((await changed.json()) as any).message).toBe("Action identity conflict");
    const again = await call(request("reconcile-b"));
    expect(again.status).toBe(409); expect(((await again.json()) as any).message).toContain("already recorded");

    const detail = (await json({ action: "get", taskId: "task-a" })).value;
    expect(detail.dispatchDispositions).toEqual([first.disposition]);
    expect(detail.coverage.dispatchDispositions).toEqual({ total: 1, truncated: false });
    expect(detail.dispatches[0].state).toBe("unknown");
    expect(detail.receipts.filter((row: any) => ["reconcile_dispatch", "dispatch_disposition"].includes(row.kind)).map((row: any) => row.kind)).toEqual(["dispatch_disposition", "reconcile_dispatch"]);
    const archived = await json({ action: "archive", taskId: "task-a", actionId: "archive-a", scope: scope() });
    expect(archived.value.task.archivedAt).toBeNumber();
    expect(port.sends).toBe(1);
  });
});
