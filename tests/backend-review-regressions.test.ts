import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forwardNativeCodexRequest } from "../src/native-passthrough";
import { rememberResponseState, flushResponseState } from "../src/responses/state";
import { HttpTurnCounter } from "../src/server";
import { LauncherBrowserHelperClient } from "../src/adapters/chatgpt-web/launcher-helper-client";
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from "../src/launcher-browser-host";
import { ChatGptLunaCheckpointStore } from "../src/adapters/chatgpt-web/rolling-checkpoint";
import { parseRequest } from "../src/responses/parser";
import { encodeReasoningEnvelope } from "../src/responses/reasoning-envelope";

const home = mkdtempSync(join(tmpdir(), "nekodex-review-regressions-"));
const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
process.env.CODEX_CHATGPT_WEB_HOME = home;
afterAll(() => {
  flushResponseState();
  if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
  else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

test("review: native continuation expands a locally owned Web response only", async () => {
  const id = "resp_review_local_123";
  rememberResponseState({ input: [{ role: "user", content: "original question" }] }, {
    id, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "original answer" }] }],
  });
  let forwarded: any;
  const body = { model: "gpt-5.6-sol", previous_response_id: id, input: [{ role: "user", content: "continue" }] };
  await forwardNativeCodexRequest(new Request("http://localhost/v1/responses", {
    method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify(body),
  }), "responses", async request => { forwarded = await request.json(); return new Response("ok"); });
  expect(forwarded.previous_response_id).toBeUndefined();
  expect(forwarded.input).toHaveLength(3);
  expect(forwarded.input[0].content).toBe("original question");
  expect(forwarded.input[2].content).toBe("continue");
});

test("review: Windows-shaped delivery stays bounded until consumer demand", async () => {
  const turns = new HttpTurnCounter();
  let pulls = 0;
  const response = await turns.track(async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(32768)); if (pulls === 20) controller.close(); },
  })), undefined, "win32");
  await Bun.sleep(20);
  expect(pulls).toBeLessThanOrEqual(4);
  expect(turns.count()).toBe(1);
  const reader = response.body!.getReader();
  expect((await reader.read()).value?.length).toBe(32768);
  await reader.cancel();
  await Bun.sleep(10);
  expect(turns.count()).toBe(0);
});

test("review: closing a helper before ready settles the pending run", async () => {
  const helper = join(home, "waiting-helper.cjs");
  writeFileSync(helper, 'process.stdin.on("data", () => process.exit(0)); setInterval(() => {}, 1000);');
  const descriptor = join(home, "launcher.json");
  writeFileSync(descriptor, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND,
    profile: "production", pid: process.pid, endpoint: "http://127.0.0.1:39001",
    control: { endpoint: "http://127.0.0.1:39002", token: "launcher-control-token-0123456789abcdefghijklmnop" },
    helper: { executable: process.execPath, script: helper }, partition: "persist:codex-web-gpt-chatgpt",
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: "launcher_surface_id_0123456789AB",
    surfaceTargets: { launcher_surface_id_0123456789AB: "native-owned-target" }, createdAt: new Date().toISOString(),
  }), { mode: 0o600 });
  const client = new LauncherBrowserHelperClient({ appName: "Codex Native3", browserHost: "launcher",
    browserHostDescriptorPath: descriptor, browserHelperScriptPath: helper, storageStatePath: join(home, "unused.json"),
    chromeExecutablePath: "/unused", turnTimeoutMs: 60_000, headed: true, autoApproveToolCalls: false });
  const result = client.run({ traceId: "review_helper_123", modelId: "gpt-5.6-sol",
    capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: false },
    prepare: async () => ({ text: "unused", images: [], release() {} }), onTextDelta() {},
  }).catch(error => error);
  await client.close();
  expect((await result).name).toBe("AbortError");
}, 3000);

test("review: checkpoint read failure does not authorize overwrite on retry", () => {
  const path = join(home, "checkpoints.json");
  writeFileSync(path, "invalid-json");
  const store = new ChatGptLunaCheckpointStore(path);
  const access = store as unknown as { get(thread: string, hash: string): unknown };
  expect(() => access.get("thread", "a".repeat(64))).toThrow();
  expect(() => access.get("thread", "a".repeat(64))).toThrow();
  expect(readFileSync(path, "utf8")).toBe("invalid-json");
  writeFileSync(path, JSON.stringify({ version: 1, checkpoints: [] }));
  expect(access.get("thread", "a".repeat(64))).toBeUndefined();
});

test("review: parser rejects inline file bytes and retains opaque redacted metadata", () => {
  expect(() => parseRequest({ model: "chatgpt-web/medium", input: [{ role: "user", content: [{ type: "input_file", file_data: "data:application/pdf;base64,AA==" }] }] })).toThrow("file_data");
  const parsed = parseRequest({ model: "chatgpt-web/medium", input: [
    { type: "reasoning", encrypted_content: encodeReasoningEnvelope({ red: ["opaque-fixture"] }), summary: [] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
  ] });
  expect(JSON.stringify(parsed.context.messages)).toContain("opaque-fixture");
});
