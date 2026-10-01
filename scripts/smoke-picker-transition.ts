import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  activateChatGptEffortMenu, assertSelectedChatGptModelFamily,
  selectChatGptModelFamily, readChatGptEffortSnapshot,
  readChatGptEffortDescriptions, chatGptModelStateMatches,
} from "../src/chatgpt-session";

// Synthetic DOM only, in a fresh headless browser: no account/profile/network.
const original = await Bun.file(new URL("../tests/fixtures/english-model-picker.html", import.meta.url)).text();
function fixture(lazy: boolean, rejectSelection = false, selectionDelayMs = 0, missFirstSelection = false): string {
  return original
    .replace('<script>', '<script>(() => {').replace('</script>', '})();</script>')
    .replace("advanced ? Object.entries(rows)", `${lazy ? "advanced" : "true"} ? Object.entries(rows)`)
    .replace("for (const radio of document.querySelectorAll('[data-family'])) radio.setAttribute('aria-checked', String(radio.dataset.family === family));",
      "document.querySelector('#radios').hidden = !advanced; for (const radio of document.querySelectorAll('[data-family'])) radio.setAttribute('aria-checked', String(radio.dataset.family === family));")
    .replace("family = radio.dataset.family; value = 0;", "if (family !== radio.dataset.family) { family = radio.dataset.family; value = 0; }")
    .replace("family = radio.dataset.family;", rejectSelection ? "/* simulate a refused selection */"
      : selectionDelayMs > 0
        ? `window.selectionWasDeferred = true; const requestedFamily = radio.dataset.family; setTimeout(() => { family = requestedFamily; render(); }, ${selectionDelayMs});`
        : "family = radio.dataset.family;")
    .replace("setTimeout(() => { menu.hidden = true; control.setAttribute('aria-expanded', 'false'); }, 75);",
      "control.setAttribute('aria-expanded', 'false'); setTimeout(() => { menu.hidden = true; }, 250);")
    .replace("document.querySelector('#radios').onclick = event => { const radio = event.target.closest('[data-family]'); if (radio) {",
      missFirstSelection
        ? "window.rowSelectionFamilies = []; document.querySelector('#radios').onclick = event => { const radio = event.target.closest('[data-family]'); if (radio) { window.rowSelectionFamilies.push(radio.dataset.family); if (window.rowSelectionFamilies.length === 1) { view.dataset.modelPickerView = 'simple'; render(); return; }"
        : "document.querySelector('#radios').onclick = event => { const radio = event.target.closest('[data-family]'); if (radio) {");
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

  // A visible range in the model list is inert and cannot receive keys.
  // Re-selecting the verified same family returns to effort without changing it.
  await page.setContent(fixture(false).replace("document.querySelector('#power').style.display = advanced ? 'none' : 'block';",
    "document.querySelector('#power').style.display = 'block'; document.querySelector('#power').inert = advanced;"));
  activation = await activateChatGptEffortMenu(page, control);
  await activation.menu.locator('[data-model-picker-view-toggle]').click();
  assert.equal(await activation.sliderContainer.isVisible(), true);
  assert.equal(await page.locator('#power').evaluate(node => (node as HTMLElement).inert), true);
  activation = await selectChatGptModelFamily(page, control, activation, '6');
  assert.equal(await page.locator('#power').evaluate(node => (node as HTMLElement).inert), false);
  assert.equal((await readChatGptEffortSnapshot(activation.sliderContainer)).value, 2);
  await page.locator('#power').press('ArrowLeft');
  assert.equal((await readChatGptEffortSnapshot(activation.sliderContainer)).value, 1);
  assert.equal(await draft.innerText(), 'Draft to keep');
  console.log('RETURNED_FROM_INERT_MODEL_LIST_WITH_EFFORT_PRESERVED');

  // React can expose the effort view while the previously checked radio is
  // still current. The exact requested legacy row must settle before acceptance.
  await page.setContent(fixture(false, false, 500));
  activation = await activateChatGptEffortMenu(page, control);
  const deferredSelection = selectChatGptModelFamily(page, control, activation, '5.5');
  // Attach a rejection handler while observing the in-flight transition.
  void deferredSelection.catch(() => {});
  await page.waitForFunction(() => (window as any).selectionWasDeferred === true);
  assert.equal(await page.evaluate(() => (window as any).pickerState().family), 'latest');
  activation = await deferredSelection;
  assert.equal(await page.evaluate(() => (window as any).pickerState().family), '5.5');
  assert.equal(await activation.sliderContainer.isVisible(), true);
  assert.equal(await draft.innerText(), 'Draft to keep');
  console.log('WAITED_FOR_EXACT_DEFERRED_MODEL_SELECTION');

  await page.setContent(fixture(false, false, 0, true));
  activation = await activateChatGptEffortMenu(page, control);
  activation = await selectChatGptModelFamily(page, control, activation, '5.5');
  assert.deepEqual(await page.evaluate(() => (window as any).rowSelectionFamilies), ['5.5', '5.5']);
  assert.equal(await page.evaluate(() => (window as any).pickerState().family), '5.5');
  assert.equal(await draft.innerText(), 'Draft to keep');
  console.log('RETRIED_ONLY_THE_EXPLICIT_ROW_AFTER_A_MISSED_SELECTION');

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
