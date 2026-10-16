import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { resolveChatGptToolConfirmation } from "../src/adapters/chatgpt-web/browser-page-guards";

const executable = process.env.CHATGPT_DOM_TEST_BROWSER;
// The current card ignores Enter on its buttons; only a click resolves it.
const card = (id: string) => `<div data-codex-approval-surface="true" id="${id}"><p>Allow ChatGPT to use Codex Native6?</p>`
  + `<button type="button" onkeydown="event.preventDefault()" onclick="this.parentElement.remove();window.allowed=(window.allowed||0)+1">Allow once</button>`
  + `<button type="button" onclick="window.alwaysAllowed=(window.alwaysAllowed||0)+1">Always allow</button>`
  + `<button type="button" onclick="this.parentElement.remove();window.denied=(window.denied||0)+1">Deny</button></div>`;

test.skipIf(!executable)("auto-approve clicks the one-time Allow of a unique card and waits until it is gone", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(card("a"));
    expect(await resolveChatGptToolConfirmation(page, "Codex Native6", true)).toBe(true);
    expect(await page.evaluate(() => (window as any).allowed)).toBe(1);
    expect(await page.locator("#a").count()).toBe(0);
    await page.setContent(card("a") + card("b"));
    await expect(resolveChatGptToolConfirmation(page, "Codex Native6", true)).rejects.toThrow(/multiple approvals/);
    await page.setContent("<p>no card</p>");
    expect(await resolveChatGptToolConfirmation(page, "Codex Native6", true)).toBe(false);
  } finally { await browser.close(); }
});

test.skipIf(!executable)("manual approval remains pending past the former deadline and resolves only after the user allows", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  const realNow = Date.now;
  try {
    const page = await browser.newPage();
    await page.setContent(card("manual"));
    let visible = 0;
    let heartbeats = 0;
    let settled = false;
    let onVisible!: () => void;
    const entered = new Promise<void>(resolve => { onVisible = resolve; });
    const waiting = resolveChatGptToolConfirmation(
      page, "Codex Native6", false, undefined,
      async () => { visible += 1; onVisible(); },
      () => { heartbeats += 1; },
    ).finally(() => { settled = true; });
    // Let the handler enter its wait, then advance beyond its old 60-second
    // denial deadline without making this focused regression take a minute.
    await entered;
    await new Promise(resolve => setTimeout(resolve, 25));
    Date.now = () => realNow() + 60_001;
    await new Promise(resolve => setTimeout(resolve, 250));
    Date.now = realNow;
    expect(settled).toBe(false);
    expect(visible).toBe(1);
    expect(heartbeats).toBeGreaterThan(1);
    expect(await page.locator("#manual").count()).toBe(1);
    expect(await page.evaluate(() => ({ allowed: (window as any).allowed || 0, denied: (window as any).denied || 0 })))
      .toEqual({ allowed: 0, denied: 0 });
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    expect(await waiting).toBe(true);
    expect(await page.evaluate(() => (window as any).allowed)).toBe(1);
  } finally {
    Date.now = realNow;
    await browser.close();
  }
});

test.skipIf(!executable)("cancelling manual approval leaves all decision buttons untouched", async () => {
  const browser = await chromium.launch({ executablePath: executable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(card("cancel"));
    const controller = new AbortController();
    let onVisible!: () => void;
    const entered = new Promise<void>(resolve => { onVisible = resolve; });
    const waiting = resolveChatGptToolConfirmation(
      page, "Codex Native6", false, controller.signal,
      undefined, () => { onVisible(); },
    );
    await entered;
    controller.abort();
    await expect(waiting).rejects.toThrow(/aborted/);
    expect(await page.locator("#cancel").count()).toBe(1);
    expect(await page.evaluate(() => ({
      allowed: (window as any).allowed || 0,
      denied: (window as any).denied || 0,
      alwaysAllowed: (window as any).alwaysAllowed || 0,
    }))).toEqual({ allowed: 0, denied: 0, alwaysAllowed: 0 });
  } finally { await browser.close(); }
});
