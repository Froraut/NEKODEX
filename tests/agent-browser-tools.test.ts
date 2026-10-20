import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createBrowserCompanionHost } from "../src/browser-companion/host";
import { createCompanionBrowserProvider } from "../src/browser-companion/providers";
import { browserBindingOf, COMPANION_ORIGIN, type BrowserObservation } from "../src/browser-companion/protocol";
import { createAgentBrowserToolsProvider, type AgentBrowserToolRequest } from "../src/browser-companion/agent-tools";
import type { ToolScope } from "../src/agent-tools/types";

const scope = { taskId: "task-1", generation: 1, toolCallId: "call-1" };
async function fixture() {
  const extensionId = "g".repeat(32);
  const host = createBrowserCompanionHost({ extensionId });
  const offer = host.createPairing(); let token: string | undefined, sessionId: string | undefined;
  async function post(route: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) {
    const response = await host.fetch(new Request(`${COMPANION_ORIGIN}/v1/companion/${route}`, { method: "POST", signal,
      headers: { "content-type": "application/json", origin: `chrome-extension://${extensionId}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ version: 1, hostId: offer.hostId, sessionId, ...payload }) }));
    if (!response.ok) throw new Error(`Fixture companion rejected ${route}`);
    return await response.json() as any;
  }
  ({ token, sessionId } = await post("pair", { pairingCode: offer.pairingCode }));
  let observed: BrowserObservation = { kind: "browser", sessionId: sessionId!, scopeId: "user-selected-scope", tabId: 12, windowId: 4, frameId: 0,
    documentId: "document", documentEpoch: "epoch", observationId: "initial", url: "https://example.com/private-fixture", title: "Private fixture title", text: "Selected private fixture text",
    refs: [{ ref: "name", role: "textbox", label: "Name" }, { ref: "save", role: "button", label: "Save" }] };
  await post("select", { observation: observed });
  let activeGeneration = 1;
  const provider = createCompanionBrowserProvider(host);
  const adapter = createAgentBrowserToolsProvider({ provider: () => provider, isScopeActive: current => current.generation === activeGeneration });
  async function ready() {
    const abort = new AbortController(); const polling = post("poll", {}, abort.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    return { polling, async close() { abort.abort(); await polling; } };
  }
  let call = 0;
  const request = (tool: string, args: Record<string, unknown>, current: ToolScope = scope): AgentBrowserToolRequest => ({ scope: current, tool: `browser/${tool}`, arguments: args, idempotencyKey: `owned-call-${++call}` });
  async function execute(tool: "observe" | "click" | "type", args: Record<string, unknown>) {
    const listening = await ready(); const invocation = request(tool, args);
    const executing = adapter.execute(invocation, { signal: AbortSignal.timeout(1000) });
    const command = (await listening.polling).commands[0];
    expect(command.operationId).toBe(`agent_browser:${createHash("sha256").update(invocation.idempotencyKey).digest("hex")}`);
    if (tool === "observe") {
      observed = { ...observed, observationId: `fresh-${call}` };
      await post("result", { result: { operationId: command.operationId, outcome: "completed", executed: false, observation: observed } });
    } else await post("result", { result: { operationId: command.operationId, outcome: "completed", executed: true } });
    return { outcome: await executing, invocation, command };
  }
  return { host, provider, adapter, post, ready, request, execute, binding: () => host.status().selected!, setGeneration: (generation: number) => { activeGeneration = generation; } };
}

test("Agent browser attachment defaults off; approved reads own refs only for the exact task generation", async () => {
  const f = await fixture();
  try {
    expect((await f.adapter.discover(scope)).every(tool => !tool.supported)).toBe(true);
    expect(f.adapter.status(scope).bound).toBe(false);
    f.adapter.bind(scope, f.binding());
    const listening = await f.ready();
    const descriptors = await f.adapter.discover(scope);
    expect(descriptors.map(tool => tool.id)).toEqual(["browser/observe", "browser/click", "browser/type"]);
    expect(descriptors.every(tool => tool.supported)).toBe(true);
    expect(JSON.stringify(descriptors)).not.toContain("private-fixture");
    expect(JSON.stringify(descriptors)).not.toContain("Selected private fixture text");
    const unseen = await f.adapter.execute(f.request("click", { binding: f.binding(), ref: "save" }));
    expect(unseen.state).toBe("failed"); expect(f.host.status().operation).toBeNull();
    expect((unseen.result as any).structuredContent).toMatchObject({ outcome: "not_sent", reason: "This task generation has no matching approved browser observation" });
    await listening.close();
    const read = await f.execute("observe", { binding: f.binding() });
    expect(read.outcome.state).toBe("completed");
    expect(f.adapter.status(scope).bindings[0]?.observed).toBe(true);
    const other = { taskId: "task-2", generation: 1, toolCallId: "other-call" };
    f.adapter.bind(other, f.binding());
    const available = await f.ready();
    expect((await f.adapter.execute(f.request("click", { binding: f.binding(), ref: "save" }, other))).state).toBe("failed");
    expect((await f.adapter.execute(f.request("type", { binding: f.binding(), ref: "name", text: "input", taskId: scope.taskId }))).state).toBe("failed");
    await available.close();
    const clicked = await f.execute("click", { binding: f.binding(), ref: "save" });
    expect(clicked.outcome.state).toBe("completed");
    expect((clicked.outcome.result as any).structuredContent.proof).toBe("browser-input-execution-only");
    expect(f.provider.current()).toBeUndefined();
    expect(f.adapter.status(scope).bindings[0]?.observed).toBe(false);
  } finally { f.host.close(); }
});

test("changed user-selected document and task generation cannot reuse browser attachment", async () => {
  const f = await fixture();
  try {
    f.adapter.bind(scope, f.binding());
    const prior = f.binding();
    await f.post("select", { observation: { ...f.provider.current()!, scopeId: "new-user-scope", documentId: "new-document", documentEpoch: "new-epoch", observationId: "new-selection" } });
    expect(f.adapter.status(scope).bound).toBe(false);
    const listening = await f.ready();
    expect((await f.adapter.execute(f.request("observe", { binding: prior }))).state).toBe("failed");
    expect((await f.adapter.execute(f.request("observe", { binding: f.binding() }))).state).toBe("failed");
    expect(f.host.status().operation).toBeNull(); await listening.close();
    f.setGeneration(2);
    expect((await f.adapter.discover({ ...scope, generation: 2 })).every(tool => !tool.supported)).toBe(true);
    expect(() => f.adapter.bind(scope, f.binding())).toThrow("unavailable");
  } finally { f.host.close(); }
});

test("Agent browser cancel retains unknown; reconciliation reads exact late receipt without restoring input authority", async () => {
  const f = await fixture();
  try {
    f.adapter.bind(scope, f.binding());
    await f.execute("observe", { binding: f.binding() });
    const listening = await f.ready();
    const abort = new AbortController(); const binding = f.binding();
    const request = f.request("type", { binding, ref: "name", text: "offered input" });
    const executing = f.adapter.execute(request, { signal: abort.signal });
    const command = (await listening.polling).commands[0];
    abort.abort(); expect((await executing).state).toBe("outcome_unknown");
    expect(await f.adapter.reconcile(request)).toBeUndefined();
    f.adapter.revoke(scope); expect(f.adapter.status(scope).bound).toBe(false);
    await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: true } });
    const terminal = await f.adapter.reconcile(request);
    expect(terminal?.state).toBe("completed");
    expect((terminal?.result as any).structuredContent.execution).toMatchObject({ operationId: command.operationId, cancelRequested: true, binding });
    expect(await f.adapter.reconcile({ ...request, arguments: { ...request.arguments, binding: { ...binding, sessionId: "foreign" } } })).toBeUndefined();
    expect(f.host.status().operation).toBeNull();
    expect(f.adapter.status(scope).bindings).toEqual([]);
    expect(f.provider.current()).toBeUndefined();
  } finally { f.host.close(); }
});
