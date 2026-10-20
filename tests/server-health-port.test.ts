import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";

test.serial("ephemeral listener advertises a reachable health port for the same server instance", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-health-port-")));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const previousDescriptor = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  const signalCounts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  let server: ReturnType<typeof startServer> | undefined;
  let endpoint: string | undefined;
  const request = (url: string) => fetch(url, { proxy: "", redirect: "error", signal: AbortSignal.timeout(1_000) });
  try {
    const config = { ...defaultConfig(), port: 0 };
    server = startServer(config, { fetchUpstream: async () => { throw new Error("Health fixture must not contact a provider"); } });
    const destinationPort = server.port!;
    expect(destinationPort).toBeGreaterThan(0);
    endpoint = `http://127.0.0.1:${destinationPort}/healthz`;
    const response = await request(endpoint);
    expect(response.status).toBe(200);
    const health = await response.json() as { status: string; service: string; mode: string; pid: number; instance_id: string; port: number };
    expect(health).toMatchObject({ status: "ok", service: "codex-chatgpt-web", mode: config.mode, pid: process.pid, port: destinationPort });
    expect(health.instance_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(config.port).toBe(0);

    // Reconnect through the response's advertised endpoint, rather than only
    // comparing two in-memory values supplied by the server implementation.
    const reconnected = await request(`http://127.0.0.1:${health.port}/healthz`);
    expect(reconnected.status).toBe(200);
    expect(await reconnected.json()).toMatchObject({ instance_id: health.instance_id, pid: health.pid, port: destinationPort });
  } finally {
    try { await server?.stop(true); }
    finally {
      if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
      if (previousDescriptor === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR; else process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR = previousDescriptor;
      rmSync(home, { recursive: true, force: true });
    }
  }
  expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signalCounts);
  expect(existsSync(home)).toBe(false);
  await expect(request(endpoint!)).rejects.toThrow();
}, 5_000);
