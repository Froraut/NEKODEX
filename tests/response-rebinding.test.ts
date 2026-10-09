import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { responseDomSnapshot } from "../src/adapters/chatgpt-web/browser-response-dom";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { chatGptAssistantTurnSelector } from "../src/chatgpt-session";

test("a detached reasoning renderer rebinds to its unique completed answer", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const oldIdentity = "group:assistant:thinking";
    await page.setContent('<div data-turn-key="thinking"><div data-chatgpt-agent-turn-start></div></div>');
    const binding = { identity: oldIdentity, locator: page.locator(chatGptAssistantTurnSelector(oldIdentity)),
      acceptedTurnIdentities: ["group:user:thinking", oldIdentity] };
    expect((await responseDomSnapshot(binding.locator)).responsePresent).toBe(true);
    await page.setContent('<div data-turn-id-container="answer"><article data-testid="conversation-turn-1" data-turn="assistant" data-turn-id="answer"><div class="markdown">667</div><button data-testid="copy-turn-action-button">Copy</button></article></div>');
    expect((await responseDomSnapshot(binding.locator)).responsePresent).toBe(false);
    const rebound = await (ChatGptBrowserWorker.prototype as any).reconcileAssistantTurnBinding(page,
      { initialTurnIdentities: [], domCache: {} }, binding);
    expect(rebound.identity).toBe("answer");
    const result = await responseDomSnapshot(rebound.locator);
    expect(result.visibleText).toBe("667");
    expect(result.completionActionVisible).toBe(true);
  } finally { await browser.close(); }
});

test("rebinding does not adopt an answer after an unrelated new user turn", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div data-turn-id-container="other-user"><article data-testid="conversation-turn-0" data-turn="user" data-turn-id="other-user"></article></div><div data-turn-id-container="other-answer"><article data-testid="conversation-turn-1" data-turn="assistant" data-turn-id="other-answer"><div class="markdown">wrong answer</div></article></div>');
    const identity = "group:assistant:thinking";
    const binding = { identity, locator: page.locator(chatGptAssistantTurnSelector(identity)), acceptedTurnIdentities: ["group:user:thinking", identity] };
    await expect((ChatGptBrowserWorker.prototype as any).reconcileAssistantTurnBinding(page,
      { initialTurnIdentities: [], domCache: {} }, binding)).rejects.toThrow("another user turn");
  } finally { await browser.close(); }
});

test("evaluation errors on present nodes are not converted to missing responses", async () => {
  const locator = { count: async () => 1, evaluate: async () => { throw new Error("renderer evaluation fault"); },
    page: () => ({ isClosed: () => false }) };
  await expect(responseDomSnapshot(locator as any)).rejects.toThrow("renderer evaluation fault");
});
