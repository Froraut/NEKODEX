import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import {
  activeStructuredCompactionCount,
  cancelStructuredCompactionTrace,
  runStructuredCompactionOnce,
} from "../src/adapters/chatgpt-web/compaction-handoff";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";

test("idle shutdown refuses detached compaction until its physical cleanup finishes", async () => {
  const key = `shutdown-${randomUUID()}`;
  let operatorSignal!: AbortSignal;
  let releasePhysical!: () => void;
  const physical = new Promise<void>(resolve => { releasePhysical = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const run = runStructuredCompactionOnce(key, { ownerKey: key, traceIds: [key] }, (signal, retainUntil) => {
    operatorSignal = signal;
    retainUntil(physical);
    started();
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  void run.catch(() => {});
  await ready;
  const config = { ...defaultConfig("browser-only"), port: 0 };
  const server = startServer(config);
  const endpoint = `http://127.0.0.1:${server.port}`;
  const headers = { authorization: `Bearer ${config.controlToken}` };
  try {
    expect(await (await fetch(`${endpoint}/healthz`)).json()).toMatchObject({
      active_http_turns: 0,
      active_browser_turns: 0,
      active_compaction_runs: 1,
    });
    await fetch(`${endpoint}/admin/drain`, { method: "POST", headers });
    const shutdown = await fetch(`${endpoint}/admin/shutdown`, { method: "POST", headers });
    expect(shutdown.status).toBe(409);
    expect(await shutdown.json()).toMatchObject({ status: "refused", active_compaction_runs: 1 });
    expect(operatorSignal.aborted).toBe(false);

    const cancellation = cancelStructuredCompactionTrace(key, new Error("fixture cancelled"));
    await expect(run).rejects.toThrow("fixture cancelled");
    expect(activeStructuredCompactionCount()).toBe(1);
    expect((await fetch(`${endpoint}/admin/shutdown`, { method: "POST", headers })).status).toBe(409);
    releasePhysical();
    await cancellation;
    expect(activeStructuredCompactionCount()).toBe(0);
    const accepted = await fetch(`${endpoint}/admin/shutdown`, { method: "POST", headers });
    expect(accepted.status).toBe(200);
    await accepted.text();
    const deadline = Date.now() + 1_000;
    let stopped = false;
    while (!stopped && Date.now() < deadline) {
      await Bun.sleep(5);
      try { await fetch(`${endpoint}/healthz`); } catch { stopped = true; }
    }
    expect(stopped).toBe(true);
  } finally {
    releasePhysical();
    await cancelStructuredCompactionTrace(key, new Error("fixture cleanup"));
    await server.stop(true);
  }
});

test("signal shutdown aborts detached compaction and an HTTP request awaiting its response", async () => {
  const key = `signal-${randomUUID()}`;
  let operatorAborted = false;
  let upstreamAborted = false;
  let markCompactionReady!: () => void;
  let markUpstreamReady!: () => void;
  const compactionReady = new Promise<void>(resolve => { markCompactionReady = resolve; });
  const upstreamReady = new Promise<void>(resolve => { markUpstreamReady = resolve; });
  const run = runStructuredCompactionOnce(key, { ownerKey: key, traceIds: [key] }, signal => {
    markCompactionReady();
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        operatorAborted = true;
        reject(signal.reason);
      }, { once: true });
    });
  });
  void run.catch(() => {});
  await compactionReady;
  const priorInt = new Set(process.listeners("SIGINT"));
  const priorTerm = new Set(process.listeners("SIGTERM"));
  const config = { ...defaultConfig("browser-only"), port: 0 };
  const server = startServer(config, {
    fetchUpstream: async upstreamRequest => new Promise<Response>((_resolve, reject) => {
      const signal = upstreamRequest.signal;
      signal.addEventListener("abort", () => {
        upstreamAborted = true;
        reject(signal.reason);
      }, { once: true });
      markUpstreamReady();
    }),
  });
  const shutdown = process.listeners("SIGTERM").find(listener => !priorTerm.has(listener));
  const endpoint = `http://127.0.0.1:${server.port}`;
  const response = fetch(`${endpoint}/v1/alpha/search`, {
    method: "POST",
    headers: { authorization: "Bearer fixture-session", "content-type": "application/json" },
    body: JSON.stringify({ query: "shutdown fixture" }),
  }).then(result => result.text(), () => undefined);
  try {
    await upstreamReady;
    // Invoke only this server's registered handler, so other in-process test servers do not
    // receive an artificial process signal. Production SIGTERM invokes the same function.
    expect(shutdown).toBeDefined();
    shutdown!("SIGTERM");
    await expect(run).rejects.toThrow("Runtime shutting down");
    await response;
    expect(operatorAborted).toBe(true);
    expect(upstreamAborted).toBe(true);
    const deadline = Date.now() + 1_000;
    while (activeStructuredCompactionCount() > 0 && Date.now() < deadline) await Bun.sleep(5);
    expect(activeStructuredCompactionCount()).toBe(0);
  } finally {
    await cancelStructuredCompactionTrace(key, new Error("fixture cleanup"));
    await server.stop(true);
    for (const listener of process.listeners("SIGINT")) if (!priorInt.has(listener)) process.removeListener("SIGINT", listener);
    for (const listener of process.listeners("SIGTERM")) if (!priorTerm.has(listener)) process.removeListener("SIGTERM", listener);
  }
});

for (const path of ["/v1/responses", "/v1/alpha/search", "/v1/images/edits"]) test(`signal shutdown releases an incomplete upload to ${path}`, async () => {
  const priorInt = new Set(process.listeners("SIGINT"));
  const priorTerm = new Set(process.listeners("SIGTERM"));
  const config = { ...defaultConfig("browser-only"), port: 0 };
  let adapterRuns = 0;
  let nativeRuns = 0;
  const server = startServer(config, { adapterFactory: () => ({
    name: "incomplete-upload-fixture",
    async runTurn() { adapterRuns += 1; },
  }), fetchUpstream: async () => {
    nativeRuns += 1;
    return new Response("fixture native result");
  } });
  const shutdown = process.listeners("SIGTERM").find(listener => !priorTerm.has(listener));
  const endpoint = `http://127.0.0.1:${server.port}`;
  const socket = createConnection({ host: "127.0.0.1", port: server.port! });
  const body = JSON.stringify({ model: "chatgpt-web/high", stream: false, input: "shutdown fixture" });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.on("error", () => {});
    socket.write([
      `POST ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${server.port}`,
      "Authorization: Bearer fixture-session",
      "Content-Type: application/json",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "Connection: keep-alive",
      "",
      body.slice(0, 1),
    ].join("\r\n"));
    const activeDeadline = Date.now() + 1_000;
    let active = 0;
    while (active !== 1 && Date.now() < activeDeadline) {
      active = ((await (await fetch(`${endpoint}/healthz`)).json()) as { active_http_turns: number }).active_http_turns;
      if (active !== 1) await Bun.sleep(5);
    }
    expect(active).toBe(1);
    shutdown!("SIGTERM");
    const stopDeadline = Date.now() + 1_000;
    let stopped = false;
    while (!stopped && Date.now() < stopDeadline) {
      await Bun.sleep(5);
      try { await fetch(`${endpoint}/healthz`); } catch { stopped = true; }
    }
    expect(stopped).toBe(true);
    expect(adapterRuns).toBe(0);
    expect(nativeRuns).toBe(0);
  } finally {
    // Complete the harmless fixture if shutdown regresses, so a failing test does not retain
    // a permanently pending upload and block the rest of the test process.
    if (!socket.destroyed) socket.end(body.slice(1));
    await Bun.sleep(5);
    socket.destroy();
    await server.stop(true);
    for (const listener of process.listeners("SIGINT")) if (!priorInt.has(listener)) process.removeListener("SIGINT", listener);
    for (const listener of process.listeners("SIGTERM")) if (!priorTerm.has(listener)) process.removeListener("SIGTERM", listener);
  }
});
