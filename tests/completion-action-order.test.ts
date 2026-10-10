import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { responseDomSnapshot } from "../src/adapters/chatgpt-web/browser-response-dom";

// Adapted from Evanlau1798/codex-chatgpt-web 1b13266c and 20f6b3d1.
const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
const turn = (footerFirst: boolean) => '<section id="turn" data-turn-key="current">'
  + (footerFirst ? '<div class="turn-action-controls"><button>Copy</button></div>' : "")
  + '<div data-content-search-unit-key="final"><h4 data-conversation-role="assistant"></h4>'
  + '<div class="markdown"><p>Review complete.</p></div></div>'
  + (footerFirst ? "" : '<div class="turn-action-controls"><button>Copy</button></div>')
  + "</section>";

test.skipIf(!executable)("completion controls rendered before the final Markdown count once generation stopped", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(turn(true) + '<form data-chatgpt-composer><button type="button" data-testid="stop-button">Stop</button></form>');
    const cache = {};
    expect((await responseDomSnapshot(page.locator("#turn"), cache)).completionActionVisible).toBe(false);
    await page.evaluate(() => document.querySelector('[data-testid="stop-button"]')!.remove());
    // Stop sits outside the observed subtree; its removal alone must refresh the cached decision.
    const stopped = await responseDomSnapshot(page.locator("#turn"), cache);
    expect(stopped.visibleText).toBe("Review complete.");
    expect(stopped.completionActionVisible).toBe(true);
  } finally { await browser.close(); }
});

test.skipIf(!executable)("a user content unit's footer is never completion evidence", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<section id="turn" data-turn-key="current">'
      + '<div data-content-search-unit-key="user"><div data-user-message-bubble>hi</div><div class="turn-action-controls"><button>Copy</button></div></div>'
      + '<div data-content-search-unit-key="final"><h4 data-conversation-role="assistant"></h4><div class="markdown"><p>Partial</p></div></div></section>');
    expect((await responseDomSnapshot(page.locator("#turn"), {})).completionActionVisible).toBe(false);
  } finally { await browser.close(); }
});
