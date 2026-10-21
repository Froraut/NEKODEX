import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { chatGptMessageTooLongAlert, isChatGptMessageTooLongAlertText } from "../src/adapters/chatgpt-web/browser-page-guards";

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;

test("recognizes ChatGPT's visible size rejection text only", () => {
  expect(isChatGptMessageTooLongAlertText("The message you submitted was too long, please edit it and resubmit.")).toBe(true);
  expect(isChatGptMessageTooLongAlertText("The message  you submitted\nwas too long")).toBe(true);
  expect(isChatGptMessageTooLongAlertText("Something went wrong. Please try again.")).toBe(false);
  expect(isChatGptMessageTooLongAlertText("Your session has expired. Please log in again.")).toBe(false);
});

test.skipIf(!executable)("the visible too-long alert becomes a non-retryable context-length error", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<aside role="alert">The message you submitted was too long, please edit it and resubmit.</aside>');
    const error = await chatGptMessageTooLongAlert(page);
    expect(error?.code).toBe("context_length_exceeded");
    expect(error?.status).toBe(400);
    expect(error?.retryable).toBe(false);
    await page.setContent('<aside role="alert">Something went wrong.</aside><p>The message you submitted was too long</p>');
    expect(await chatGptMessageTooLongAlert(page)).toBeUndefined();
  } finally { await browser.close(); }
});
