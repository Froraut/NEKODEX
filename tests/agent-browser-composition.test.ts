import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentModeRuntime, AgentModeStore, createLocalResponsesExecutionPort } from "../src/agent-mode";
import { createAgentToolsComposition, type AgentToolsComposition } from "../src/agent-tools/composition";
import { createAgentBrowserToolsProvider } from "../src/browser-companion/agent-tools";
import { companionChromiumMissing, startBrowserCompanionExtensionFixture } from "./fixtures/browser-companion-extension";
import type { BrowserObservation } from "../src/browser-companion/protocol";

/** The single connected browser/model fixture for this batch. No account or ChatGPT sender. */
test.skipIf(Boolean(companionChromiumMissing))("approved Agent browser calls use actual MV3 input and canonical continuation, then recover a terminal receipt without replay", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-agent-browser-owner-")));
  const store = new AgentModeStore(join(home, "agent.sqlite"));
  let fixture: Awaited<ReturnType<typeof startBrowserCompanionExtensionFixture>> | undefined;
  let tools: AgentToolsComposition | undefined; let runtime: AgentModeRuntime | undefined;
  try {
    fixture = await startBrowserCompanionExtensionFixture();
    expect(fixture.extensionEnabled).toBe(true); expect(fixture.ungrantedReadRefused).toBe(true);
    await fixture.page.evaluate(() => { document.documentElement.dataset.fixtureClicks = "0"; document.querySelector("button")!.addEventListener("click", () => { document.documentElement.dataset.fixtureClicks = String(Number(document.documentElement.dataset.fixtureClicks) + 1); }); });
    const isActive = (scope: { taskId: string; generation: number }) => { try { const task = store.getTask(scope.taskId); return task.generation === scope.generation && !["stopped", "verified_complete"].includes(task.status); } catch { return false; } };
    const makeTools = () => createAgentToolsComposition({ home, authorize: request => request.headers.get("authorization") === "fixture-control", isScopeActive: isActive,
      browserTools: createAgentBrowserToolsProvider({ provider: () => fixture!.runtime.browserProvider(), isScopeActive: isActive }),
      resolveToolCall: scope => runtime?.resolveToolCall(scope), onOutcome: outcome => { if (outcome.tool !== "browser/click") runtime!.recordToolOutcome(outcome); } });
    tools = makeTools(); let modelCalls = 0; let turnId: string | undefined; let firstObservation: BrowserObservation | undefined; let secondObservation: BrowserObservation | undefined;
    const model = "fixture-local-responses";
    const executionPort = createLocalResponsesExecutionPort({ models: () => [{ id: model }], endpoint: () => "http://127.0.0.1:17841/v1/responses", tools: { discover: (scope, options) => tools!.toolsPort.discover(scope, options) },
      fetch: (async (_url, options) => {
        modelCalls++; const wire = JSON.parse(String(options?.body));
        const outputs = wire.input.filter((item: any) => item.type === "function_call_output"); expect(outputs).toHaveLength(modelCalls - 1);
        const rootTurn = wire.input[0].internal_chat_message_metadata_passthrough.turn_id;
        if (!turnId) turnId = rootTurn; else expect(rootTurn).toBe(turnId);
        expect(wire.tools).toHaveLength(3);
        let call: { type: string; call_id: string; name: string; arguments: string } | undefined;
        if (modelCalls === 1) {
          const binding = fixture!.provider.selected()!;
          expect(wire.tools[0].description).toContain(binding.documentId); expect(wire.tools[0].description).not.toContain(fixture!.page.url());
          call = { type: "function_call", call_id: "browser-observe-1", name: "agent_tool_0", arguments: JSON.stringify({ binding }) };
        } else if (modelCalls === 2) {
          const result = JSON.parse(outputs.at(-1).output); firstObservation = result.result.structuredContent.observation;
          expect(result.state).toBe("completed"); const ref = firstObservation!.refs.find(row => row.role === "textbox")!.ref;
          call = { type: "function_call", call_id: "browser-type", name: "agent_tool_2", arguments: JSON.stringify({ binding: result.result.structuredContent.binding, ref, text: "Approved synthetic Agent input" }) };
        } else if (modelCalls === 3) {
          const prior = JSON.parse(outputs[0].output);
          call = { type: "function_call", call_id: "browser-observe-2", name: "agent_tool_0", arguments: JSON.stringify({ binding: prior.result.structuredContent.binding }) };
        } else if (modelCalls === 4) {
          const result = JSON.parse(outputs.at(-1).output); secondObservation = result.result.structuredContent.observation;
          expect(secondObservation!.observationId).not.toBe(firstObservation!.observationId);
          const ref = secondObservation!.refs.find(row => row.role === "button" && row.label === "Save")!.ref;
          call = { type: "function_call", call_id: "browser-click", name: "agent_tool_1", arguments: JSON.stringify({ binding: result.result.structuredContent.binding, ref }) };
        } else {
          expect(modelCalls).toBe(5); expect(JSON.parse(outputs.at(-1).output).result.structuredContent.execution.executed).toBe(true);
        }
        return Response.json({ id: `fixture-browser-response-${modelCalls}`, status: "completed", output: call ? [call] : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The selected fixture received approved input. Website/business acceptance remains a separate observed requirement." }] }], usage: { input_tokens: 5, output_tokens: 5 } });
      }) as typeof fetch });
    runtime = new AgentModeRuntime({ store, ownerId: "fixture-agent-owner", models: () => [{ id: model }], executionPort, lookupToolOutcome: key => tools!.receipt(key) });
    const task = runtime.create("create-browser-task", { id: "fixture-browser-task", ownerMode: "agent", mode: "manual", originalRequest: "Use only the explicitly attached inert local browser fixture to enter text, then request Save and report execution receipts.", requirements: [{ id: "browser", text: "Report exact selected-browser input receipts; do not claim external business acceptance." }], stages: [{ id: "browser-flow", instruction: "Observe, request approved input, observe again before Save, and report the returned receipts.", requirementIds: ["browser"] }], bounds: { maxConcurrent: 1, maxTurns: 6, maxSpend: null }, execution: { provider: "local-responses", model } });
    const post = async (body: unknown) => {
      const response = (await tools!.handle(new Request("http://127.0.0.1/admin/agent-tools", { method: "POST", headers: { authorization: "fixture-control", "content-type": "application/json" }, body: JSON.stringify(body) })))!;
      const packet = await response.json() as any; if (!response.ok || !packet.ok) throw new Error(packet.message ?? "Browser fixture admin action failed"); return packet.value;
    };
    const scope = { taskId: task.id, generation: task.generation, toolCallId: "browser-selection" };
    const ready = async () => { const until = Date.now() + 3000; while (!fixture!.provider.capabilities().available) { if (Date.now() > until) throw new Error("The owned popup did not resume its active poll"); await Bun.sleep(10); } };
    await ready(); expect(tools.status().config.enabled).toBe(false);
    expect((await tools.toolsPort.discover(scope)).filter(row => row.supported)).toHaveLength(0);
    await post({ action: "bindBrowserTools", scope, expectedBinding: fixture.provider.selected(), explicitUserAction: true });
    expect((await tools.toolsPort.discover(scope)).filter(row => row.supported).map(row => row.id)).toEqual(["browser/observe", "browser/click", "browser/type"]);
    for (let index = 0; index < 4; index++) {
      await ready(); runtime.step(task.id, `run-browser-${index}`, { explicitUserAction: true }); await runtime.waitForIdle();
      expect(store.getTask(task.id).status).toBe("awaiting_input");
      const dispatch = store.listDispatches(task.id).at(-1)!; const pending = dispatch.result!.continuation!.pending[0]!;
      if (index === 0) expect(await fixture.page.getByRole("textbox").inputValue()).toBe("");
      await ready(); const approve = { action: "approveInvoke", scope: { ...scope, toolCallId: pending.toolCallId }, explicitUserAction: true };
      expect((await post(approve)).state).toBe("completed");
      if (index === 0) { expect((await post(approve)).state).toBe("completed"); expect(modelCalls).toBe(1); }
      if (index === 1) expect(await fixture.page.getByRole("textbox").inputValue()).toBe("Approved synthetic Agent input");
      if (index === 3) {
        expect(await fixture.page.locator("output").textContent()).toBe("Saved"); expect(await fixture.page.locator("html").getAttribute("data-fixture-clicks")).toBe("1");
        expect(store.listToolOutcomes(task.id)).toHaveLength(3); // Simulated lost core callback; the tool journal retained it.
        await tools.close(); tools = makeTools(); expect(tools.status().browserTools?.bindings).toHaveLength(0);
        const current = store.getTask(task.id);
        runtime.resumeContinuation(task.id, "adopt-known-browser-receipt", { familyId: current.familyId, generation: current.generation, revision: current.revision }, dispatch.id);
        expect(store.listToolOutcomes(task.id)).toHaveLength(4); expect(await fixture.page.locator("html").getAttribute("data-fixture-clicks")).toBe("1");
        const db = new Database(join(home, "agent-tool-calls.sqlite"));
        expect((db.query("SELECT event_id FROM tool_calls WHERE id=?").get(store.toolCallReceiptKey(dispatch.id, pending.toolCallId)) as { event_id: string }).event_id.startsWith("browser:")).toBe(true); db.close();
      }
    }
    runtime.step(task.id, "run-final-report", { explicitUserAction: true }); await runtime.waitForIdle();
    expect(modelCalls).toBe(5); expect(store.getTask(task.id)).toMatchObject({ status: "review_required", turns: 5, unpricedTurns: 5 }); expect(store.getTask(task.id).evidence).toHaveLength(0);
    expect(tools.status().runtime.servers).toHaveLength(0); expect(await fixture.page.locator("html").getAttribute("data-fixture-clicks")).toBe("1");
  } finally {
    runtime?.beginShutdown(); await runtime?.waitForIdle(); runtime?.finishShutdown(); await tools?.close(); await fixture?.close(); store.close(); rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
