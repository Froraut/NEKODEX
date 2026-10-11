import { expect, test } from "bun:test";
import { ChatGptTextFeed, ChatGptTraceFeed } from "../src/adapters/chatgpt-web/turn-feeds";

test("text and trace feeds notify progress observers until they unsubscribe", () => {
  const text = new ChatGptTextFeed();
  const trace = new ChatGptTraceFeed();
  let calls = 0;
  const stops = [text.observeProgress(() => { calls++; }), trace.observeProgress(() => { calls++; })];
  text.push("a");
  trace.push({ kind: "reasoning", text: "thinking" } as never);
  text.push("");
  expect(calls).toBe(2);
  for (const stop of stops) stop();
  text.push("b");
  expect(calls).toBe(2);
});
