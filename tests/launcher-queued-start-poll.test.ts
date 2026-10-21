import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launcherQueuedStartPollDelayMs, notifyLauncherTurn } from "../src/launcher-browser-control";
import { LAUNCHER_BROWSER_IDLE_URL } from "../src/launcher-browser-descriptor";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("a queued start is re-polled soon, then at the steady half-second cadence", () => {
  expect([0, 1, 2, 3, 4, 5, 50].map(launcherQueuedStartPollDelayMs)).toEqual([50, 100, 200, 400, 500, 500, 500]);
});

test("a start admitted shortly after its queued receipt is picked up without a half-second wait", async () => {
  const token = "t".repeat(43);
  const surfaceId = "s".repeat(32);
  const queueId = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
  const starts: number[] = [];
  let admittedAt: number | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("", { status: 401 });
      const path = new URL(request.url).pathname;
      await request.json();
      if (path === "/v1/turn/start-ack") return Response.json({ ok: true, acknowledged: true });
      if (path !== "/v1/turn/start") return new Response("", { status: 404 });
      const now = performance.now();
      starts.push(now);
      // The launcher admits the queued row in the background about 60 ms after the first request.
      admittedAt ??= now + 60;
      if (now < admittedAt) return Response.json({ ok: true, queued: true, notSent: true, queueId, position: 1 }, { status: 202 });
      return Response.json({ ok: true, queued: false, queueId, surfaceId, tabId: "tab", reused: false, connectorBound: false,
        taskProgressVersion: 1, taskProgressSequence: 0 });
    },
  });
  try {
    const dir = mkdtempSync(join(tmpdir(), "nekodex-queued-start-")); dirs.push(dir);
    const descriptor = join(dir, "descriptor.json");
    const endpoint = `http://127.0.0.1:${server.port}`;
    writeFileSync(descriptor, JSON.stringify({ version: 3, kind: "codex-web-gpt-launcher", profile: "development", pid: process.pid,
      endpoint, control: { endpoint, token }, helper: { executable: process.execPath, script: import.meta.path },
      partition: "persist:codex-web-gpt-dev-chatgpt", idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId,
      surfaceTargets: {}, createdAt: new Date().toISOString() }), { mode: 0o600 });
    const startedAt = performance.now();
    const lease = await notifyLauncherTurn(descriptor, { phase: "start", taskProgressVersion: 1, traceId: "trace_queued",
      helperPid: process.pid });
    const elapsed = performance.now() - startedAt;
    expect(lease.surfaceId).toBe(surfaceId);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    // The old fixed pause re-polled only after 500 ms.
    expect(starts[1]! - starts[0]!).toBeLessThan(250);
    expect(elapsed).toBeLessThan(450);
  } finally {
    server.stop(true);
  }
});
