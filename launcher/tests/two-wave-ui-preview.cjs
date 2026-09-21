const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { createFixtureServer } = require("./fixtures/ui-preview.cjs");

const output = path.resolve(__dirname, "../output/playwright/wave2-ui");
fs.mkdirSync(output, { recursive: true });

let server;
let browser;
let base;

test.before(async () => {
  server = createFixtureServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

async function open(scenario, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?scenario=${scenario}`);
  await page.locator(".app-shell").waitFor();
  return { page, errors };
}

const sidebar = (page, label) => page.locator(".sidebar-item", { hasText: label }).first();

test("compact drawer traps focus, closes safely, and desktop remains non-modal", async () => {
  const { page, errors } = await open("embedded", { width: 760, height: 820 });
  const toggle = page.locator('button[aria-controls="app-sidebar"]');
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  const drawer = page.locator("#app-sidebar");
  assert.equal(await drawer.getAttribute("role"), "dialog");
  assert.equal(await drawer.getAttribute("aria-modal"), "true");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-current")), "page");
  const focusables = drawer.locator('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])');
  const count = await focusables.count();
  await focusables.nth(count - 1).focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#app-sidebar button:not(:disabled)')), true);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
  await page.screenshot({ path: path.join(output, "compact-overview.png"), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(50);
  assert.equal(await drawer.getAttribute("role"), null);
  assert.equal(await drawer.getAttribute("aria-modal"), null);
  assert.equal(await page.locator(".workspace").evaluate(node => node.inert), false);
  await page.screenshot({ path: path.join(output, "desktop-overview.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});

test("tab selector uses roving arrows, Tab reaches its sibling action, and close preserves a valid tab", async () => {
  const { page, errors } = await open("embedded");
  await sidebar(page, "Browser").click();
  const tabs = page.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(20);
  assert.match(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""), /Fixture tab/);
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Tab");
  assert.match(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""), /Close tab: Fixture tab/);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(20);
  assert.equal(await page.getByRole("tab").count(), 1);
  assert.equal(await page.getByRole("tab").first().getAttribute("aria-selected"), "true");
  assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => ["tab", "close-tab"].includes(call[0]))),
    [["tab", "fixture-help"], ["close-tab", "fixture-help"]]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("automatic setup Next reveals and focuses sign-in choices without IPC", async () => {
  const { page, errors } = await open("setup-fresh");
  await sidebar(page, "Connections").click();
  await page.locator(".setup-next .button-primary").click();
  assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ""), /sign in|Chrome/i);
  assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => ["passkey", "existing-chrome-retry", "onboarding"].includes(call[0]))), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("Overview sends manual missing-tools setup to tools and preserves automatic optional-tools workspace", async () => {
  const manual = await open("manual-tools");
  await sidebar(manual.page, "Overview").click();
  const manualCta = manual.page.locator(".workspace-intro .button-primary");
  assert.match(await manualCta.innerText(), /tools/i);
  await manualCta.click();
  assert.match(await manual.page.locator('.sidebar-item[aria-current="page"]').innerText(), /Connections/);
  assert.deepEqual(manual.errors, []);
  await manual.page.close();

  const automatic = await open("models-ready");
  const automaticCta = automatic.page.locator(".workspace-intro .button-primary");
  assert.match(await automaticCta.innerText(), /workspace/i);
  await automaticCta.click();
  await automatic.page.locator(".browser-surface").waitFor();
  assert.deepEqual(automatic.errors, []);
  await automatic.page.close();
});

test("accounts explain disabled actions and recover an inline quota failure", async () => {
  const { page, errors } = await open("accounts-failed");
  await sidebar(page, "Accounts").click();
  const alert = page.getByRole("alert", { name: "" }).filter({ hasText: /allowance|quota/i }).first();
  await alert.waitFor();
  assert.doesNotMatch(await page.locator(".account-card").first().innerText(), /Not checked/i);
  const secondary = page.locator(".account-card").nth(1);
  const select = secondary.getByRole("button", { name: "Select" });
  assert.equal(await select.isDisabled(), true);
  const describedBy = await select.getAttribute("aria-describedby");
  assert.ok(describedBy);
  assert.match(await secondary.locator(`#${describedBy}`).innerText(), /connection|setup|pending/i);
  await page.locator(".account-card").first().getByRole("button", { name: "Refresh" }).click();
  await page.waitForTimeout(30);
  assert.equal(await page.locator(".account-card").first().getByRole("alert").count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test("updater retains Installing after a too-late cancellation warning", async () => {
  const { page, errors } = await open("update-active");
  await sidebar(page, "Updates").click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("heading", { name: /Restarting to finish the update/ }).waitFor();
  assert.match(await page.getByRole("alert").innerText(), /too late|already/i);
  await page.screenshot({ path: path.join(output, "updates-installing-warning.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();

  const missing = await open("update-missing-speed");
  await sidebar(missing.page, "Updates").click();
  assert.equal(await missing.page.locator(".updates-speed").innerText(), "—");
  assert.deepEqual(missing.errors, []);
  await missing.page.close();
});

test("passkey terminal error stays generic and route diagnostics recover from a redirect", async () => {
  const passkey = await open("passkey-failed");
  await sidebar(passkey.page, "Browser").click();
  const guide = passkey.page.locator(".browser-login-guide");
  await guide.getByRole("alert").waitFor();
  assert.doesNotMatch(await guide.innerText(), /passkey-verification-failed|Users\//);
  assert.equal(await guide.getByRole("button", { name: /Retry/i }).count(), 1);
  assert.equal(await guide.getByRole("button", { name: /Reveal|Cancel/i }).count(), 0);
  assert.deepEqual(passkey.errors, []);
  await passkey.page.close();

  const diagnostic = await open("diagnostics-redirect");
  await sidebar(diagnostic.page, "Connections").click();
  await diagnostic.page.locator(".setup-troubleshooting > summary").click();
  const check = diagnostic.page.locator(".route-diagnostics .diagnostic-row");
  await check.click();
  await diagnostic.page.locator(".route-diagnostics-summary").waitFor();
  assert.match(await diagnostic.page.locator(".route-diagnostics-result").innerText(), /302/);
  await check.click();
  await diagnostic.page.waitForTimeout(30);
  assert.equal(await diagnostic.page.locator(".route-diagnostics-summary").count(), 0);
  assert.match(await diagnostic.page.locator(".route-diagnostics-result").innerText(), /Observed|observed/);
  assert.deepEqual(diagnostic.errors, []);
  await diagnostic.page.close();
});

test("normal Activity and Settings navigation remains usable", async () => {
  const { page, errors } = await open("models-ready");
  await sidebar(page, "Activity").click();
  await page.locator(".usage-dashboard").waitFor();
  assert.match(await page.locator('.sidebar-item[aria-current="page"]').innerText(), /Activity/);
  await sidebar(page, "Settings").click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.match(await page.locator('.sidebar-item[aria-current="page"]').innerText(), /Settings/);
  assert.deepEqual(errors, []);
  await page.close();
});
