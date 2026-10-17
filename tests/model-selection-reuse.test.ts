import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { ChatGptModelSelectionController } from "../src/adapters/chatgpt-web/browser-model-selection";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("retained selection avoids reopening the picker while pre-send validation remains live", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    const fixture = readFileSync(join(import.meta.dir, "fixtures/french-model-picker.html"), "utf8")
      .replace("control.onclick=()=>{", "window.pickerOpens=0;control.onclick=()=>{window.pickerOpens++;");
    await page.setContent(fixture);
    const controller = new ChatGptModelSelectionController({
      activeComposer: async () => page.locator("#prompt-textarea"),
      settleChatGptUi: async () => {},
      withChatGptBrowserObservationTimeout: async operation => operation,
      chatGptRateLimitDialog: () => page.locator("#missing-rate-limit"),
      chatGptExpiredSessionAlert: () => page.locator("#missing-expiry"),
      throwIfChatGptRateLimitDialog: async () => {},
      throwIfChatGptSessionFailureAlert: async () => {},
      throwIfChatGptSubmissionDialog: async () => {},
      throwIfChatGptEffortCapabilityDialog: async () => {},
    });
    const mode = { modelId: "chatgpt-web", modelVersion: "5.6" as const, effort: "low" as const,
      displayLabel: "Instant" as const, uiEffortIndex: 0 as const, thinkEnabled: false, localTools: true };
    await controller.select(page, mode);
    const opens = await page.evaluate(() => (window as any).pickerOpens);
    await controller.select(page, mode);
    expect(await page.evaluate(() => (window as any).pickerOpens)).toBe(opens);
    await controller.verifyBeforeSend(page, page.locator("#prompt-textarea"), mode);
    expect(await page.evaluate(() => (window as any).pickerOpens)).toBeGreaterThan(opens);
    // A different visible selection invalidates the cached observation before Send.
    await page.locator("form button").evaluate(button => { button.textContent = "Different model"; });
    await expect(controller.verifyBeforeSend(page, page.locator("#prompt-textarea"), mode)).rejects.toThrow();
  } finally { await browser.close(); }
}, 15_000);
