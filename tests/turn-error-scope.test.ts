import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { throwIfChatGptTerminalErrorAlert } from "../src/adapters/chatgpt-web/browser-page-guards";
import { chatGptAssistantTurnSelector, chatGptTurnContainerSelector } from "../src/chatgpt-session";

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;

test("the turn container selector keeps the assistant selector unchanged", () => {
  const identity = "group:assistant:abc";
  expect(chatGptTurnContainerSelector(identity)).toBe('[data-turn-key="abc"]');
  expect(chatGptAssistantTurnSelector(identity))
    .toBe('[data-turn-key="abc"]:has([data-conversation-role="assistant"], [data-chatgpt-agent-turn-start])');
  expect(chatGptTurnContainerSelector("turn-1")).toBe('[data-turn-id="turn-1"]');
  expect(chatGptAssistantTurnSelector("turn-1")).toBe('[data-turn-id="turn-1"]');
});

test.skipIf(!executable)("an error that replaced the assistant part still ends the bound turn as retryable", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    // Captured shape (upstream 6.1.11): the retry control replaces the assistant message.
    await page.setContent(`<main><div data-turn-key="abc"><div data-user-message-bubble>Prompt</div>
      <div><button data-testid="regenerate-thread-error-button">Retry</button></div></div>
      <div data-turn-key="other"><div data-conversation-role="assistant">Unrelated answer</div></div></main>`);
    const identity = "group:assistant:abc";
    expect(await page.locator(chatGptAssistantTurnSelector(identity)).count()).toBe(0);
    const error = await throwIfChatGptTerminalErrorAlert(page.locator(chatGptTurnContainerSelector(identity)))
      .then(() => undefined, (failure: unknown) => failure as { code?: string; retryable?: boolean });
    expect(error?.code).toBe("upstream_server_error");
    expect(error?.retryable).toBe(true);
    // Another turn's error does not end this turn.
    await expect(throwIfChatGptTerminalErrorAlert(page.locator(chatGptTurnContainerSelector("group:assistant:other"))))
      .resolves.toBeUndefined();
  } finally { await browser.close(); }
});
