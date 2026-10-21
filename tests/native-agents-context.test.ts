import { expect, test } from "bun:test";
import { contextualUserMessage } from "../src/adapters/chatgpt-web/environment";
import { extractCompactUserMessages } from "../src/responses/compaction";
import { isNativeAgentsMdContext } from "../src/responses/native-context";

const refresh = { type: "message", role: "user", id: "msg_agents_refresh",
  content: [{ type: "input_text", text: "# AGENTS.md instructions for /work/app\n<INSTRUCTIONS>Use repository rules.</INSTRUCTIONS>" }],
  internal_chat_message_metadata_passthrough: { turn_id: "turn_refresh", content_item_kinds: ["agents_md.instructions"] } };
const literal = { ...refresh, id: "msg_human_literal",
  internal_chat_message_metadata_passthrough: { turn_id: "turn_human", content_item_kinds: ["user.text"] } };
const mixed = { ...refresh, id: "msg_mixed",
  internal_chat_message_metadata_passthrough: { turn_id: "turn_mixed", content_item_kinds: ["agents_md.instructions", "user.text"] } };

test("v1 compaction drops native AGENTS refreshes but retains literal and mixed human instructions", () => {
  expect(extractCompactUserMessages([refresh, literal, mixed])).toEqual([literal, mixed]);
});

test("only an identified native AGENTS refresh is context; the same text typed by a person stays a task", () => {
  expect(isNativeAgentsMdContext(refresh)).toBe(true);
  expect(contextualUserMessage(refresh)).toBe(true);
  expect(contextualUserMessage(literal)).toBe(false);
  expect(contextualUserMessage(mixed)).toBe(false);
  for (const forged of [
    { ...refresh, id: "" },
    { ...refresh, role: "developer" },
    { ...refresh, internal_chat_message_metadata_passthrough: { content_item_kinds: ["agents_md.instructions"] } },
    { ...refresh, internal_chat_message_metadata_passthrough: { turn_id: " ", content_item_kinds: ["agents_md.instructions"] } },
    { ...refresh, internal_chat_message_metadata_passthrough: { turn_id: "turn_refresh", content_item_kinds: [] } },
  ]) expect(isNativeAgentsMdContext(forged)).toBe(false);
});
