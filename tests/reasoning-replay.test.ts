import { expect, test } from "bun:test";
import { parseRequest } from "../src/responses/parser";

const model = "chatgpt-web/gpt-5.6-sol-medium";
// Codex Desktop serializes absent optional reasoning fields as null on replay.
const replayedReasoning = {
  type: "reasoning", id: "rs_desktop",
  summary: [{ type: "summary_text", text: "ChatGPT is responding" }],
  content: null, encrypted_content: null,
};

test("desktop reasoning replay preserves the answer and following user turn", () => {
  const body = { model, input: [
    { role: "user", content: "Compute 17 * 19" },
    replayedReasoning,
    { role: "assistant", content: [{ type: "output_text", text: "323" }], phase: "final_answer" },
    { role: "user", content: "Add 1 to your previous answer" },
  ] };
  const parsed = parseRequest(body);
  expect(parsed.context.messages.map(message => message.role)).toEqual(["user", "assistant", "user"]);
  expect(parsed.context.messages[1]).toMatchObject({ phase: "final_answer", content: [
    { type: "thinking", thinking: "ChatGPT is responding" }, { type: "text", text: "323" },
  ] });
  expect(parsed.context.messages[2]).toMatchObject({ content: "Add 1 to your previous answer" });
  expect(parsed._rawBody).toEqual(body);
});

test("desktop reasoning replay keeps the local tool call and its result", () => {
  const parsed = parseRequest({ model, input: [
    { role: "user", content: "Read the proof file" },
    replayedReasoning,
    { type: "function_call", call_id: "call_read", name: "exec_command", arguments: '{"cmd":"cat proof.txt"}' },
    { type: "function_call_output", call_id: "call_read", output: "proof-7421" },
  ] });
  expect(parsed.context.messages[1]).toMatchObject({ role: "assistant", content: [
    { type: "thinking", thinking: "ChatGPT is responding" },
    { type: "toolCall", id: "call_read", name: "exec_command", arguments: { cmd: "cat proof.txt" } },
  ] });
  expect(parsed.context.messages[2]).toMatchObject({ role: "toolResult", toolCallId: "call_read", content: "proof-7421" });
});

test("null reasoning summary is absent but malformed populated fields remain invalid", () => {
  const parsed = parseRequest({ model, input: [
    { type: "reasoning", summary: null, content: null, encrypted_content: null },
    { role: "user", content: "Hello" },
  ] });
  expect(parsed.context.messages).toHaveLength(1);
  for (const invalid of [{ summary: "bad" }, { content: [{ type: "reasoning_text", text: 42 }] }, { encrypted_content: 42 }]) {
    expect(() => parseRequest({ model, input: [{ ...replayedReasoning, ...invalid }] })).toThrow("responses parse error");
  }
});
