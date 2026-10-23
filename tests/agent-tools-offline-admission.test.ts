import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultBrokerEndpoint, defaultConfig } from "../src/config";
import { startServer } from "../src/server";

test.serial("local tools inventory remains offline while Web offers and drained new desktop work stay closed", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-tools-offline-")));
  const keys = ["CODEX_CHATGPT_WEB_HOME", "CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR", "CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME"] as const;
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  delete process.env.CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME;
  let server: ReturnType<typeof startServer> | undefined;
  let providerRequests = 0;
  try {
    const config = { ...defaultConfig("full"), port: 0, browserHost: "launcher" as const,
      brokerSocketPath: process.platform === "win32" ? defaultBrokerEndpoint(home) : join(home, "b.sock") };
    server = startServer(config, { fetchUpstream: async () => { providerRequests++; throw new Error("Offline fixture must not contact a provider"); } });
    const base = `http://127.0.0.1:${server.port}`;
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as any };
    };
    const health = await (await fetch(`${base}/healthz`)).json() as any;
    expect(health).toMatchObject({ broker_ready: true, tunnel_ready: false, tunnel_status_revision: 0, web_accepting_turns: false, native_accepting_turns: true });
    const modelStatus = await post("/admin/agent-mode", { action: "status" });
    expect(modelStatus.status).toBe(200);
    expect(modelStatus.body.value.accepting).toBe(false);
    const created = await post("/admin/agent-mode", { action: "create", actionId: "offline-create", input: {
      ownerMode: "agent", id: "offline-task", mode: "manual", originalRequest: "Prepare local tools without sending a model request.",
      requirements: [{ id: "local", text: "Keep the synthetic task ready for explicit future execution." }],
      stages: [{ id: "wait", instruction: "Wait for an explicit future action.", requirementIds: ["local"] }],
      bounds: { maxConcurrent: 1, maxTurns: 2, maxSpend: null }, execution: { provider: "local-responses", model: modelStatus.body.value.models[0].id },
    } });
    expect(created.status).toBe(201);
    const scope = { taskId: "offline-task", generation: created.body.value.task.generation, toolCallId: "offline-inventory" };
    const inventory = await post("/admin/agent-tools", { action: "status" });
    expect(inventory.status).toBe(200);
    expect(inventory.body.value.config).toMatchObject({ enabled: false, servers: [] });
    expect(inventory.body.value.desktopTools).toMatchObject({ created: false, enabled: false, activeCount: 0 });
    const discovered = await post("/admin/agent-tools", { action: "discover", scope, explicitUserAction: true });
    expect(discovered.status).toBe(200);
    expect(discovered.body.value.some((row: any) => row.id === "desktop/observe")).toBe(true);
    expect(discovered.body.value.every((row: any) => row.supported === false)).toBe(true);
    const blockedOffer = await post("/admin/agent-mode", { action: "step", taskId: scope.taskId, actionId: "offline-step", explicitUserAction: true });
    expect(blockedOffer.status).toBe(409);
    expect((await post("/admin/drain", {})).status).toBe(200);
    expect((await post("/admin/agent-tools", { action: "discover", scope, explicitUserAction: true })).status).toBe(409);
    for (const action of ["inspectDesktopPermissions", "openDesktopPermissionSettings", "listDesktopWindows", "setDesktopEnabled", "selectDesktopWindow"]) {
      const denied = await post("/admin/agent-tools", { action, explicitUserAction: true,
        ...(action === "setDesktopEnabled" ? { enabled: true } : {}),
        ...(action === "openDesktopPermissionSettings" ? { permission: "accessibility" } : {}),
        ...(action === "selectDesktopWindow" ? { scope, expectedSelection: { windowId: "1", processId: "1:1", windowEpoch: "0".repeat(64) } } : {}),
      });
      expect(denied.status).toBe(409);
    }
    expect((await post("/admin/agent-tools", { action: "setDesktopEnabled", enabled: false, explicitUserAction: true })).status).toBe(200);
    expect((await post("/admin/agent-tools", { action: "revokeDesktopTools", scope, explicitUserAction: true })).status).toBe(200);
    const after = await post("/admin/agent-tools", { action: "status" });
    expect(after.status).toBe(200);
    expect(after.body.value.desktopTools).toMatchObject({ created: false, enabled: false, activeCount: 0, bindings: [] });
    expect(after.body.value.runtime.servers).toEqual([]);
    expect(after.body.value.activeCount).toBe(0);
    expect(providerRequests).toBe(0);
    const task = await post("/admin/agent-mode", { action: "get", taskId: scope.taskId });
    expect(task.body.value.task).toMatchObject({ status: "ready", turns: 0 });
    expect(task.body.value.dispatches).toEqual([]);
  } finally {
    await server?.stop(true);
    for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(home, { recursive: true, force: true });
  }
}, 5_000);

test("an actual approved SDK owner blocks detach offline, then settles once and preserves native HTTP after idle detach", async () => {
  const env = { ...process.env };
  for (const key of ["CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR", "CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY", "CODEX_CHATGPT_WEB_NATIVE_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key];
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/agent-tools-offline-owner.ts")], { env: { ...env, CODEX_CHATGPT_WEB_BACKGROUND_RUNTIME: "1", CODEX_CHATGPT_WEB_NATIVE_BACKGROUND_ROUTE: "DIRECT" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit !== 0) throw new Error(`Owned offline SDK fixture exited ${exit}: ${stderr}`);
  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual({ ok: true, webReady: false, syntheticPendingSource: true, realSdkEffectCount: 1, refusedBusyDetach: true, idleDetach: true, blockedDetachedScope: true, attachedScopeRestored: true, nativeFixtureRequests: 2, nativeRecoveryQuiescence: true, sdkChildReaped: true });
}, 10_000);
