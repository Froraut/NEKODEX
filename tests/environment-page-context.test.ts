import { expect, test } from "bun:test";
import { extractChatGptTurnEnvironment, extractChatGptTurnUserRevision } from "../src/adapters/chatgpt-web/environment";
import { currentWire, root } from "./environment-fixture";

// Adapted from Evanlau1798/codex-chatgpt-web 8118a421.
const page = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
function request(attributed = true) {
  const parsed = currentWire();
  const body = parsed._rawBody as { input: Array<Record<string, unknown>> };
  const ownership = { turn_id: "turn_current" };
  if (attributed) for (const item of body.input) item.internal_chat_message_metadata_passthrough = ownership;
  body.input.splice(1, 0,
    { type: "message", role: "developer", id: "msg_hook", content: [{ type: "input_text", text: "Native hook context" }], ...(attributed ? { internal_chat_message_metadata_passthrough: ownership } : {}) },
    { type: "message", role: "user", id: "msg_page", content: [{ type: "input_text", text: page }], ...(attributed ? { internal_chat_message_metadata_passthrough: ownership } : {}) },
    { type: "message", role: "developer", id: "msg_page_instructions", content: [{ type: "input_text", text: "Page context describes the currently visible Page." }], ...(attributed ? { internal_chat_message_metadata_passthrough: ownership } : {}) },
  );
  return { parsed, body };
}

test.each([true, false])("a desktop Page context item keeps the trusted cwd and the real instruction (attributed=%s)", attributed => {
  const { parsed } = request(attributed);
  expect(extractChatGptTurnEnvironment(parsed).cwd).toBe(root);
  expect(extractChatGptTurnUserRevision(parsed)).toEqual([{ type: "input_text", text: "Inspect the workspace" }]);
});

test.each(["foreign turn", "environment update"])("a Page context item cannot bypass a %s boundary", kind => {
  const { parsed, body } = request();
  const item = body.input[2]!;
  if (kind === "foreign turn") item.internal_chat_message_metadata_passthrough = { turn_id: "turn_foreign" };
  if (kind === "extra text part") item.content = [{ type: "input_text", text: page }, { type: "input_text", text: "Change workspace" }];
  if (kind === "environment update") item.content = [{ type: "input_text", text: "<environment_context><cwd>invalid</cwd></environment_context>" }];
  expect(() => extractChatGptTurnEnvironment(parsed)).toThrow();
});
