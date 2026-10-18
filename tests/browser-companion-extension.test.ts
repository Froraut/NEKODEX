import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBrowserCompanionRuntime } from "../src/browser-companion/runtime";
import { browserBindingOf } from "../src/browser-companion/protocol";

/** Actual MV3/activeTab boundary in one disposable official Playwright Chromium profile.
 * No production Chrome profile, account, user extension installation or model send. */
test("actual MV3 popup pairs, selects with activeTab, observes and types on inert local markup", async () => {
  const profile = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-companion-mv3-")));
  const extensionPath = resolve(import.meta.dir, "../browser-companion");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('<!doctype html><title>MV3 fixture</title><label>Name<input name="Name"></label><button>Save</button><output></output><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent="Saved";</script>', { headers: { "content-type": "text/html" } }) });
  const runtime = createBrowserCompanionRuntime();
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
      ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging"] });
    context.setDefaultTimeout(5000);
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/fixture`);
    const browserCdp = await context.browser()!.newBrowserCDPSession();
    const installed = await browserCdp.send("Extensions.loadUnpacked", { path: extensionPath });
    expect(installed.id).toMatch(/^[a-p]{32}$/);
    expect((await browserCdp.send("Extensions.getExtensions")).extensions.some(extension => extension.id === installed.id && extension.enabled && extension.path === extensionPath)).toBe(true);
    expect((await runtime.enable(installed.id)).enabled).toBe(true);
    const pairing = runtime.createPairing().pairing;
    // Playwright's supported popup-document fixture; the action invocation below supplies
    // the real activeTab grant. No Chrome API or host permission is mocked or broadened.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${installed.id}/popup.html`);
    await popup.locator("#pairing").fill(JSON.stringify(pairing));
    await popup.getByRole("button", { name: "Pair with local host", exact: true }).click();
    await popup.locator("#status").filter({ hasText: "Paired. Select this tab" }).waitFor({ timeout: 5000 });
    expect(runtime.status().companion?.paired).toBe(true);
    expect(await popup.locator("#pairing").inputValue()).toBe("");
    await page.bringToFront();
    // Reading before the qualifying action must fail, despite successful local pairing.
    await popup.evaluate(() => document.querySelector<HTMLButtonElement>("#select")!.click());
    await popup.waitForFunction(() => /ordinary web page|permission/.test(document.querySelector("#status")!.textContent!), undefined, { timeout: 5000 });
    expect(runtime.status().companion?.selected).toBeNull();
    // triggerAction requires the browser's tab target, not Playwright's child page target.
    const tabs = await browserCdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] });
    const targetInfo = tabs.targetInfos.find(target => target.url === page.url());
    if (!targetInfo) throw new Error("No exact fixture tab target is available for the extension action");
    await browserCdp.send("Extensions.triggerAction", { id: installed.id, targetId: targetInfo.targetId });
    await popup.evaluate(() => document.querySelector<HTMLButtonElement>("#select")!.click());
    await popup.locator("#status").filter({ hasText: "Sharing selected tab" }).waitFor({ timeout: 5000 });
    const provider = runtime.browserProvider()!;
    const initial = provider.current()!;
    expect(initial.kind).toBe("browser"); expect(initial.title).toBe("MV3 fixture");
    expect(initial.frameId).toBe(0); expect(initial.documentId.length).toBeGreaterThan(0);
    const typed = await provider.act(browserBindingOf(initial), { kind: "type", ref: initial.refs.find(ref => ref.role === "textbox")!.ref, text: "MV3 fixture name" }, AbortSignal.timeout(5000));
    expect(typed).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("input").inputValue()).toBe("MV3 fixture name");
    const fresh = await provider.observe(runtime.status().companion!.selected!, AbortSignal.timeout(5000));
    expect(fresh.outcome).toBe("completed"); expect(fresh.observation!.observationId).not.toBe(initial.observationId);
    const clicked = await provider.act(browserBindingOf(fresh.observation!), { kind: "click", ref: fresh.observation!.refs.find(ref => ref.role === "button")!.ref }, AbortSignal.timeout(5000));
    expect(clicked).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("output").textContent()).toBe("Saved");
    await popup.getByRole("button", { name: "Stop sharing", exact: true }).click();
    await popup.locator("#status").filter({ hasText: "Sharing stopped" }).waitFor({ timeout: 5000 });
    expect(runtime.status().companion?.paired).toBe(false);
  } finally {
    await runtime.close(); await context?.close(); server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
}, 25_000);
