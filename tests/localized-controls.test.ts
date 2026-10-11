import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { CHATGPT_STOP_BUTTON_SELECTOR, CHATGPT_THINK_BUTTON_ICON_SELECTOR } from "../src/chatgpt-session";

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
const stopIcon = "M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z";

test.skipIf(!executable)("Stop and Think are recognized by their icons in any UI language", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form data-chatgpt-composer>
      <button type="button" class="size-token-button-composer" aria-label="Остановить"><svg class="icon-primary-action"><path d="${stopIcon}"/></svg></button>
      <button type="button" class="__composer-pill" aria-pressed="false" aria-label="Думать"><span class="__composer-pill-icon"><svg viewBox="0 0 24 24"><path d="M14.8974 2.29998C15.8303 2.29013 16.802 2.58194 17.5566 3.22577 Z"/></svg></span>Думать</button>
      <button type="button" class="size-token-button-composer" aria-label="Голос"><svg class="icon-primary-action"><path d="M1 1"/></svg></button>
    </form>`);
    expect(await page.locator(CHATGPT_STOP_BUTTON_SELECTOR).count()).toBe(1);
    expect(await page.locator(CHATGPT_STOP_BUTTON_SELECTOR).getAttribute("aria-label")).toBe("Остановить");
    expect(await page.locator(CHATGPT_THINK_BUTTON_ICON_SELECTOR).count()).toBe(1);
  } finally { await browser.close(); }
});
