import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalControlApiRoutes, LocalControlApiPolicy } from "../src/local-control-api";
import { AgentModeRuntime, AgentModeStore } from "../src/agent-mode";
import { localControlApiCommand, parseLocalControlClientArguments, runLocalControlClient } from "../src/local-control-api/client";
const input = (token: string) => (async function* () { yield Buffer.from(token + "\n"); })();
const READ = "nk-read-" + "a".repeat(64), ADMIN = "synthetic-administrative-control-credential";
const readArgs = (verb = "status", origin = "http://127.0.0.1:17841") => [verb, "--origin", origin, "--token-stdin"];
const actionArgs = (origin: string, actionId = randomUUID()) => ["action", "--operation", "pause", "--task-id", "fixture-task", "--family-id", "fixture-family", "--generation", "1", "--revision", "1", "--action-id", actionId, "--origin", origin, "--token-stdin"];

test("named consumer uses actual HTTP metadata sources and one existing scoped action owner without model offers", async () => {
  const root = mkdtempSync(join(tmpdir(), "neko-local-api-client-"));
  const store = new AgentModeStore(join(root, "tasks.sqlite")); let offers = 0, requests = 0;
  const runtime = new AgentModeRuntime({ store, models: () => [{ id: "fixture-model" }], executionPort: { async execute() { offers++; throw new Error("No model offer is authorized by these reads or Pause"); } }, ownerId: "fixture-owner" });
  runtime.create("create-fixture", { id: "fixture-task", familyId: "fixture-family", ownerMode: "agent", mode: "manual", originalRequest: "PRIVATE TASK CONTENT MUST NOT APPEAR",
    execution: { provider: 'local-responses', model: 'fixture-model' },
    requirements: [{ id: "r", text: "No inference" }], stages: [{ id: "s", instruction: "Stay idle", requirementIds: ["r"] }], bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null } });
  const policy = new LocalControlApiPolicy(root), readToken = policy.change("enable", { consent: true }).readToken!;
  let server: Bun.Server<undefined>;
  const route = createLocalControlApiRoutes({ coreHome: root, authorizeAdmin: request => request.headers.get("authorization") === `Bearer ${ADMIN}`,
    port: () => server.port!, peerAddress: request => server.requestIP(request)?.address,
    localGuard: (request, _url, port) => request.headers.get("host") === `127.0.0.1:${port}` ? undefined : new Response("Forbidden", { status: 403 }),
    sources: { status: () => ({ version: "fixture", ready: true, activeHttpTurns: offers, activeAgentTasks: runtime.activeCount }),
      agentTasks: () => store.listTasks().map(task => ({ id: task.id, state: task.status, generation: task.generation, revision: task.revision })),
      history: () => ({ status: () => ({ recordingEnabled: false, totalMessages: 0, indexedMessages: 0, incompleteMessages: 0 }) } as any) },
    agentAction: action => runtime.executeScopedAction(action) });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async request => { requests++; return await route(request) ?? new Response("Unknown", { status: 404 }); } });
  const origin = `http://127.0.0.1:${server.port}`;
  try {
    const status = await runLocalControlClient(readArgs("status", origin), { input: input(readToken) });
    expect(status).toMatchObject({ ok: true, value: { version: "fixture", ready: true, activeHttpTurns: 0 } });
    const tasks = await runLocalControlClient([...readArgs("agent-tasks", origin), "--limit", "1", "--offset", "0"], { input: input(readToken) });
    expect(tasks).toMatchObject({ ok: true, value: { total: 1, items: [{ id: "fixture-task", state: "ready" }], content: "metadata-only" } });
    expect(JSON.stringify(tasks)).not.toContain("PRIVATE TASK CONTENT");
    expect(await runLocalControlClient(readArgs("tasks", origin), { input: input(readToken) })).toMatchObject({ ok: false, httpStatus: 503, error: { code: "source_unavailable" } });
    expect(await runLocalControlClient(readArgs("history-coverage", origin), { input: input(readToken) })).toMatchObject({ ok: true, value: { transcriptCoverage: "unknown", contentAccess: false, totalMessages: 0 } });
    expect(offers).toBe(0);
    const actionId = randomUUID(), args = actionArgs(origin, actionId);
    const paused = await runLocalControlClient(args, { input: input(ADMIN) });
    expect(paused).toMatchObject({ ok: true, actionId, value: { actionId, operation: "pause", task: { id: "fixture-task", state: "paused" }, duplicate: false } });
    expect(JSON.stringify(paused)).not.toContain("PRIVATE TASK CONTENT");
    expect(await runLocalControlClient(args, { input: input(ADMIN) })).toMatchObject({ ok: true, value: { duplicate: true } });
    expect(offers).toBe(0); expect(requests).toBe(6);
    policy.change("disable");
    expect(await runLocalControlClient(readArgs("status", origin), { input: input(readToken) })).toMatchObject({ ok: false, httpStatus: 404, error: { code: "api_disabled" } });
  } finally { await server.stop(true); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("client rejects unsafe destinations and secret arguments before any request, and stdin has one bounded UTF-8 credential line", async () => {
  for (const value of ["https://127.0.0.1:17841", "http://localhost:17841", "http://example.invalid:17841", "http://127.0.0.1:17841/path", "http://127.0.0.1:17841?q=x", "http://127.0.0.1:17841#x", "http://user:pass@127.0.0.1:17841", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.1:17841"]) expect(() => parseLocalControlClientArguments(readArgs("status", value))).toThrow();
  expect(parseLocalControlClientArguments(readArgs("status", "http://[::1]:17841"))).toMatchObject({ origin: "http://[::1]:17841" });
  expect(parseLocalControlClientArguments(readArgs("status", "http://127.0.0.1:80"))).toMatchObject({ origin: "http://127.0.0.1" });
  expect(() => parseLocalControlClientArguments([...readArgs(), "--token", READ])).toThrow();
  expect(() => parseLocalControlClientArguments([...readArgs(), "--origin", "http://127.0.0.1:1"])).toThrow();
  let requests = 0;
  const request = async () => { requests++; return Response.json({}); };
  for (const value of [READ + "\nsecond", READ + "\n\n", " " + READ, "x".repeat(1025)]) await expect(runLocalControlClient(readArgs(), { input: input(value), request })).rejects.toThrow();
  await expect(runLocalControlClient(actionArgs("http://127.0.0.1:17841"), { input: input(READ), request })).rejects.toThrow("administrative");
  await expect(runLocalControlClient(actionArgs("http://127.0.0.1:17841"), { input: input("unknown"), request })).rejects.toThrow("administrative");
  await expect(runLocalControlClient(readArgs(), { input: (async function* () { yield Buffer.from([0xff]); })(), request })).rejects.toThrow("UTF-8");
  await expect(runLocalControlClient(readArgs(), { input: (async function* () { throw new Error(READ); })(), request })).rejects.toThrow("could not be read safely");
  expect(requests).toBe(0);
});

test("a POST transport failure or invalid receipt stays unknown with the same caller action ID and no automatic resend or secret output", async () => {
  const actionId = randomUUID(), args = actionArgs("http://127.0.0.1:17841", actionId);
  for (const reply of [undefined, "not JSON", JSON.stringify({ apiVersion: "1", ok: true, value: { task: { id: "fixture-task", status: "paused", originalRequest: ADMIN } } }),
    JSON.stringify({ apiVersion: "1", ok: true, value: { task: { id: "fixture-task", familyId: "wrong-family", status: "paused" } } }),
    JSON.stringify({ apiVersion: "1", ok: true, value: { task: { id: "fixture-task", status: "paused" } } })]) {
    let calls = 0, output = "";
    const ok = await localControlApiCommand(args, { input: input(ADMIN), write: text => { output += text; }, request: async (_url, init) => {
      calls++; expect(init.redirect).toBe("error"); expect(JSON.parse(init.body as string)).toMatchObject({ actionId, explicitUserAction: true });
      if (reply === undefined) throw new Error(ADMIN);
      return new Response(reply, { status: 202 });
    } });
    expect(ok).toBe(false); expect(calls).toBe(1); expect(JSON.parse(output)).toMatchObject({ actionId, outcome: "unknown", error: { code: "action_outcome_unknown" } }); expect(output).not.toContain(ADMIN);
  }
});

test("actual HTTP redirects are refused without forwarding credentials or issuing the redirected request", async () => {
  let redirected = 0, initial = 0;
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { redirected++; return Response.json({ apiVersion: "1", ok: true, value: {} }); } });
  const source = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { initial++; return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${destination.port}/api/v1/status` } }); } });
  try {
    expect(await runLocalControlClient(readArgs("status", `http://127.0.0.1:${source.port}`), { input: input(READ) })).toMatchObject({ ok: false, error: { code: "local_api_response_unavailable" } });
    expect(initial).toBe(1); expect(redirected).toBe(0);
  } finally { await source.stop(true); await destination.stop(true); }
});

test("streamed oversize and timed-out POST receipts stay unknown and never trigger another request", async () => {
  const args = actionArgs("http://127.0.0.1:17841"), actionId = args[args.indexOf("--action-id") + 1];
  let calls = 0, cancelled = false;
  const oversized = await runLocalControlClient(args, { input: input(ADMIN), request: async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }), { status: 202 });
  } });
  expect(oversized).toMatchObject({ actionId, outcome: "unknown" }); expect(calls).toBe(1); expect(cancelled).toBe(true);
  const timeout = await runLocalControlClient(args, { input: input(ADMIN), timeoutMs: 5, request: async (_url, init) => {
    calls++;
    return await new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error(ADMIN)), { once: true }));
  } });
  expect(timeout).toMatchObject({ actionId, outcome: "unknown", error: { code: "action_outcome_unknown" } }); expect(calls).toBe(2);
});

test("named CLI sends credentials directly to numeric loopback despite inherited proxy variables", async () => {
  let proxyRequests = 0, destinationRequests = 0;
  const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { proxyRequests++; return Response.json({ apiVersion: "1", ok: true, value: { version: "proxy", ready: true, permissions: [] } }); } });
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { destinationRequests++; return Response.json({ apiVersion: "1", ok: true, value: { version: "direct", ready: true, permissions: [] } }); } });
  try {
    const child = Bun.spawn([process.execPath, "run", new URL("../src/cli.ts", import.meta.url).pathname, "local-api", ...readArgs("status", `http://127.0.0.1:${destination.port}`)], {
      env: { ...process.env, HTTP_PROXY: `http://127.0.0.1:${proxy.port}`, HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`, ALL_PROXY: `http://127.0.0.1:${proxy.port}`,
        http_proxy: `http://127.0.0.1:${proxy.port}`, https_proxy: `http://127.0.0.1:${proxy.port}`, all_proxy: `http://127.0.0.1:${proxy.port}`, NO_PROXY: "", no_proxy: "" },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write(READ + "\n"); child.stdin.end();
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(out).not.toContain(READ); expect(err).not.toContain(READ); expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ ok: true, value: { version: "direct" } });
    expect(destinationRequests).toBe(1); expect(proxyRequests).toBe(0);
  } finally { await proxy.stop(true); await destination.stop(true); }
}, 10000);

test("decoded escaped credentials never enter success or error output, and ambiguous POST conflicts stay unknown", async () => {
  let output = "";
  const escapedRead = JSON.stringify({ apiVersion: "1", ok: true, value: { version: READ, ready: true, permissions: [] } }).replace("nk-read-", "\\u006ek-read-");
  expect(escapedRead).not.toContain(READ);
  await localControlApiCommand(readArgs(), { input: input(READ), write: text => { output = text; }, request: async () => new Response(escapedRead) });
  expect(JSON.parse(output)).toMatchObject({ ok: false, error: { code: "local_api_response_unavailable" } }); expect(output).not.toContain(READ);
  const admin = "administrative_token_that_can_match_error_code";
  const escapedError = JSON.stringify({ apiVersion: "1", ok: false, error: { code: admin } }).replace(admin, "\\u0061" + admin.slice(1));
  expect(escapedError).not.toContain(admin);
  await localControlApiCommand(actionArgs("http://127.0.0.1:17841"), { input: input(admin), write: text => { output = text; }, request: async () => new Response(escapedError, { status: 400 }) });
  expect(JSON.parse(output)).toMatchObject({ outcome: "unknown" }); expect(output).not.toContain(admin);
  const args = actionArgs("http://127.0.0.1:17841"), actionId = args[args.indexOf("--action-id") + 1]; let calls = 0;
  expect(await runLocalControlClient(args, { input: input(ADMIN), request: async () => { calls++; return Response.json({ apiVersion: "1", ok: false, error: { code: "action_conflict" } }, { status: 409 }); } })).toMatchObject({ actionId, outcome: "unknown", error: { code: "action_outcome_unknown" } });
  expect(calls).toBe(1);
  for (const scope of [{ generation: 0, revision: 1 }, { generation: 2, revision: 2 }]) {
    expect(await runLocalControlClient(args, { input: input(ADMIN), request: async () => Response.json({ apiVersion: "1", ok: true, value: { task: { id: "fixture-task", familyId: "fixture-family", status: "paused", ...scope } } }, { status: 202 }) })).toMatchObject({ actionId, outcome: "unknown" });
  }
});

test("actual HTTP empty 204/205 action responses produce unknown receipts without escaping the transport callback", async () => {
  let status = 204, requests = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { requests++; return new Response(null, { status }); } });
  try {
    for (const nextStatus of [204, 205]) {
      status = nextStatus;
      const args = actionArgs(`http://127.0.0.1:${server.port}`), actionId = args[args.indexOf("--action-id") + 1];
      expect(await runLocalControlClient(args, { input: input(ADMIN) })).toMatchObject({ ok: false, actionId, outcome: "unknown", error: { code: "action_outcome_unknown" } });
    }
    expect(requests).toBe(2);
  } finally { await server.stop(true); }
});
