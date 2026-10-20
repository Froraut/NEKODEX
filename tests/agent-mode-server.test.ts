import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentModeStore } from "../src/agent-mode";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { sha256, writeToolsConfig } from "../src/agent-tools";

test.serial("actual server control mount is private/lazy and owns Agent persistence, selected model route and shutdown", async () => {
  const home = mkdtempSync(join(tmpdir(), "nekodex-agent-server-synthetic-"));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const previousDescriptor = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  process.env.CODEX_CHATGPT_WEB_HOME = home; delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  let server: ReturnType<typeof startServer> | undefined; let reader: AgentModeStore | undefined;
  let adapterCalls = 0; let nativeCalls = 0;
  try {
    const config = { ...defaultConfig(), port: 0 };
    server = startServer(config, { fetchUpstream: async () => { nativeCalls++; throw new Error("Synthetic fixture must not contact a native account"); },
      adapterFactory: () => ({ name: "synthetic-isolated-adapter", async runTurn(parsed, incoming, emit) {
        adapterCalls++; expect(parsed.requestedModel).toStartWith("chatgpt-web/");
        expect(incoming.headers.get("authorization")).toBe(`Bearer ${config.controlToken}`);
        expect(parsed._clientContext?.producer).toBe("agent");
        expect(parsed._clientContext?.root).toBe(join(home, "agent-mode", "virtual"));
        expect(parsed.context.tools ?? []).toHaveLength(0);
        emit({ type: "text_delta", text: "Synthetic local adapter report; no real account or workspace was used." });
        emit({ type: "done" });
      } }),
    });
    const base = `http://127.0.0.1:${server.port}`;
    const call = (body: unknown, token = config.controlToken, origin?: string) => fetch(`${base}/admin/agent-mode`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
    const path = join(home, "agent-mode", "state.sqlite");
    await fetch(`${base}/healthz`); expect(existsSync(path)).toBe(false);
    expect((await call({ action: "status" }, "wrong")).status).toBe(401); expect(existsSync(path)).toBe(false);
    expect((await call({ action: "status" }, config.controlToken, "https://untrusted.example")).status).toBe(403);
    const adminRead = async (route: string, body: unknown) => {
      const response = await fetch(`${base}/admin/${route}`, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(200); return (await response.json() as any).value;
    };
    expect((await adminRead("browser-companion", { action: "status" })).enabled).toBe(false);
    expect((await adminRead("agent-tools", { action: "status" })).config.enabled).toBe(false);
    expect((await adminRead("local-control-api", { action: "status" })).status.enabled).toBe(false);
    const status = (await (await call({ action: "status" })).json() as any).value;
    expect(status.models.length).toBeGreaterThan(0); expect(status.models.every((row: any) => row.id.startsWith("chatgpt-web/"))).toBe(true);
    const model = status.models[0].id;
    const taskId = "synthetic-server-task";
    expect((await call({ action: "create", actionId: "create", input: { id: taskId, ownerMode: "agent", mode: "goal", originalRequest: "Produce a synthetic report only.", requirements: [{ id: "report", text: "Report exists." }], stages: [{ id: "report", instruction: "Write the synthetic report.", requirementIds: ["report"] }], bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "local-responses", model } } })).status).toBe(201);
    reader = new AgentModeStore(path);
    const durableTerminal = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { watcher.close(); reject(new Error("Synthetic Agent terminal receipt did not persist")); }, 2_000);
      const watcher = watch(join(home, "agent-mode"), () => {
        if (reader?.getTask(taskId).status === "review_required") { clearTimeout(timeout); watcher.close(); resolve(); }
      });
    });
    expect((await call({ action: "run", taskId, actionId: "run", explicitUserAction: true })).status).toBe(202);
    await durableTerminal;
    expect(adapterCalls).toBe(1); expect(nativeCalls).toBe(0);
    expect(reader.getTask(taskId)).toMatchObject({ status: "review_required", turns: 1, unpricedTurns: 1 });
    expect((await call({ action: "get", taskId })).status).toBe(200);
    expect((await fetch(`${base}/admin/drain`, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}` } })).status).toBe(200);
    expect((await call({ action: "step", taskId, actionId: "after-drain", explicitUserAction: true })).status).toBe(409);
    reader.close(); reader = undefined;
    await server.stop(true); server = undefined;
    reader = new AgentModeStore(path);
    expect(reader.getTask(taskId).status).toBe("review_required"); expect(reader.listDispatches(taskId)[0]?.state).toBe("settled");
  } finally {
    await server?.stop(true); reader?.close();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    if (previousDescriptor === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR; else process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = previousDescriptor;
    rmSync(home, { recursive: true, force: true });
  }
}, 5_000);

test.serial("actual local MCP approval returns its exact durable result into the same Responses turn, counting each model request", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-agent-tool-flow-")));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME; const previousDescriptor = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  process.env.CODEX_CHATGPT_WEB_HOME = home; delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  let server: ReturnType<typeof startServer> | undefined; let reader: AgentModeStore | undefined;
  const command = realpathSync(process.execPath); const script = realpathSync(join(import.meta.dir, "fixtures/agent-tools-server.ts"));
  writeToolsConfig(join(home, "agent-tools.json"), { version: 1, enabled: true, servers: [{ id: "fixture", enabled: true, transport: "stdio", source: { kind: "user-installed", label: "Isolated fixture", version: "1.0.0" }, command, commandSha256: sha256(readFileSync(command)), args: [script, join(home, "counter")], pinnedFiles: [{ path: script, sha256: sha256(readFileSync(script)) }], cwd: home, envSecretRefs: {} }] });
  let modelCalls = 0; let turnId: string | undefined;
  try {
    const config = { ...defaultConfig(), port: 0 };
    const dependencies: NonNullable<Parameters<typeof startServer>[1]> = { fetchUpstream: async () => { throw new Error("No real provider network in fixture"); }, adapterFactory: () => ({ name: "synthetic-tool-model", async runTurn(parsed, _incoming, emit) {
      modelCalls++;
      expect(parsed._clientContext?.producer).toBe("agent");
      if (modelCalls === 1) {
        turnId = parsed._clientContext?.turnId;
        expect(JSON.stringify(parsed._rawBody)).toContain("agent_tool_0");
        emit({ type: "tool_call_start", id: "synthetic-owned-call", name: "agent_tool_0" });
        emit({ type: "tool_call_delta", arguments: JSON.stringify({ text: "one isolated effect" }) });
        emit({ type: "tool_call_end" }); emit({ type: "done", endTurn: false });
      } else {
        expect(parsed._clientContext?.turnId).toBe(turnId);
        const wire = parsed._rawBody as { input: Record<string, unknown>[] };
        const outputs = wire.input.filter(item => item.type === "function_call_output");
        expect(outputs).toHaveLength(1); expect(outputs[0]?.call_id).toBe("synthetic-owned-call");
        expect(String(outputs[0]?.output)).toContain('"count":1');
        expect(wire.input.some(item => item.type === "function_call" && item.call_id === "synthetic-owned-call")).toBe(true);
        emit({ type: "text_delta", text: "Observed the isolated tool's exact terminal receipt; business outcome still needs review." }); emit({ type: "done", endTurn: true });
      }
    } }) };
    server = startServer(config, dependencies);
    let base = `http://127.0.0.1:${server.port}`;
    const post = async (route: string, body: unknown) => {
      const response = await fetch(`${base}/admin/${route}`, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as any; if (!response.ok) throw new Error(`Fixture ${route} action rejected: ${JSON.stringify(payload)}`); return payload.value;
    };
    const status = await post("agent-mode", { action: "status" }); const taskId = "isolated-tool-task";
    await post("agent-mode", { action: "create", actionId: "create", input: { id: taskId, ownerMode: "agent", mode: "goal", originalRequest: "Use only the configured isolated record fixture and report its receipt.", requirements: [{ id: "effect", text: "Report the isolated tool result." }], stages: [{ id: "effect", instruction: "Request the isolated record tool, wait for exact approval, then report the returned result.", requirementIds: ["effect"] }], bounds: { maxConcurrent: 1, maxTurns: 3, maxSpend: null }, execution: { provider: "local-responses", model: status.models[0].id } } });
    reader = new AgentModeStore(join(home, "agent-mode", "state.sqlite"));
    const waitFor = (wanted: string) => new Promise<void>((resolve, reject) => {
      if (reader!.getTask(taskId).status === wanted) return resolve();
      const timeout = setTimeout(() => { watcher.close(); reject(new Error(`Fixture did not reach ${wanted}`)); }, 3_000);
      const watcher = watch(join(home, "agent-mode"), () => { if (reader!.getTask(taskId).status === wanted) { clearTimeout(timeout); watcher.close(); resolve(); } });
    });
    let wait = waitFor("awaiting_input");
    await post("agent-mode", { action: "run", taskId, actionId: "run-initial", explicitUserAction: true }); await wait;
    expect(modelCalls).toBe(1); expect(existsSync(join(home, "counter"))).toBe(false);
    const pending = reader.listDispatches(taskId)[0]!.result!.continuation!.pending[0]!;
    expect(pending).toMatchObject({ toolCallId: "synthetic-owned-call", tool: "fixture/record", arguments: { text: "one isolated effect" } });
    const approve = { action: "approveInvoke", scope: { taskId, generation: 1, toolCallId: pending.toolCallId }, explicitUserAction: true };
    expect((await post("agent-tools", approve)).state).toBe("completed");
    expect((await post("agent-tools", approve)).state).toBe("completed");
    expect(readFileSync(join(home, "counter"), "utf8")).toBe("1");
    expect(reader.getTask(taskId).status).toBe("ready"); expect(reader.listToolOutcomes(taskId)).toHaveLength(1);
    const sourceDispatchId = reader.listDispatches(taskId)[0]!.id;
    const toolProcess = (await post("agent-tools", { action: "status" })).runtime.servers[0].pid as number;
    expect(toolProcess).toBeGreaterThan(0);
    await server.stop(true);
    expect(() => process.kill(toolProcess, 0)).toThrow();
    server = startServer(config, dependencies); base = `http://127.0.0.1:${server.port}`;
    const reopened = await post("agent-mode", { action: "get", taskId });
    expect(reopened.task.generation).toBe(2); expect(reopened.task.status).toBe("paused");
    expect(reopened.toolOutcomes).toHaveLength(1); expect(modelCalls).toBe(1);
    await post("agent-mode", { action: "resume-continuation", taskId, actionId: "adopt-durable-results", dispatchId: sourceDispatchId,
      scope: { familyId: reopened.task.familyId, generation: reopened.task.generation, revision: reopened.task.revision } });
    expect(modelCalls).toBe(1); expect(readFileSync(join(home, "counter"), "utf8")).toBe("1");
    wait = waitFor("review_required");
    await post("agent-mode", { action: "run", taskId, actionId: "run-continuation", explicitUserAction: true }); await wait;
    expect(modelCalls).toBe(2); expect(reader.getTask(taskId)).toMatchObject({ turns: 2, unpricedTurns: 2, status: "review_required" });
    expect(reader.listDispatches(taskId)[1]?.continuationOf).toBe(reader.listDispatches(taskId)[0]?.id);
    expect(reader.getTask(taskId).evidence).toHaveLength(0);
  } finally {
    await server?.stop(true); reader?.close();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    if (previousDescriptor === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR; else process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = previousDescriptor;
    rmSync(home, { recursive: true, force: true });
  }
}, 8_000);
