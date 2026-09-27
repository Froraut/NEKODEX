import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { startServer } from "../src/server";
import { localApiKey, localApiStatePath, localApiStatus, setLocalApiAccess } from "../src/local-api-access";
import { parseChatCompletion } from "../src/chat-completions/contract";
import { NativeChatCompletionBridge } from "../src/chat-completions/native-bridge";

const key = `sk-local-${"a".repeat(64)}`;
const model = "chatgpt-web/gpt-5.6-sol";
const message = { model, messages: [{ role: "user", content: "Hello" }] };

test.serial("API credentials are private, revocable and do not authorize native/admin routes", async () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-api-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  let server: ReturnType<typeof startServer> | undefined;
  try {
    expect(localApiKey()).toBeUndefined();
    setLocalApiAccess(true);
    const first = localApiKey();
    expect(statSync(localApiStatePath()).mode & 0o077).toBe(0);
    setLocalApiAccess(true, true);
    expect(localApiKey()).not.toBe(first);
    setLocalApiAccess(false);
    expect(localApiKey()).toBeUndefined();
    expect(localApiStatus().enabled).toBe(false);
    let nativeRequests = 0;
    server = startServer({ ...defaultConfig(), port: 0 }, { apiKey: key,
      fetchUpstream: (async () => { nativeRequests++; throw new Error("Native transport must not be reached"); }) as any,
      chatCompletionExecutor: async () => ({ answer: "Hello" }) });
    const base = `http://127.0.0.1:${server.port}`;
    const call = (path: string, token: string, body?: unknown) => fetch(base + path, {
      method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const models = await call("/v1/models", key);
    expect(models.status).toBe(200);
    expect((await models.json() as any).data.every((row: any) => row.id.startsWith("chatgpt-web/"))).toBe(true);
    expect((await call("/v1/responses", key, { model: "gpt-6-sol", input: "no" })).status).toBe(403);
    expect((await call("/healthz", key)).status).toBe(403);
    expect((await call("/v1/responses", `sk-local-${"b".repeat(64)}`, { model: "gpt-6-sol", input: "no" })).status).toBe(401);
    const messagesRequest = { model, messages: [{ role: "user", content: "Hello" }], max_tokens: 100 };
    const count = await fetch(base + "/claude/v1/messages/count_tokens", { method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(messagesRequest) });
    expect(count.status).toBe(200);
    expect((await count.json() as any).input_tokens).toBeGreaterThan(0);
    expect((await fetch(base + "/claude/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } })).status).toBe(200);
    expect((await fetch(base + "/claude/v1/models", { headers: { "x-api-key": key, authorization: "Bearer conflicting" } })).status).toBe(401);
    expect((await fetch(base + "/healthz", { headers: { "x-api-key": key } })).status).toBe(403);
    expect((await fetch(base + "/v1/models", { headers: { "x-api-key": key, origin: "https://example.test" } })).status).toBe(403);
    expect(nativeRequests).toBe(0);
    const response = await call("/v1/chat/completions", key, message);
    expect(response.status).toBe(200);
    expect((await response.json() as any).choices[0]).toMatchObject({ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" });
  } finally {
    await server?.stop(true);
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("client function results remain bound to their original transcript and server-owned identity", async () => {
  const tools = [{ type: "function", function: { name: "echo", parameters: {
    type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false,
  } } }];
  const call = { id: "call_fixture_1", type: "function", function: { name: "echo", arguments: '{"text":"hi"}' } };
  let runs = 0;
  const bridge = new NativeChatCompletionBridge(async (request, _config, context) => {
    runs++;
    const body = await request.json() as any;
    expect(body.client_metadata).toBeUndefined();
    expect(JSON.stringify(body.input)).not.toContain("<environment_context>");
    expect(context.producer).toBe("api");
    expect(context.threadId).toStartWith("api_thread_");
    return Response.json({ status: "completed", end_turn: runs > 1,
      output: runs === 1 ? [{ type: "function_call", call_id: call.id, name: "echo", arguments: call.function.arguments }]
        : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] }] });
  });
  const initial = { ...message, tools };
  const first = await bridge.execute(parseChatCompletion(initial), defaultConfig("full"), new AbortController().signal, () => {});
  expect(first.result?.tool_calls).toEqual([call]);
  const continued = { ...initial, messages: [...initial.messages,
    { role: "assistant", content: null, tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: "hi" }] };
  await expect(bridge.execute(parseChatCompletion({ ...continued, messages: [{ role: "user", content: "changed" }, ...continued.messages.slice(1)] }),
    defaultConfig("full"), new AbortController().signal, () => {})).rejects.toThrow("conflict");
  expect(runs).toBe(1);
  const second = await bridge.execute(parseChatCompletion(continued), defaultConfig("full"), new AbortController().signal, () => {});
  expect(second.result?.content).toBe("Done");
  await expect(bridge.execute(parseChatCompletion(continued), defaultConfig("full"), new AbortController().signal, () => {})).rejects.toThrow("conflict");
  expect(runs).toBe(2);
});

test.serial("cancelling an API stream waits for its execution to settle", async () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-api-cancel-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  let settled = false;
  const server = startServer({ ...defaultConfig(), port: 0 }, { apiKey: key,
    chatCompletionExecutor: async (_input, _config, signal) => {
      try { await new Promise((_, reject) => {
        const abort = () => reject(new DOMException("cancelled", "AbortError"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      }); } finally { settled = true; }
      return { answer: "unreachable" };
    } });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, { method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ ...message, stream: true }) });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"role":"assistant"');
    await reader.cancel();
    const deadline = Date.now() + 1_000;
    while (!settled && Date.now() < deadline) await Bun.sleep(10);
    expect(settled).toBe(true);
  } finally {
    await server.stop(true);
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
