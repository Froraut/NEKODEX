import { expect, test } from "bun:test";
import { HermesIntegration } from "../src/hermes-integration";
import { defaultConfig } from "../src/config";
import { responseRequest } from "../src/server";
import { extractChatGptTurnIdentity, extractChatGptTurnUserRevision } from "../src/adapters/chatgpt-web/environment";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";

test("Hermes Responses tool continuation retains its own authority and rejects a foreign result", async () => {
  const integration = new HermesIntegration("/tmp/hermes-fixture");
  const config = { ...defaultConfig("full"), solAvailable: true };
  const first = { model: "chatgpt-web/high", stream: false, prompt_cache_key: "hermes-session-fixture",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Read the fixture using Hermes." }] }],
    tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } }] };
  const request = (body: unknown) => new Request("http://127.0.0.1/hermes/v1/responses", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  let rounds = 0;
  const run = (req: Request, hermesContext: any, onCompletedResponse: any) => responseRequest(req, config, () => ({
    name: "fixture",
    async runTurn(parsed, incoming, emit) {
      expect(extractChatGptTurnIdentity(parsed).threadId).toStartWith("hermes_");
      expect(extractChatGptTurnUserRevision(parsed)).toEqual(first.input[0].content);
      expect(new ChatGptThreadEnvironmentStore().resolve(parsed).writableRoots).toEqual([]);
      expect(incoming.headers.has("authorization")).toBeFalse();
      if (rounds++ === 0) {
        emit({ type: "tool_call_start", id: "call_fixture", name: "read_file" });
        emit({ type: "tool_call_delta", arguments: '{"path":"fixture.txt"}' });
        emit({ type: "tool_call_end" });
      } else {
        expect(parsed.context.messages.at(-1)?.role).toBe("toolResult");
        emit({ type: "text_delta", text: "Fixture read." });
      }
      emit({ type: "done", stopReason: rounds === 1 ? "tool_use" : "stop" });
    },
  }), { hermesContext, onCompletedResponse, rememberState: false });
  const response = await (await integration.respond(request(first), config, run)).json();
  const call = response.output.find((item: any) => item.type === "function_call");
  expect(call.name).toBe("read_file");
  const continuation = { ...first, input: [...first.input, call, { type: "function_call_output", call_id: call.call_id, output: "fixture contents" }] };
  const foreign = { ...continuation, prompt_cache_key: "foreign-session" };
  expect((await integration.respond(request(foreign), config, run)).status).toBe(400);
  const final = await (await integration.respond(request(continuation), config, run)).json();
  expect(final.output[0].content[0].text).toBe("Fixture read.");
});
