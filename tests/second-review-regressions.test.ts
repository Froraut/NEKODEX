import { expect, test } from "bun:test";
import { forwardNativeCodexRequest } from "../src/native-passthrough";
import { parseRequest } from "../src/responses/parser";
import { ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";

test("second review: long native SSE line preserves split terminal detection", async () => {
  const prefix = 'data: {"text":"' + 'x'.repeat(131072) + '"}\r\n';
  const pieces = [prefix.slice(0, 50000), prefix.slice(50000), "data: [DO", "NE]\r", "\n\n"];
  const response = await forwardNativeCodexRequest(new Request("http://localhost/v1/responses", {
    method: "POST", headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ model: "gpt-5.6-sol", stream: true }),
  }), "responses", async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces.shift();
      if (piece === undefined) controller.error(Object.assign(new Error("fixture reset"), { code: "ECONNRESET" }));
      else controller.enqueue(new TextEncoder().encode(piece));
    },
  }), { headers: { "content-type": "text/event-stream" } }));
  expect(await response.text()).toBe(prefix + "data: [DONE]\r\n\n");
});

test("second review: known malformed message and system images are explicit errors", () => {
  expect(() => parseRequest({ model: "chatgpt-web/medium", input: [{ type: "message", role: "user", content: [{ type: "input_image" }] }] })).toThrow();
  expect(() => parseRequest({ model: "chatgpt-web/medium", input: [{ type: "message", role: "system", content: [{ type: "input_image", image_url: "https://example.test/image.png" }] }] })).toThrow();
  const normal = parseRequest({ model: "chatgpt-web/medium", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "normal text" }] }] });
  expect(normal.context.messages[0]?.content).toBe("normal text");
});

test("second review: failed retained release keeps ownership until retry acknowledgement", async () => {
  const registry = new ChatGptTurnSessions();
  let key: string | undefined = "conversation-fixture";
  let releases = 0;
  const session = {
    ownerKey: "owner-fixture", physicalSettlement: Promise.resolve(),
    conversationKey: () => key, isActive: () => false,
    detachConversation(expected: string) { if (key !== expected) return false; key = undefined; return true; },
    runtime: { releaseRetainedConversation: async () => { if (++releases === 1) throw new Error("fixture release unavailable"); } },
  };
  const internals = registry as unknown as { entries: Map<string, unknown>; conversationHeads: Map<string, unknown>; closeConversationAndWait(key: string): Promise<number> };
  internals.entries.set("execution-fixture", session);
  internals.conversationHeads.set(key!, session);
  await expect(internals.closeConversationAndWait(key!)).rejects.toThrow("fixture release unavailable");
  expect(key).toBe("conversation-fixture");
  expect(internals.entries.has("execution-fixture")).toBe(true);
  await registry.waitForConversationRetirement("conversation-fixture");
  expect(releases).toBe(2);
  expect(key).toBeUndefined();
  expect(internals.entries.has("execution-fixture")).toBe(false);
});
