import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

test("route policy preserves native admission without a Web tunnel and accepts multipart edits", async () => {
  const home = mkdtempSync(join(tmpdir(), "server-policy-"));
  const config = { ...defaultConfig("full"), port: 0, browserHost: "launcher" as const,
    brokerSocketPath: join(home, "broker.sock") };
  let nativeCalls = 0;
  let webCalls = 0;
  const server = startServer(config, {
    fetchUpstream: async request => {
      nativeCalls++;
      if (new URL(request.url).pathname.endsWith("/images/edits")) {
        expect(request.headers.get("content-type")).toContain("multipart/form-data");
        expect(await request.text()).toContain("fixture-image");
      }
      return Response.json({ output: [] });
    },
    adapterFactory: () => { webCalls++; throw new Error("Web must not run"); },
  });
  const endpoint = `http://127.0.0.1:${server.port}`;
  const headers = { authorization: "Bearer fixture", "content-type": "application/json" };
  try {
    const health = await (await fetch(`${endpoint}/healthz`)).json();
    expect(health).toMatchObject({ native_accepting_turns: true, web_accepting_turns: false, tunnel_ready: false });
    const native = await fetch(`${endpoint}/v1/responses`, { method: "POST", headers,
      body: JSON.stringify({ model: "gpt-5.4", input: [] }) });
    expect(native.status).toBe(200);
    await native.text();
    const web = await fetch(`${endpoint}/v1/responses`, { method: "POST", headers,
      body: JSON.stringify({ model: "chatgpt-web/high", input: [] }) });
    expect(web.status).toBe(503);
    const form = new FormData();
    form.set("image", new Blob(["fixture-image"]), "image.png");
    const edit = await fetch(`${endpoint}/v1/images/edits`, { method: "POST",
      headers: { authorization: "Bearer fixture" }, body: form });
    expect(edit.status).toBe(200);
    await edit.text();
    expect(nativeCalls).toBe(2);
    expect(webCalls).toBe(0);
  } finally {
    await server.stop(true);
    await TurnBroker.forSocket(config.brokerSocketPath).close();
    rmSync(home, { recursive: true, force: true });
  }
}, 5000);
