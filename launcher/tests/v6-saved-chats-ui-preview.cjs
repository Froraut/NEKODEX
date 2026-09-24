// Focused renderer flow with inert IPC; no account or provider requests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { createFixtureServer } = require("./fixtures/ui-preview.cjs");
const copy = require("../src/i18n-en.json");

test("saved-chat switch waits for its receipt and preserves the saved state after failure", { timeout: 18000 }, async () => {
  const server = createFixtureServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(4000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/fixture-setup.js", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        window.fixtureSetState({useSavedChats:false,experimentalFreshConversationPerTurn:false});
        window.codexWebLauncher.setUseSavedChats = enabled => new Promise((resolve,reject) => {
          window.fixtureSettleSavedChats = success => {
            if (!success) { reject(new Error('Fixture save failed')); return; }
            window.fixtureSetState({useSavedChats:enabled});
            window.codexWebLauncher.snapshot().then(snapshot => resolve(snapshot.state));
          };
        });
      ` });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=benefits-astra`);
    await page.locator(".sidebar-item").filter({ hasText: copy.settings }).first().click();
    await page.locator(".settings-list").waitFor();
    const setting = page.getByRole("switch", { name: copy.savedChats, exact: true });
    const details = page.locator("details").filter({
      has: page.getByRole("switch", { name: copy.savedChats, exact: true, includeHidden: true }),
    });
    if (await details.count() && await details.getAttribute("open") === null) await details.locator("summary").click();
    assert.equal(await setting.getAttribute("aria-checked"), "false");
    await setting.click();
    await page.waitForFunction(() => typeof window.fixtureSettleSavedChats === "function");
    assert.equal(await setting.getAttribute("aria-checked"), "false");
    assert.equal(await setting.isDisabled(), true);
    await page.evaluate(() => window.fixtureSettleSavedChats(true));
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Save chats in ChatGPT"]')?.getAttribute("aria-checked") === "true");
    assert.equal((await page.evaluate(() => window.codexWebLauncher.snapshot())).state.experimentalFreshConversationPerTurn, false);
    await setting.click();
    await page.evaluate(() => window.fixtureSettleSavedChats(false));
    await page.getByText("Fixture save failed", { exact: false }).first().waitFor();
    assert.equal(await setting.getAttribute("aria-checked"), "true");
    assert.equal((await page.evaluate(() => window.codexWebLauncher.snapshot())).state.useSavedChats, true);
    assert.deepEqual(errors, []);
    const output = path.resolve(__dirname, "../output/playwright/v6");
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, "saved-chats-settings.png"), fullPage: true });
    await page.close();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
