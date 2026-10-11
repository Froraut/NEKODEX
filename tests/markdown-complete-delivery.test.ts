import { expect, test } from "bun:test";
import { ChatGptMarkdownBuffer } from "../src/adapters/chatgpt-web/markdown";

const segment = (key: string, text: string) => ({ key, tag: "p", html: `<p>${text}</p>`, text, streamable: true, linkTargets: [] });

test("a compaction summary is delivered once, after ChatGPT finishes revising it", () => {
  const buffer = new ChatGptMarkdownBuffer("complete");
  expect(buffer.observe([segment("0:p", "Draft"), segment("1:p", "more")])).toBe("");
  // A revised, reordered draft is not a consistency error because nothing was delivered yet.
  expect(buffer.observe([segment("1:p", "Final summary"), segment("0:p", "Second")])).toBe("");
  expect(buffer.finish().markdown).toContain("Final summary");
});
