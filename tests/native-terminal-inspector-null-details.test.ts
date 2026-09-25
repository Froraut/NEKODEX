import { expect, test } from "bun:test";
import { createNativeTerminalInspector } from "../src/native-terminal-inspector";

function inspect(usage: unknown) {
  const inspector = createNativeTerminalInspector(false);
  inspector.push(new TextEncoder().encode(JSON.stringify({ status: "completed", model: "gpt-native", usage })));
  inspector.finish();
  return inspector.terminal;
}

test("null token details are treated as unreported instead of discarding reported totals", () => {
  const terminal = inspect({
    input_tokens: 10, output_tokens: 5, total_tokens: 15,
    input_tokens_details: { cached_tokens: null }, output_tokens_details: { reasoning_tokens: null },
  });
  expect(terminal?.outcome).toBe("completed");
  expect(terminal?.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test("reported token details remain attached", () => {
  const terminal = inspect({
    input_tokens: 10, output_tokens: 5, total_tokens: 15,
    input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 2 },
  });
  expect(terminal?.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 4, reasoningOutputTokens: 2 });
});
