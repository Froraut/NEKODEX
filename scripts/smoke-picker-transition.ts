import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  activateChatGptEffortMenu, assertSelectedChatGptModelFamily,
  selectChatGptModelFamily, readChatGptEffortSnapshot,
  readChatGptEffortDescriptions, chatGptModelStateMatches,
} from "../src/chatgpt-session";

// Synthetic DOM only, in a fresh headless browser: no account/profile/network.
const original = await Bun.file(new URL("../tests/fixtures/english-model-picker.html", import.meta.url)).text();
function fixture(lazy: boolean, rejectSelection = false): string {
  return original
    .replace('<script>', '<script>(() => {').replace('</script>', '})();</script>')
    .replace("advanced ? Object.entries(rows)", `${lazy ? "advanced" : "true"} ? Object.entries(rows)`)
    .replace("for (const radio of document.querySelectorAll('[data-family'])) radio.setAttribute('aria-checked', String(radio.dataset.family === family));",
      "document.querySelector('#radios').hidden = !advanced; for (const radio of document.querySelectorAll('[data-family'])) radio.setAttribute('aria-checked', String(radio.dataset.family === family));")
    .replace("family = radio.dataset.family;", rejectSelection ? "/* simulate a refused selection */" : "family = radio.dataset.family;")
    .replace("setTimeout(() => { menu.hidden = true; control.setAttribute('aria-expanded', 'false'); }, 75);",
      "control.setAttribute('aria-expanded', 'false'); setTimeout(() => { menu.hidden = true; }, 250);");
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(2_000);
  await page.route("**/*", route => route.abort());
  const control = page.locator('button[aria-controls="picker"]');
  const draft = page.locator('#prompt-textarea');

  // Establish the fault boundary: Escape marks the owner closed immediately,
  // while its delayed cleanup can still hide a newly reopened effort surface.
  await page.setContent(fixture(false));
  let activation = await activateChatGptEffortMenu(page, control);
  await activation.menu.locator('[data-model-picker-view-toggle]').click();
  await activation.menu.getByRole('menuitemradio', { name: 'GPT-5.6 Sol', exact: true }).click();
  assert.equal(await activation.sliderContainer.isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await control.getAttribute('aria-expanded'), 'false');
  activation = await activateChatGptEffortMenu(page, control);
  assert.equal(await activation.sliderContainer.isVisible(), true);
  await activation.menu.waitFor({ state: 'hidden', timeout: 2_000 });
  assert.equal(await activation.sliderContainer.isVisible(), false);
  console.log('REPRODUCED_OUTGOING_ESCAPE_CLEANUP');

  for (const lazy of [false, true]) {
    await page.setContent(fixture(lazy));
    activation = await activateChatGptEffortMenu(page, control);
    activation = await selectChatGptModelFamily(page, control, activation, '5.6');
    await page.locator('#power').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    activation = await assertSelectedChatGptModelFamily(page, control, activation, '5.6');
    assert.equal(await activation.sliderContainer.isVisible(), true);
    assert.equal((await readChatGptEffortSnapshot(activation.sliderContainer)).value, 2);
    assert.equal(chatGptModelStateMatches(await readChatGptEffortDescriptions(page, activation.slider), '5.6', false, 'high'), true);
    assert.equal(await draft.innerText(), 'Draft to keep');
    const cancelled = AbortSignal.abort(new Error('fixture cancelled'));
    await assert.rejects(selectChatGptModelFamily(page, control, activation, '5.5', cancelled), /fixture cancelled/);
    await assert.rejects(assertSelectedChatGptModelFamily(page, control, activation, '5.6', cancelled), /fixture cancelled/);
    assert.equal(await draft.innerText(), 'Draft to keep');
    console.log(`PRESERVED_FAMILY_EFFORT_DRAFT_${lazy ? 'LAZY' : 'HIDDEN'}_ROWS`);
  }
  await page.setContent(fixture(false, true));
  activation = await activateChatGptEffortMenu(page, control);
  await assert.rejects(selectChatGptModelFamily(page, control, activation, '5.6'), /did not retain model family 5.6/);
  assert.equal(await draft.innerText(), 'Draft to keep');
  console.log('REJECTED_UNCHECKED_FAMILY_AND_CANCELLED_SELECTION; PICKER_TRANSITION_SMOKE_OK');
} finally {
  await browser.close();
}
