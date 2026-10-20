import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentModeRuntime, AgentModeStore, createAgentModeRoutes, createLocalResponsesExecutionPort } from "../src/agent-mode";
import type { CreateAgentTask } from "../src/agent-mode";

const stores: AgentModeStore[] = []; const directories: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const model = "chatgpt-web/gpt-6-astra";
function input(id = "synthetic-agent-task"): CreateAgentTask {
  return { id, ownerMode: "agent", mode: "goal", originalRequest: "Produce and inspect a synthetic report; no real tools or accounts.", requirements: [{ id: "report", text: "Synthetic report has correct content." }],
    stages: [{ id: "draft", instruction: "Draft the synthetic report.", requirementIds: ["report"] }, { id: "inspect", instruction: "Inspect the synthetic report contents.", requirementIds: ["report"], dependsOn: ["draft"] }], bounds: { maxConcurrent: 2, maxTurns: 4, maxSpend: null }, execution: { provider: "local-responses", model } };
}
function fixture(fetcher?: typeof fetch, providerEndpoint = "http://127.0.0.1:17841/v1/responses") {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-agent-http-")); directories.push(directory);
  const path = join(directory, "agent.sqlite"); const store = new AgentModeStore(path); stores.push(store);
  const models = () => [{ id: model }];
  const runtime = new AgentModeRuntime({ store, ownerId: "synthetic-service-owner", models, executionPort: createLocalResponsesExecutionPort({ models, endpoint: () => providerEndpoint, fetch: fetcher }) });
  const handler = createAgentModeRoutes({ runtime, authorize: request => request.headers.get("authorization") === "Bearer synthetic-control-token" });
  const call = async (body: unknown, authenticated = true) => (await handler(new Request("http://127.0.0.1:17841/admin/agent-mode", { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer synthetic-control-token" } : {}) }, body: JSON.stringify(body) })))!;
  return { store, runtime, handler, call, path };
}
function completed(id: string, output: unknown[] = [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Synthetic draft/inspection report. This text is not observed outcome proof." }] }]): Response {
  return Response.json({ id, status: "completed", output, usage: { input_tokens: 12, output_tokens: 8 } });
}

describe("Agent-mode local service integration", () => {
  test("authenticated bounded actions create and execute finite stages through actual Responses request shape without inventing money", async () => {
    let calls = 0;
    const { runtime, call, store } = fixture((async (url, options) => {
      calls++; expect(String(url)).toBe("http://127.0.0.1:17841/v1/responses");
      expect(options?.redirect).toBe("error"); const body = JSON.parse(String(options?.body));
      expect(body).toMatchObject({ model, stream: false, store: false, tools: [], tool_choice: "none" });
      expect(JSON.stringify(body.input)).toContain("Produce and inspect a synthetic report");
      expect(body).not.toHaveProperty("cwd"); expect(body).not.toHaveProperty("workspaceRoots");
      return completed(`synthetic-response-${calls}`);
    }) as typeof fetch);
    expect((await call({ action: "status" }, false)).status).toBe(401);
    expect((await call({ action: "create", actionId: "create-action", input: { ...input(), workspace: "/unauthorized" } })).status).toBe(400);
    expect((await call({ action: "create", actionId: "create-action", input: input() })).status).toBe(201);
    expect(calls).toBe(0); // Create/status do not execute.
    const run = { action: "run", taskId: "synthetic-agent-task", actionId: "run-action", explicitUserAction: true };
    expect((await call(run)).status).toBe(202); await runtime.waitForIdle();
    expect(store.getTask("synthetic-agent-task")).toMatchObject({ status: "review_required", turns: 2, spent: 0, reserved: 0, unpricedTurns: 2 });
    expect(calls).toBe(2);
    expect((await call(run)).status).toBe(202); await runtime.waitForIdle(); expect(calls).toBe(2);
    const detail = (await (await call({ action: "get", taskId: "synthetic-agent-task" })).json() as any).value;
    expect(detail.dispatches).toHaveLength(2); expect(detail.workers).toHaveLength(1);
    expect(detail.dispatches.every((row: any) => row.state === "settled")).toBe(true);
    await call({ action: "review", taskId: "synthetic-agent-task", actionId: "review-action" });
    const task = store.getTask("synthetic-agent-task");
    expect(task.review?.findings.length).toBeGreaterThan(0);
    expect((await call({ action: "verify", taskId: task.id, actionId: "verify-action", reviewId: task.review?.id })).status).toBe(409);
    expect((await call({ action: "evidence", taskId: task.id, actionId: "forged-proof", evidence: { outcome: "passed", observer: "model" } })).status).toBe(503);
  });

  test("lost terminal HTTP outcome persists unknown and a duplicate or new action never silently resends", async () => {
    let calls = 0;
    const { runtime, call, store, path } = fixture((async () => { calls++; throw new Error("synthetic socket disconnected after possible send"); }) as typeof fetch);
    await call({ action: "create", actionId: "create", input: input() });
    const step = { action: "step", taskId: "synthetic-agent-task", actionId: "step", explicitUserAction: true };
    await call(step); await runtime.waitForIdle();
    const rows = store.listDispatches("synthetic-agent-task");
    expect(rows).toHaveLength(1); expect(rows[0]?.state).toBe("unknown");
    const reopened = new AgentModeStore(path); stores.push(reopened);
    expect(reopened.getDispatch(rows[0]!.id).state).toBe("unknown");
    await call(step); await runtime.waitForIdle(); expect(calls).toBe(1);
    await call({ action: "control", taskId: "synthetic-agent-task", actionId: "resume", control: { action: "resume" } });
    expect((await call({ ...step, actionId: "second-step" })).status).toBe(409); expect(calls).toBe(1);
  });

  test("unsupported tool requests wait for authority and invalid endpoint is proven not-sent without automatic retries", async () => {
    let calls = 0;
    const tools = fixture((async () => { calls++; return completed("tool-response", [{ type: "function_call", call_id: "tool-call", name: "shell", arguments: "{}" }]); }) as typeof fetch);
    await tools.call({ action: "create", actionId: "create", input: input() });
    await tools.call({ action: "run", actionId: "run", taskId: "synthetic-agent-task", explicitUserAction: true }); await tools.runtime.waitForIdle();
    expect(tools.store.getTask("synthetic-agent-task").status).toBe("awaiting_input"); expect(calls).toBe(1);
    const invalid = fixture((async () => { throw new Error("must not reach network"); }) as typeof fetch, "https://outside.example/v1/responses");
    await invalid.call({ action: "create", actionId: "create-invalid", input: input("invalid-endpoint-task") });
    await invalid.call({ action: "run", actionId: "run-invalid", taskId: "invalid-endpoint-task", explicitUserAction: true }); await invalid.runtime.waitForIdle();
    expect(invalid.store.getTask("invalid-endpoint-task")).toMatchObject({ status: "paused", reason: "not_sent", turns: 0 });
    expect(invalid.store.listDispatches("invalid-endpoint-task")[0]?.result?.outcome).toBe("not_sent");
  });

  test("money-bound work requires a real quote, while a finite turn bound pauses automatic progress durably", async () => {
    let calls = 0;
    const { call, runtime, store } = fixture((async () => completed(`bounded-response-${++calls}`)) as typeof fetch);
    const moneyTask = input("money-bound"); moneyTask.bounds.maxSpend = 10;
    await call({ action: "create", actionId: "money-create", input: moneyTask });
    expect((await call({ action: "run", taskId: "money-bound", actionId: "money-run", explicitUserAction: true })).status).toBe(409); expect(calls).toBe(0);
    const turnTask = input("turn-bound"); turnTask.bounds.maxTurns = 1;
    await call({ action: "create", actionId: "turn-create", input: turnTask });
    await call({ action: "run", taskId: "turn-bound", actionId: "turn-run", explicitUserAction: true }); await runtime.waitForIdle();
    expect(store.getTask("turn-bound")).toMatchObject({ status: "paused", reason: "turn_bound", turns: 1, unpricedTurns: 1 });
    expect(calls).toBe(1);
  });

  test("scoped external actions deduplicate before the generation check and stale actions never affect a correction", () => {
    const { runtime, store } = fixture(); const task = runtime.create("create", input());
    const scope = { taskId: task.id, familyId: task.familyId, generation: task.generation, revision: task.revision };
    const pause = { ...scope, actionId: "scoped-pause", operation: "pause" as const };
    expect(runtime.executeScopedAction(pause).duplicate).toBe(false);
    expect(store.getTask(task.id).generation).toBe(2);
    expect(runtime.executeScopedAction(pause).duplicate).toBe(true);
    expect(store.getTask(task.id).generation).toBe(2);
    expect(() => runtime.executeScopedAction({ ...scope, actionId: "stale-resume", operation: "resume" })).toThrow("Stale task action scope");
    expect(store.getTask(task.id).status).toBe("paused");
    const current = store.getTask(task.id);
    runtime.executeScopedAction({ ...scope, actionId: "current-resume", generation: current.generation, operation: "resume" });
    expect(store.getTask(task.id).status).toBe("ready");
  });

  test("Loop mailbox runs a real second model cycle only for substantive new work and preserves queued work after pause", async () => {
    let calls = 0; let releaseFirst!: () => void; let firstRequested!: () => void;
    const requested = new Promise<void>(resolve => { firstRequested = resolve; });
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    const { runtime, call, store } = fixture((async (_url, options) => {
      calls++;
      if (calls === 1) { firstRequested(); await first; }
      else expect(String(options?.body)).toContain("Process the newly arrived synthetic mailbox item");
      return completed(`mailbox-response-${calls}`);
    }) as typeof fetch);
    const definition = input("mailbox-loop"); definition.mode = "loop"; definition.recurringAuthorized = true; definition.stages = [definition.stages[0]!];
    await call({ action: "create", actionId: "create-loop", input: definition });
    await call({ action: "run", actionId: "run-loop", taskId: definition.id, explicitUserAction: true }); await requested;
    const scope = () => { const task = store.getTask(definition.id!); return { familyId: task.familyId, generation: task.generation, revision: task.revision }; };
    const work = { workId: "new-work", workKey: "source-item-revision-2", text: "Process the newly arrived synthetic mailbox item and report its contents." };
    expect((await call({ action: "enqueue-work", actionId: "enqueue-1", taskId: definition.id, scope: scope(), work })).status).toBe(200);
    expect((await call({ action: "enqueue-work", actionId: "enqueue-duplicate", taskId: definition.id, scope: scope(), work })).status).toBe(200);
    expect(calls).toBe(1); expect(store.listWork(definition.id!)).toHaveLength(1);
    releaseFirst(); await runtime.waitForIdle();
    expect(calls).toBe(2); expect(store.getTask(definition.id!)).toMatchObject({ cycle: 2, generation: 2, turns: 2, status: "review_required", reason: "waiting_for_mailbox_work" });
    expect(store.listWork(definition.id!)[0]?.state).toBe("claimed");
    await call({ action: "enqueue-work", actionId: "same-source-after-cycle", taskId: definition.id, scope: scope(), work }); await runtime.waitForIdle(); expect(calls).toBe(2);
    expect((await call({ action: "enqueue-work", actionId: "empty-continue", taskId: definition.id, scope: scope(), work: { workId: "empty", workKey: "random-new-key", text: "Continue" } })).status).toBe(409);
    await call({ action: "control", actionId: "pause-loop", taskId: definition.id, scope: scope(), control: { action: "pause" } });
    await call({ action: "enqueue-work", actionId: "enqueue-while-paused", taskId: definition.id, scope: scope(), work: { ...work, workId: "pending-after-pause", workKey: "source-item-revision-3" } });
    await runtime.waitForIdle(); expect(calls).toBe(2); expect(store.listWork(definition.id!)[1]?.state).toBe("pending");
    expect(store.getTask(definition.id!).loopRun).toBeUndefined();
  });
});
