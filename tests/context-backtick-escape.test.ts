import { expect, test } from "bun:test";
import { withoutRetiredTurnHandles } from "../src/adapters/chatgpt-web/prompt-context-envelope";

test("serialized context carries no raw backticks and decodes to the same history", () => {
  const original = JSON.stringify({ version: 3, system: "use ```ts blocks```", messages: [
    { role: "user", content: [{ type: "input_text", text: "```a``` ".repeat(12) + "\\` literal" }] },
  ] });
  const encoded = withoutRetiredTurnHandles(original);
  expect(encoded).not.toContain("`");
  expect(JSON.parse(encoded)).toEqual(JSON.parse(original));
});
