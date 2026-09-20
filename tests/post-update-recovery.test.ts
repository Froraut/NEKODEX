import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, defaultBrokerEndpoint } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { startServer } from "../src/server";

test("post-update: stale tunnel loss cannot overwrite recovered Web admission", async () => {
  const root = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "nk-tunnel-"));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  const config = { ...defaultConfig("full"), port: 0, browserHost: "launcher" as const,
    brokerSocketPath: defaultBrokerEndpoint(root) };
  const broker = TurnBroker.forSocket(config.brokerSocketPath);
  let server: ReturnType<typeof startServer> | undefined;
  try {
    await broker.listen();
    server = startServer(config);
    const status = async (ready: boolean, revision: number) => {
      const response = await fetch(`http://127.0.0.1:${server!.port}/admin/tunnel-status`, {
        method: "POST", headers: { authorization: `Bearer ${config.controlToken}`, "content-type": "application/json" },
        body: JSON.stringify({ ready, revision }),
      });
      expect(response.status).toBe(200);
      return response.json();
    };
    expect(await status(true, 2)).toMatchObject({ applied: true, tunnel_status_revision: 2,
      native_accepting_turns: true, web_accepting_turns: true, tunnel_ready: true });
    expect(await status(false, 1)).toMatchObject({ applied: false, tunnel_status_revision: 2,
      native_accepting_turns: true, web_accepting_turns: true, tunnel_ready: true });
    const health = await fetch(`http://127.0.0.1:${server.port}/healthz`).then(response => response.json());
    expect(health).toMatchObject({ tunnel_status_revision: 2, tunnel_ready: true,
      native_accepting_turns: true, web_accepting_turns: true });
  } finally {
    server?.disposeSignalHandlers();
    server?.stop(true);
    await broker.close();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
