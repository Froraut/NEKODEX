import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AgentModeRuntime, AgentModeStore } from "../../src/agent-mode";
import { defaultBrokerEndpoint, defaultConfig } from "../../src/config";
import { sha256, writeToolsConfig } from "../../src/agent-tools/config";
import { startServer } from "../../src/server";

// The test parent sets DIRECT/background before this module (and native-network) loads.
const home = realpathSync(mkdtempSync("/tmp/ndx-offline-owner-"));
process.env.CODEX_CHATGPT_WEB_HOME = home;
const release = join(home, "release"); const counter = join(home, "counter");
let server: ReturnType<typeof startServer> | undefined;
let toolPid: number | undefined;
let approval: Promise<any> | undefined;
let nativeRequests = 0;
let failure: unknown;
try {
  const store = new AgentModeStore(join(home, "agent-mode", "state.sqlite"));
  const pending = { toolCallId: "synthetic-held-call", tool: "held/record", wireName: "agent_tool_0", arguments: { text: "Explicitly approved isolated effect" } };
  // A synthetic execution port seeds the immutable pending-call fixture. This is not Web model proof.
  const seed = new AgentModeRuntime({ store, ownerId: "synthetic-held-owner", models: () => [{ id: "synthetic-model" }], executionPort: { async execute(request, acknowledge) {
    acknowledge("synthetic-acceptance");
    return { receiptId: "synthetic-terminal", outcome: "awaiting_input", summary: "Synthetic pending call only; no model request.", actualSpend: null,
      continuation: { responseId: "synthetic-response", rootDispatchId: request.dispatch.id, input: [],
        output: [{ type: "function_call", call_id: pending.toolCallId, name: pending.wireName, arguments: JSON.stringify(pending.arguments) }],
        tools: [], toolMap: [{ wireName: pending.wireName, tool: pending.tool }], pending: [pending] } };
  } } });
  seed.create("seed", { id: "offline-owned-task", ownerMode: "agent", mode: "manual", originalRequest: "Hold one approved local fixture effect while Web transport is unavailable.",
    requirements: [{ id: "receipt", text: "Retain the exact isolated protocol receipt without replay." }], stages: [{ id: "work", instruction: "Wait for exact tool approval.", requirementIds: ["receipt"] }],
    bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "local-responses", model: "synthetic-model" } });
  seed.step("offline-owned-task", "synthetic-stage", { explicitUserAction: true }); await seed.waitForIdle();
  const scope = { taskId: "offline-owned-task", generation: store.getTask("offline-owned-task").generation, toolCallId: pending.toolCallId };
  const key = seed.resolveToolCall(scope)!.idempotencyKey;
  store.close();
  const command = realpathSync(process.execPath); const script = realpathSync(join(import.meta.dir, "agent-tools-held-server.ts"));
  writeToolsConfig(join(home, "agent-tools.json"), { version: 1, enabled: true, servers: [{ id: "held", enabled: true, transport: "stdio", source: { kind: "user-installed", label: "Owned inert SDK fixture", version: "1.0.0" },
    command, commandSha256: sha256(readFileSync(command)), args: [script, counter, release], pinnedFiles: [{ path: script, sha256: sha256(readFileSync(script)) }], cwd: home, envSecretRefs: {} }] });
  const config = { ...defaultConfig("full"), port: 0, browserHost: "launcher" as const,
    brokerSocketPath: process.platform === "win32" ? defaultBrokerEndpoint(home) : join(home, "b.sock") };
  server = startServer(config, { fetchUpstream: async request => { assert.ok(new URL(request.url).pathname.endsWith("/alpha/search")); nativeRequests++; return Response.json({ fixtureNative: true }); } });
  const base = `http://127.0.0.1:${server.port}`;
  const post = async (path: string, body: unknown) => { const response = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() as any }; };
  const health = async () => await (await fetch(`${base}/healthz`)).json() as any;
  const initial = await health(); assert.equal(initial.broker_ready, true); assert.equal(initial.tunnel_ready, false);
  await post("/admin/agent-mode", { action: "get", taskId: scope.taskId });
  const discovered = await post("/admin/agent-tools", { action: "discover", scope, explicitUserAction: true }); assert.equal(discovered.status, 200); assert.ok(discovered.body.value.find((row: any) => row.id === "held/record" && row.supported));
  toolPid = (await post("/admin/agent-tools", { action: "status" })).body.value.runtime.servers[0].pid; assert.ok(toolPid! > 0);
  approval = post("/admin/agent-tools", { action: "approveInvoke", scope, explicitUserAction: true });
  await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); watcher.close(); resolve(); };
    const watcher = watch(dirname(counter), () => { if (existsSync(counter)) finish(); });
    const timer = setTimeout(() => { watcher.close(); reject(new Error("Owned tool did not reach its counter effect")); }, 3_000);
    if (existsSync(counter)) finish();
  });
  assert.equal(readFileSync(counter, "utf8"), "1");
  const live = await health(); assert.ok(live.active_agent_tools > 0); assert.equal(live.active_agent_turns, 0); assert.equal(live.active_web_http_turns, 0); assert.equal(live.active_browser_turns, 0); assert.equal(live.active_compaction_runs, 0); assert.equal(live.web_accepting_turns, false);
  const busyDetach = await post("/admin/runtime-session", { action: "detach", instanceId: initial.instance_id }); assert.equal(busyDetach.status, 409); assert.ok(busyDetach.body.active_agent_tools > 0); assert.equal((await health()).launcher_detached, false);
  writeFileSync(release, "release exact owned operation");
  const terminal = await approval; assert.equal(terminal.status, 200); assert.equal(terminal.body.value.state, "completed"); assert.equal(terminal.body.value.result.structuredContent.count, 1); assert.equal(terminal.body.value.result.structuredContent.released, true);
  assert.equal((await post("/admin/agent-tools", { action: "receipt", idempotencyKey: key })).body.value.state, "completed");
  assert.equal((await health()).active_agent_tools, 0);
  const detached = await post("/admin/runtime-session", { action: "detach", instanceId: initial.instance_id }); assert.equal(detached.status, 200); assert.equal(detached.body.launcher_detached, true); assert.equal(detached.body.native_accepting_turns, true);
  assert.equal((await post("/admin/agent-tools", { action: "discover", scope, explicitUserAction: true })).status, 409);
  const native = await post("/v1/alpha/search", { query: "inert fixture native request" }); assert.equal(native.status, 200); assert.equal(native.body.fixtureNative, true); assert.equal(nativeRequests, 1);
  assert.equal((await post("/admin/runtime-session", { action: "attach", instanceId: initial.instance_id })).status, 200);
  assert.equal((await post("/admin/agent-tools", { action: "discover", scope, explicitUserAction: true })).status, 200);
  const duplicate = await post("/admin/agent-tools", { action: "approveInvoke", scope, explicitUserAction: true }); assert.equal(duplicate.body.value.state, "completed"); assert.equal(readFileSync(counter, "utf8"), "1");
  const detail = await post("/admin/agent-mode", { action: "get", taskId: scope.taskId }); assert.equal(detail.body.value.effectiveToolOutcomes[0].state, "completed"); assert.equal(detail.body.value.dispatches.length, 1);
  await server.stop(true); server = undefined;
  assert.throws(() => process.kill(toolPid!, 0), (error: any) => error.code === "ESRCH");
  console.log(JSON.stringify({ ok: true, webReady: false, syntheticPendingSource: true, realSdkEffectCount: 1, refusedBusyDetach: true, idleDetach: true, blockedDetachedScope: true, attachedScopeRestored: true, nativeFixtureRequests: nativeRequests, sdkChildReaped: true }));
} catch (error) { failure = error; }
finally {
  writeFileSync(release, "cleanup release");
  await approval?.catch(() => {}); await server?.stop(true);
  rmSync(home, { recursive: true, force: true });
}
// This cold fixture imports shared service modules; no service or SDK owner remains here.
if (failure) { console.error(failure); process.exit(1); }
process.exit(0);
