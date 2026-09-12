import { expect, test } from "bun:test";
import {
  CHATGPT_COMPACTION_PROMPT_JSON_BYTE_BUDGET,
  chatGptPromptJsonBytes,
  compileChatGptWebPrompt,
} from "../src/adapters/chatgpt-web/prompt";
import { SUMMARY_PREFIX } from "../src/responses/compaction";
import type { CodexMessage, CodexParsedRequest } from "../src/types";

const readOnlyPro = { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true };

function request(messages: CodexMessage[]): CodexParsedRequest {
  return {
    modelId: "gpt-5.6-sol",
    context: { systemPrompt: [], messages },
    stream: true,
    options: { reasoning: "max" },
    _compactionRequest: true,
  };
}

function checkpoint(text = "earlier-verified-progress", newline = "\n\n"): string {
  return `${SUMMARY_PREFIX}${newline}${text}: ${"s".repeat(20_000)}`;
}

const bulkyOutput = (): CodexMessage => ({
  role: "toolResult", toolCallId: "old", toolName: "read", isError: false,
  content: `old-bulky-output-${"x".repeat(100_000)}`, timestamp: 2,
});
const finalInstruction = (): CodexMessage => ({ role: "user", content: "checkpoint-now", timestamp: 4 });

function messagesOf(text: string): Array<Record<string, unknown>> {
  const envelope = text.match(/<codex_context_json>\n(.+)\n<\/codex_context_json>/s)?.[1];
  return JSON.parse(envelope!).messages;
}

for (const newline of ["\n", "\n\n"]) {
  for (const asParts of [false, true]) {
    test(`inline fallback preserves the cumulative checkpoint (${newline.length} newline, ${asParts ? "parts" : "string"})`, () => {
      const summary = checkpoint("earlier-verified-progress", newline);
      const compiled = compileChatGptWebPrompt(request([
        { role: "user", content: asParts ? [{ type: "text", text: summary }] : summary, timestamp: 1 },
        bulkyOutput(),
        { role: "assistant", content: [{ type: "text", text: "recent-verified-progress" }], timestamp: 3 },
        finalInstruction(),
      ]), readOnlyPro);

      expect(compiled.text).toContain("earlier-verified-progress");
      expect(compiled.text).toContain("recent-verified-progress");
      expect(compiled.text).not.toContain("old-bulky-output-");
      expect(compiled.trimmedCompactionMessages).toBe(1);
      expect(compiled.text).toContain("1 older history item(s) omitted");
      expect(compiled.text).toContain("the supplied history is incomplete");
      expect(compiled.text).not.toContain("The task context is complete.");
      expect(messagesOf(compiled.text).at(-1)).toEqual({ role: "user", content: "checkpoint-now" });
      expect(chatGptPromptJsonBytes(compiled.text)).toBeLessThanOrEqual(CHATGPT_COMPACTION_PROMPT_JSON_BYTE_BUDGET);
    });
  }
}

test("inline fallback rejects an oversized required checkpoint instead of silently dropping it", () => {
  const compact = request([
    { role: "user", content: `${SUMMARY_PREFIX}\n${"s".repeat(120_000)}`, timestamp: 1 },
    finalInstruction(),
  ]);
  expect(() => compileChatGptWebPrompt(compact, readOnlyPro))
    .toThrow("cumulative checkpoint and final compaction instruction");
});

test("inline fallback keeps the newest checkpoint and original retained order", () => {
  const newest = checkpoint("newest-checkpoint");
  const compiled = compileChatGptWebPrompt(request([
    { role: "user", content: `${SUMMARY_PREFIX}\nsuperseded-checkpoint`, timestamp: 0 },
    { role: "user", content: newest, timestamp: 1 },
    bulkyOutput(),
    { role: "assistant", content: [{ type: "text", text: "latest-evidence" }], timestamp: 3 },
    finalInstruction(),
  ]), readOnlyPro);

  expect(messagesOf(compiled.text)).toEqual([
    { role: "user", content: newest },
    { role: "assistant", content: [{ type: "text", text: "latest-evidence" }] },
    { role: "user", content: "checkpoint-now" },
  ]);
  expect(compiled.trimmedCompactionMessages).toBe(2);
});

test("checkpoint-preserving trimming rebuilds image references for only the retained messages", () => {
  const oldImage = "data:image/png;base64,b2xkLWltYWdl";
  const recentImage = "data:image/png;base64,bmV3LWltYWdl";
  const compiled = compileChatGptWebPrompt(request([
    { role: "user", content: checkpoint(), timestamp: 1 },
    { role: "user", content: [{ type: "text", text: "x".repeat(100_000) }, { type: "image", imageUrl: oldImage }], timestamp: 2 },
    { role: "user", content: [{ type: "text", text: "recent-image" }, { type: "image", imageUrl: recentImage }], timestamp: 3 },
    finalInstruction(),
  ]), readOnlyPro);

  expect(compiled.text).toContain("earlier-verified-progress");
  expect(compiled.images).toEqual([{ ref: "codex-input-image-1", imageUrl: recentImage }]);
  expect(compiled.text).toContain("codex-input-image-1");
  expect(compiled.text).not.toContain("codex-input-image-2");
  expect(compiled.trimmedCompactionMessages).toBe(1);
});

test("a retained checkpoint still scrubs retired capability handles", () => {
  const retiredToken = `turn_${"a".repeat(32)}`;
  const compiled = compileChatGptWebPrompt(request([
    { role: "user", content: checkpoint(`earlier-verified-progress ${retiredToken}`), timestamp: 1 },
    bulkyOutput(), finalInstruction(),
  ]), readOnlyPro);

  expect(compiled.text).toContain("earlier-verified-progress");
  expect(compiled.text).toContain("[retired turn handle]");
  expect(compiled.text).not.toContain(retiredToken);
});

test("Manual mode compaction preserves its checkpoint without enabling work tools or browser automation", () => {
  const compact = request([
    { role: "user", content: checkpoint(), timestamp: 1 },
    bulkyOutput(), finalInstruction(),
  ]);
  compact.modelId = "chatgpt-web-zero-risk";
  compact.options.reasoning = "low";
  const compiled = compileChatGptWebPrompt(compact,
    { localToolsEnabled: true, solAvailable: false, proAvailable: false },
    `request_${"b".repeat(32)}`, { manualControl: true });

  expect(compiled.text).toContain("earlier-verified-progress");
  expect(compiled.text).toContain("Do not call work tools or ChatGPT-native tools.");
  expect(compiled.text).toContain("Produce the requested checkpoint summary now without calling work tools.");
  expect(compiled.text).toContain("<codex_zero_risk_request_json>");
  expect(compiled.text).not.toContain("turn_token");
  expect(compiled.multipart).toBeUndefined();
});
