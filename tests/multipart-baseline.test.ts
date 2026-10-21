import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { formatChatGptWebMultipartStage } from "../src/adapters/chatgpt-web/prompt-multipart-contract";

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const group = (key: string, text: string | undefined, answer: string, complete = true) =>
  `<div data-turn-key="${key}">${text === undefined ? "" : `<div data-user-message-bubble><div data-search-result-target style="white-space:pre-wrap">${escape(text)}</div></div>`}
    <div data-content-search-unit-key="${key}:assistant"><div data-conversation-role="assistant"></div><div data-markdown-text-style="assistant-message"><p>${escape(answer)}</p></div></div>
    ${complete ? '<div class="turn-action-controls"><button>Copy</button></div>' : ""}</div>`;

test.skipIf(!executable)("a previously acknowledged but unmounted stage cannot acknowledge the next Send when it returns", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const stage = formatChatGptWebMultipartStage('{"context":"Earlier context"}', `ctx_${"f".repeat(32)}`, 1, 6);
    await page.setContent("<main></main>");
    const baseline = await worker.captureSubmissionBaseline(page, "Next context part");
    // As the multipart loop does after the earlier stage was acknowledged.
    baseline.historicalTurnIdentities = ["group:assistant:earlier", "group:user:earlier"];
    baseline.acknowledgedStages = [stage.acknowledgement];
    await page.locator("main").evaluate((node, html) => { node.innerHTML = html; }, group("earlier", stage.text, stage.acknowledgement));
    expect(await worker.currentSubmissionEvidence(page, baseline)).toBeUndefined();
    expect(baseline.acceptedUserIdentity).toBeUndefined();
    await page.locator("main").evaluate((node, html) => { node.insertAdjacentHTML("beforeend", html); }, group("next", "Next context part", "", false));
    expect(await worker.currentSubmissionEvidence(page, baseline)).toBe("user_turn");
    expect(baseline.acceptedUserIdentity).toBe("group:user:next");
  } finally { await browser.close(); }
});

test.skipIf(!executable)("a stage matched only by its acknowledgement text also excludes its user message", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
    const stage = formatChatGptWebMultipartStage('{"context":"Earlier context"}', `ctx_${"e".repeat(32)}`, 1, 6);
    await page.setContent("<main></main>");
    const baseline = await worker.captureSubmissionBaseline(page, "Next context part");
    baseline.acknowledgedStages = [stage.acknowledgement];
    await page.locator("main").evaluate((node, html) => { node.innerHTML = html; }, group("earlier", stage.text, stage.acknowledgement));
    expect(await worker.currentSubmissionEvidence(page, baseline)).toBeUndefined();
  } finally { await browser.close(); }
});
