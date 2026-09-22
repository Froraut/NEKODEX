import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { runStructuredCompactionOnce, cancelStructuredCompactionTrace } from "../src/adapters/chatgpt-web/compaction-handoff";

test("signal shutdown rejects resume and new native work while physical cleanup is pending", async () => {
  const key = randomUUID();
  let release!: () => void;
  const physical = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  let aborted = false;
  const run = runStructuredCompactionOnce(key, { ownerKey: key, traceIds: [key] }, (signal, retainUntil) => {
    retainUntil(physical);
    ready();
    return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => {
      aborted = true;
      reject(signal.reason);
    }, { once: true }));
  });
  void run.catch(() => {});
  await started;
  const before = new Set(process.listeners("SIGTERM"));
  const config = { ...defaultConfig("browser-only"), port: 0 };
  let upstreamCalls = 0;
  const server = startServer(config, { fetchUpstream: async () => { upstreamCalls++; return Response.json({}); } });
  const endpoint = `http://127.0.0.1:${server.port}`;
  const headers = { authorization: `Bearer ${config.controlToken}` };
  const shutdown = process.listeners("SIGTERM").find(listener => !before.has(listener));
  const originalStop = server.stop.bind(server);
  let stopped = false;
  server.stop = (...args: Parameters<typeof originalStop>) => { stopped = true; return originalStop(...args); };
  try {
    expect(shutdown).toBeDefined();
    shutdown!("SIGTERM");
    await expect(run).rejects.toThrow("Runtime shutting down");
    expect(aborted).toBe(true); // proves the fixture reached owner cancellation
    expect(stopped).toBe(false);
    expect((await fetch(`${endpoint}/admin/resume`, { method: "POST", headers })).status).toBe(409);
    expect(await (await fetch(`${endpoint}/healthz`)).json()).toMatchObject({ native_accepting_turns: false, draining: true });
    expect((await fetch(`${endpoint}/v1/models`)).status).toBe(503);
    expect(upstreamCalls).toBe(0);
    release();
    const deadline = Date.now() + 1000;
    while (!stopped && Date.now() < deadline) await Bun.sleep(5);
    expect(stopped).toBe(true);
    await expect(fetch(`${endpoint}/healthz`)).rejects.toThrow();
  } finally {
    release();
    await cancelStructuredCompactionTrace(key, new Error("fixture cleanup"));
    await server.stop(true);
  }
}, 5000);

test("ordinary drain resumes but accepted idle shutdown is irreversible before its timer", async () => {
  const config = { ...defaultConfig("browser-only"), port: 0 };
  let nativeCalls = 0;
  const server = startServer(config, { fetchUpstream: async () => { nativeCalls++; return Response.json({}); } });
  const endpoint = `http://127.0.0.1:${server.port}`;
  const headers = { authorization: `Bearer ${config.controlToken}` };
  // Direct dispatch lets us issue the next request in the same timer turn.
  const control = (path: string) => server.fetch(new Request(`${endpoint}${path}`, {
    method: "POST", headers: { ...headers, host: `127.0.0.1:${server.port}` },
  }));
  const search = () => server.fetch(new Request(`${endpoint}/v1/alpha/search`, {
    method: "POST", headers: { host: `127.0.0.1:${server.port}`, authorization: "Bearer fixture", "content-type": "application/json" },
    body: JSON.stringify({ query: "fixture" }),
  }));
  try {
    expect((await control("/admin/drain")).status).toBe(200);
    expect((await search()).status).toBe(503);
    expect(nativeCalls).toBe(0);
    expect((await control("/admin/resume")).status).toBe(200);
    const resumed = await search();
    expect(resumed.status).toBe(200);
    await resumed.text();
    expect(nativeCalls).toBe(1);
    expect((await control("/admin/drain")).status).toBe(200);
    expect((await control("/admin/shutdown")).status).toBe(200);
    expect((await control("/admin/resume")).status).toBe(409);
  } finally {
    await Bun.sleep(10); // allow the accepted shutdown callback to settle before fixture disposal
    await server.stop(true);
  }
}, 5000);
