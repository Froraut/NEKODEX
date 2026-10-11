import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { responseDomSnapshot } from "../src/adapters/chatgpt-web/browser-response-dom";
import { ChatGptMarkdownBuffer } from "../src/adapters/chatgpt-web/markdown";

const markdownOf = (segments: Parameters<ChatGptMarkdownBuffer["observe"]>[0]) => {
  const buffer = new ChatGptMarkdownBuffer();
  buffer.observe(segments);
  return buffer.finish().markdown;
};

// Fixture captured by upstream (miuuyy/codex-chatgpt-web 8d53ff6d, #815).
const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
const html = readFileSync(new URL("./fixtures/chatgpt-codemirror-reply-2026-10-11.html", import.meta.url), "utf8");

test.skipIf(!executable)("a CodeMirror reply keeps its language, fence and line boundaries without toolbar text", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const snapshot = await responseDomSnapshot(page.locator("#turn"), {});
    expect(markdownOf(snapshot.markdownSegments)).toBe("# Probe\n\n- First item\n- Second item\n\n```python\nprint(1)\n```");
    await page.evaluate(() => {
      const editor = document.querySelector(".cm-content")!;
      editor.textContent = "";
      for (const text of ["def f():", "    return 1", ""]) {
        const line = document.createElement("div"); line.className = "cm-line"; line.textContent = text; editor.appendChild(line);
      }
      document.querySelector('[data-markdown-copy="exclude"]')!.textContent = "コード";
    });
    const edited = await responseDomSnapshot(page.locator("#turn"), {});
    const editedMarkdown = markdownOf(edited.markdownSegments);
    expect(editedMarkdown).toContain("```python\ndef f():\n    return 1\n");
    expect(editedMarkdown).not.toContain("コード");
  } finally { await browser.close(); }
});
