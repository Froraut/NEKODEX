import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { resolveChatGptToolConfirmation } from "../src/adapters/chatgpt-web/browser-page-guards";

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
// The current card ignores Enter on its buttons; only a click resolves it.
const card = (id: string) => `<div data-codex-approval-surface="true" id="${id}"><p>Allow ChatGPT to use Codex Native6?</p>`
  + `<button type="button" onkeydown="event.preventDefault()" onclick="this.parentElement.remove();window.allowed=(window.allowed||0)+1">Allow once</button>`
  + `<button type="button">Always allow</button><button type="button" onclick="this.parentElement.remove()">Deny</button></div>`;

test.skipIf(!executable)("auto-approve clicks the one-time Allow of a unique card and waits until it is gone", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(card("a"));
    expect(await resolveChatGptToolConfirmation(page, "Codex Native6", true)).toBe(true);
    expect(await page.evaluate(() => (window as any).allowed)).toBe(1);
    expect(await page.locator("#a").count()).toBe(0);
    await page.setContent(card("a") + card("b"));
    await expect(resolveChatGptToolConfirmation(page, "Codex Native6", true)).rejects.toThrow(/multiple approvals/);
    await page.setContent("<p>no card</p>");
    expect(await resolveChatGptToolConfirmation(page, "Codex Native6", true)).toBe(false);
  } finally { await browser.close(); }
});
