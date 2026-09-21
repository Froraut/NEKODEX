// Focused visual/interaction runner for the four 2026-09-21 major benefits.
// Build the renderer before running. This uses only the credential-free loopback fixture.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const { createFixtureServer } = require("./fixtures/ui-preview.cjs");

const output = path.resolve(__dirname, "../output/playwright/major-benefits-ui");
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

async function open(scenario, viewport = { width: 1280, height: 900 }, language = "en") {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/?scenario=${scenario}&language=${language}`);
  await page.locator(".app-shell").waitFor();
  return { page, errors };
}

const sidebar = (page, label) => page.locator(".sidebar-item", { hasText: label }).first();
async function navigateSidebar(page, label) {
  const toggle = page.locator('button[aria-controls="app-sidebar"]');
  if (await toggle.count() && await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await sidebar(page, label).click();
}

test("unavailable authentication retains identity and retry restores verified state", async () => {
  const { page, errors } = await open("benefits-auth-unavailable", { width: 760, height: 900 });
  await navigateSidebar(page, "Accounts");
  const unavailable = page.locator(".account-card", { hasText: "retained@example.test" });
  await unavailable.waitFor();
  assert.match(await unavailable.innerText(), /unavailable|could not verify|last verified/i);
  assert.equal(await unavailable.getByRole("button", { name: /Select/i }).isDisabled(), true);
  await unavailable.getByRole("button", { name: /Retry/i }).click();
  assert.equal(await unavailable.getByRole("button", { name: /Retry/i }).count(), 0);
  assert.match(await unavailable.innerText(), /Replace credentials/i);
  assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === "account-auth-refresh")),
    [["account-auth-refresh", "fixture-tertiary"]]);
  await page.screenshot({ path: path.join(output, "auth-retry-compact.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await page.close();
});

test("portfolio refresh preserves fresh and retained quota evidence with partial summary", async () => {
  const { page, errors } = await open("benefits-portfolio-mixed");
  await navigateSidebar(page, "Accounts");
  await page.getByRole("button", { name: /^Refresh account limits$/i }).click();
  const summary = page.locator(".quota-portfolio-summary");
  await summary.waitFor();
  assert.match(await summary.innerText(), /Current 1|Current evidence: 1/i);
  assert.match(await summary.innerText(), /Earlier 1|retained: 1/i);
  assert.match(await summary.innerText(), /1.*unavailable|unavailable.*1/i);
  const cards = page.locator(".account-card");
  assert.match(await cards.nth(0).innerText(), /current|90%/i);
  assert.match(await cards.nth(1).innerText(), /last known|55%/i);
  assert.match(await cards.nth(2).innerText(), /unavailable/i);
  await page.screenshot({ path: path.join(output, "quota-portfolio-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 760, height: 900 });
  await summary.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: path.join(output, "quota-portfolio-compact.png") });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Activity insights distinguish sufficient evidence from insufficient coverage", async () => {
  const { page, errors } = await open("benefits-insights");
  await navigateSidebar(page, "Activity");
  const insights = page.locator(".usage-diagnostic-insights");
  await insights.waitFor();
  assert.match(await insights.innerText(), /24|22|83/i);
  await page.locator('[aria-controls="usage-diagnostic-details"]').click();
  const details = page.locator("#usage-diagnostic-details");
  await details.waitFor();
  assert.equal(await details.locator(".usage-diagnostic-table").count(), 1);
  assert.equal(await details.locator(".is-insufficient").count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: path.join(output, "activity-evidence-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 760, height: 900 });
  await details.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: path.join(output, "activity-evidence-compact.png") });
  assert.deepEqual(errors, []);
  await page.close();
});

test("readiness repairs only degraded Web routing and keeps native work available", async () => {
  const success = await open("benefits-repair-success", { width: 760, height: 900 });
  assert.equal(await success.page.locator(".overview-live-runs button").count(), 0);
  await success.page.locator(".workspace-intro .button-primary").click();
  const repair = success.page.locator('[data-testid="web-route-repair"]');
  await repair.waitFor();
  await repair.getByRole("button", { name: /Repair|Reconnect|Restore/i }).click();
  await navigateSidebar(success.page, "Overview");
  assert.match(await success.page.locator(".workspace-intro .button-primary").innerText(), /workspace|browser/i);
  assert.deepEqual(await success.page.evaluate(() => window.fixtureCalls.filter(call => call[0] === "repair-web-route")),
    [["repair-web-route"]]);
  await success.page.screenshot({ path: path.join(output, "readiness-repaired-compact.png"), fullPage: true });
  assert.deepEqual(success.errors, []);
  await success.page.close();

  const failure = await open("benefits-repair-failure");
  await failure.page.locator(".workspace-intro .button-primary").click();
  const failedRepair = failure.page.locator('[data-testid="web-route-repair"]');
  await failedRepair.getByRole("button", { name: /Repair|Reconnect|Restore/i }).click();
  assert.match(await failedRepair.innerText(), /unavailable|try again|could not|failed/i);
  assert.match(await failedRepair.innerText(), /native|Codex|local/i);
  await failure.page.screenshot({ path: path.join(output, "readiness-repair-failed-desktop.png"), fullPage: true });
  assert.deepEqual(failure.errors, []);
  await failure.page.close();

  const russian = await open("benefits-repair-failure", { width: 760, height: 900 }, "ru");
  await russian.page.locator(".workspace-intro .button-primary").click();
  await russian.page.locator('[data-testid="web-route-repair"]').waitFor();
  await russian.page.screenshot({ path: path.join(output, "readiness-repair-russian-compact.png"), fullPage: true });
  assert.deepEqual(russian.errors, []);
  await russian.page.close();
});
