import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { responseRequest } from "../src/server";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";

// A Codex Web turn whose launcher admission proved the account cannot run it.
function turnBody() {
  const thread = crypto.randomUUID(), turn = crypto.randomUUID();
  const meta = { turn_id: turn };
  const env = "<environment_context>\n  <cwd>/tmp</cwd>\n  <filesystem><workspace_roots><root>/tmp</root></workspace_roots>"
    + "<permission_profile type=\"disabled\"><file_system type=\"unrestricted\" /></permission_profile></filesystem>\n"
    + "  <codex_dev_mode>All outer tool effects are explicitly simulated.</codex_dev_mode>\n</environment_context>";
  return JSON.stringify({ model: "chatgpt-web/gpt-5.6-sol-instant", stream: true, store: false, prompt_cache_key: thread,
    client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: thread, turn_id: turn, request_kind: "turn", sandbox: "none", workspaces: { "/tmp": {} } }) },
    instructions: "Reply briefly.", tools: [], tool_choice: "auto", parallel_tool_calls: true, reasoning: { summary: "auto" },
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: env }], internal_chat_message_metadata_passthrough: meta },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Say just: pong" }], internal_chat_message_metadata_passthrough: meta }] });
}

test("Codex's automatic replay of an unready-account turn ends with HTTP 400; a later attempt reaches the launcher again", async () => {
  const body = turnBody();
  let attempts = 0;
  const adapterFactory = () => ({ runTurn: async () => {
    attempts += 1;
    throw new ChatGptWebAdapterError("No request was sent: cause", { status: 409, errorType: "invalid_request_error", code: "account_not_ready", retryable: false });
  } });
  const send = async () => {
    const response = await responseRequest(new Request("http://127.0.0.1/v1/responses", { method: "POST", body,
      headers: { "content-type": "application/json", authorization: "Bearer test" } }), defaultConfig(), adapterFactory as never);
    return { status: response.status, text: await response.text() };
  };
  const first = await send();
  expect(first.status).toBe(200);
  expect(first.text).toContain("\"code\":\"account_not_ready\"");
  const replay = await send();
  expect(replay.status).toBe(400);
  expect(JSON.parse(replay.text).error.message).toBe("No request was sent: cause");
  expect(attempts).toBe(1);
  await send();
  expect(attempts).toBe(2);
});
