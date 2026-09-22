import { expect, test } from "bun:test";
import { zstdCompressSync } from "node:zlib";
import { defaultConfig } from "../src/config";
import { compactRequest } from "../src/server";
import { createInternalJsonRequest, readJsonRequestBody } from "../src/http-body";
import { extractChatGptTurnIdentity } from "../src/adapters/chatgpt-web/environment";
import { SUMMARY_PREFIX } from "../src/responses/compaction";

for (const encoding of ["identity", "zstd"]) test(`Web compaction rebuilds ${encoding} bytes and preserves header authority`, async () => {
  const metadata = { thread_id: `thread_${encoding}`, turn_id: `turn_${encoding}` };
  const json = JSON.stringify({ model: "chatgpt-web/high", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Inspect project" }], internal_chat_message_metadata_passthrough: { turn_id: metadata.turn_id } }] });
  const bytes = encoding === "zstd" ? zstdCompressSync(json) : Buffer.from(json);
  let calls = 0;
  const response = await compactRequest(new Request("http://127.0.0.1/v1/responses/compact", {
    method: "POST", body: bytes, headers: {
      "content-type": "application/json", "content-encoding": encoding,
      "content-length": String(bytes.length), "x-codex-turn-metadata": JSON.stringify(metadata),
    },
  }), defaultConfig("browser-only"), () => ({
    name: "compact-wire-fixture",
    async runTurn(parsed, _incoming, emit) {
      calls++;
      expect(parsed._compactionRequest).toBe(true);
      expect(extractChatGptTurnIdentity(parsed)).toMatchObject({ threadId: metadata.thread_id, turnId: metadata.turn_id });
      emit({ type: "text_delta", text: "Verified compact summary", phase: "final_answer" });
      emit({ type: "done", stopReason: "stop", endTurn: true });
    },
  }));
  expect(response.status).toBe(200);
  expect(calls).toBe(1);
  expect(await response.json()).toMatchObject({ output: [
    { role: "user", content: [{ text: "Inspect project" }] },
    { role: "user", content: [{ text: `${SUMMARY_PREFIX}\nVerified compact summary` }] },
  ] });
}, 5000);

test("native compaction preserves compressed bytes and encoding", async () => {
  const bytes = zstdCompressSync(JSON.stringify({ model: "gpt-5.4", input: [] }));
  let calls = 0;
  const response = await compactRequest(new Request("http://127.0.0.1/v1/responses/compact", {
    method: "POST", body: bytes, headers: {
      authorization: "Bearer fixture", "content-type": "application/json", "content-encoding": "zstd",
      "content-length": String(bytes.length),
    },
  }), defaultConfig("browser-only"), () => { throw new Error("Web must not run"); }, {
    fetchUpstream: async request => {
      calls++;
      expect(request.headers.get("content-encoding")).toBe("zstd");
      expect(Buffer.from(await request.arrayBuffer())).toEqual(bytes);
      return Response.json({ output: [] });
    },
  });
  expect(response.status).toBe(200);
  expect(calls).toBe(1);
  await response.text();
}, 5000);

test("internal JSON replacement discards wire headers and retains cancellation", async () => {
  const abort = new AbortController();
  const source = new Request("http://127.0.0.1/compact", { method: "POST", body: "old", signal: abort.signal,
    headers: { "content-encoding": "zstd", "content-length": "3", authorization: "Bearer fixture" } });
  const internal = createInternalJsonRequest(source, "http://127.0.0.1/responses", { input: [] });
  expect(internal.headers.get("content-length")).toBeNull();
  expect(internal.headers.get("content-encoding")).toBeNull();
  expect(internal.headers.get("authorization")).toBe("Bearer fixture");
  expect(await readJsonRequestBody(internal)).toEqual({ input: [] });
  abort.abort(new Error("fixture abort"));
  expect(internal.signal.aborted).toBe(true);
}, 5000);
