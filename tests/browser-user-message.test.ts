import { expect, test } from "bun:test";
import { chromium, type Locator } from "playwright-core";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { responseDomSnapshot } from "../src/adapters/chatgpt-web/browser-response-dom";
import { chatGptHtmlToMarkdown } from "../src/adapters/chatgpt-web/markdown";

const launch = () => chromium.launch({ headless: true,
  ...(process.env.CHATGPT_DOM_TEST_BROWSER ? { executablePath: process.env.CHATGPT_DOM_TEST_BROWSER } : {}) });
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const matcher = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
  config: { appName: "Codex Native2" },
}) as { userMessageMatchesSubmission(group: Locator, text: string, signal?: AbortSignal, token?: string): Promise<boolean> };

test("collapsed rich-text submission expands and matches only its prepared token", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const token = `turn_${"a".repeat(32)}`;
    const submitted = `Original full context\n${token}`;
    await page.setContent(`<section id="turn"><div data-user-message-bubble>
      <div data-search-result-target id="message">middle of collapsed context</div>
      <button type="button" aria-expanded="false" data-thread-find-skip="true" data-markdown-copy="exclude">Show more</button>
      </div></section>`);
    await page.locator("button").evaluate((button, text) => button.addEventListener("click", () => {
      button.setAttribute("aria-expanded", "true");
      document.querySelector("#message")!.textContent = `Rich-text presentation changed. ${text}`;
    }), token);
    expect(await matcher.userMessageMatchesSubmission(page.locator("#turn"), submitted, undefined, token)).toBeTrue();
    expect(await page.locator("button").getAttribute("aria-expanded")).toBe("true");
    await page.locator("#message").evaluate((node, foreign) => { node.textContent = foreign; }, `turn_${"b".repeat(32)}`);
    expect(await matcher.userMessageMatchesSubmission(page.locator("#turn"), submitted, undefined, token)).toBeFalse();
    await page.locator("#message").evaluate((node, repeated) => { node.textContent = `${repeated} ${repeated}`; }, token);
    expect(await matcher.userMessageMatchesSubmission(page.locator("#turn"), submitted, undefined, token)).toBeFalse();
  } finally { await browser.close(); }
});

test("browser-only submission ignores its leading connector and nested link target without losing code", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const submitted = "Explain this\n```ts\nlet n = 1;\n```";
    await page.setContent(`<section id="turn"><div data-user-message-bubble><div data-search-result-target><a><span data-prompt-link-href="app://codex" data-search-result-target>Codex Native2</span></a><div data-markdown-text-tone="user-message" class="rich-text-user-turn"><p>Explain this</p><div data-markdown-copy="blank-lines"><pre data-markdown-copy="code-block"><code data-markdown-copy-content="true" data-language="ts">let n = 1;</code></pre></div></div></div></div></section>`);
    expect(await matcher.userMessageMatchesSubmission(page.locator("#turn"), submitted)).toBeTrue();
    expect(await matcher.userMessageMatchesSubmission(page.locator("#turn"), `${submitted}\nDo something else`)).toBeFalse();
  } finally { await browser.close(); }
});

test("suggestion sizing-label hydration cannot contaminate an answer or its fingerprint", async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<section id="turn"><div class="markdown"><p>The report is complete.</p>
      <p><span aria-hidden="true">Unrelated answer content.</span> <a href="https://example.com/source">Source</a></p>
      <div><div><button class="group/suggested-followup">Clarify the result</button></div>
      <div aria-hidden="true" class="pointer-events-none"><span id="sizing">Clarify the result</span></div></div>
      <pre><code class="language-html">${escapeHtml('<button class="group/suggested-followup">example</button>')}</code></pre>
      </div></section>`);
    const first = await responseDomSnapshot(page.locator("#turn"), {});
    expect(first.visibleText).toContain("The report is complete.");
    expect(first.visibleText).toContain("Unrelated answer content.");
    expect(first.visibleText).not.toContain("Clarify the result");
    expect(first.fullHtml).toContain("example");
    const markdown = chatGptHtmlToMarkdown(first.fullHtml);
    expect(markdown).toContain("[Source](https://example.com/source)");
    expect(markdown).toContain("```html");
    expect(markdown).toContain('<button class="group/suggested-followup">example</button>');
    await page.locator("#sizing").evaluate(node => { node.textContent = "New unrelated suggestion"; });
    const second = await responseDomSnapshot(page.locator("#turn"), {});
    expect(second.visibleText).toBe(first.visibleText);
    expect(second.fullHtml).toBe(first.fullHtml);
  } finally { await browser.close(); }
});
