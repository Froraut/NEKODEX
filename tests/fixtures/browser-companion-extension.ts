import { chromium } from "playwright-core";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBrowserCompanionRuntime } from "../../src/browser-companion/runtime";

/** Inert stand-in for an exact HTTPS site, served only through this disposable context's routes. */
export interface CompanionFixtureSite { url: string; routes: Record<string, { body: string; contentType: string }> }

/** Real MV3 fixture, serial use only: owns fixed loopback 17843 and an inert disposable profile. */
export async function startBrowserCompanionExtensionFixture(site?: CompanionFixtureSite) {
  const profile = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-companion-mv3-")));
  const extensionPath = resolve(import.meta.dir, "../../browser-companion");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('<!doctype html><title>MV3 fixture</title><label>Name<input name="Name"></label><button>Save</button><output></output><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent="Saved";</script>', { headers: { "content-type": "text/html" } }) });
  const runtime = createBrowserCompanionRuntime();
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    try { await runtime.close(); }
    finally { try { await context?.close(); } finally { server.stop(true); rmSync(profile, { recursive: true, force: true }); } }
  }
  try {
    // Optional local seam for a machine whose cached Playwright Chromium build differs.
    const executablePath = process.env.NEKODEX_COMPANION_TEST_CHROMIUM;
    context = await chromium.launchPersistentContext(profile, { ...(executablePath ? { executablePath } : { channel: "chromium" }), headless: true,
      ignoreDefaultArgs: ["--disable-extensions"], args: ["--enable-unsafe-extension-debugging"] });
    context.setDefaultTimeout(5000);
    if (site) {
      // No network: every request to the stand-in origin is answered locally or refused.
      const origin = new URL(site.url).origin;
      await context.route(`${origin}/**`, route => {
        const response = site.routes[new URL(route.request().url()).pathname];
        return response ? route.fulfill({ status: 200, contentType: response.contentType, body: response.body }) : route.fulfill({ status: 404, body: "" });
      });
    }
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(site?.url ?? `http://127.0.0.1:${server.port}/fixture`);
    const browserCdp = await context.browser()!.newBrowserCDPSession();
    const installed = await browserCdp.send("Extensions.loadUnpacked", { path: extensionPath });
    if (!/^[a-p]{32}$/.test(installed.id)) throw new Error("Invalid extension fixture identity");
    const extensionEnabled = (await browserCdp.send("Extensions.getExtensions")).extensions.some(extension => extension.id === installed.id && extension.enabled && extension.path === extensionPath);
    if (!extensionEnabled) throw new Error("Exact fixture extension did not load");
    if (!(await runtime.enable(installed.id)).enabled) throw new Error("Owned fixture listener could not start");
    const pairing = runtime.createPairing().pairing;
    // Playwright's supported popup-document fixture; the action invocation below supplies
    // the real activeTab grant. No Chrome API or host permission is mocked or broadened.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${installed.id}/popup.html`);
    await popup.locator("#pairing").fill(JSON.stringify(pairing));
    await popup.getByRole("button", { name: "Pair with local host", exact: true }).click();
    await popup.locator("#status").filter({ hasText: "Paired. Select this tab" }).waitFor({ timeout: 5000 });
    if (!runtime.status().companion?.paired) throw new Error("Pairing did not settle");
    if (await popup.locator("#pairing").inputValue() !== "") throw new Error("Private pairing offer was not cleared");
    await page.bringToFront();
    // Reading before the qualifying action must fail, despite successful local pairing.
    await popup.evaluate(() => document.querySelector<HTMLButtonElement>("#select")!.click());
    await popup.waitForFunction(() => /ordinary web page|permission/.test(document.querySelector("#status")!.textContent!), undefined, { timeout: 5000 });
    const ungrantedReadRefused = runtime.status().companion?.selected === null;
    if (!ungrantedReadRefused) throw new Error("Pairing unexpectedly granted page reads");
    // triggerAction requires the browser's tab target, not Playwright's child page target.
    const tabs = await browserCdp.send("Target.getTargets", { filter: [{ type: "tab", exclude: false }, { exclude: true }] });
    const targetInfo = tabs.targetInfos.find(target => target.url === page.url());
    if (!targetInfo) throw new Error("No exact fixture tab target is available for the extension action");
    await browserCdp.send("Extensions.triggerAction", { id: installed.id, targetId: targetInfo.targetId });
    await popup.evaluate(() => document.querySelector<HTMLButtonElement>("#select")!.click());
    await popup.locator("#status").filter({ hasText: "Sharing selected tab" }).waitFor({ timeout: 5000 });
    const provider = runtime.browserProvider();
    if (!provider?.current()) throw new Error("Selected fixture document observation is missing");
    return { runtime, page, popup, provider, extensionId: installed.id, extensionEnabled, ungrantedReadRefused, close,
      async stopSharing() {
        await popup.getByRole("button", { name: "Stop sharing", exact: true }).click();
        await popup.locator("#status").filter({ hasText: "Sharing stopped" }).waitFor();
      } };
  } catch (error) { await close(); throw error; }
}
