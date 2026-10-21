import { chromium } from "playwright-core";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBrowserCompanionRuntime } from "../../src/browser-companion/runtime";
import { CHROME_COMPANION_ID } from "../../src/browser-companion/firefox-identity";

/**
 * Loading an unpacked MV3 extension needs Playwright's full Chromium build; the
 * headless shell used by the other DOM tests cannot. Local machines without it skip
 * with this reason. CI installs it and never skips, so a missing build fails loudly.
 */
export const companionChromiumMissing: string | undefined = (() => {
  if (process.env.CI) return undefined;
  const executablePath = process.env.NEKODEX_COMPANION_TEST_CHROMIUM || chromium.executablePath();
  if (existsSync(executablePath)) return undefined;
  const reason = `MV3 companion browser test skipped: Chromium is missing at ${executablePath}. Run \`bun x --no-install playwright-core install chromium\` or set NEKODEX_COMPANION_TEST_CHROMIUM.`;
  console.warn(reason);
  return reason;
})();

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
    // The manifest key, not the load path, fixes the ID the application pins.
    if (installed.id !== CHROME_COMPANION_ID) throw new Error("The unpacked extension did not load with its pinned key-derived ID");
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
    const popupUrl = `chrome-extension://${installed.id}/popup.html`;
    const popupTargets = async () => (await browserCdp.send("Target.getTargets")).targetInfos.filter(target => target.type === "page" && target.url === popupUrl).map(target => target.targetId);
    const ownedPopups = new Set(await popupTargets());
    await browserCdp.send("Extensions.triggerAction", { id: installed.id, targetId: targetInfo.targetId });
    // The action also opens the real toolbar popup: a second popup.html Playwright does not own.
    // Its startup probe shares storage.session and can run late on a slow machine, then forget a
    // pairing a test revoked later. Chrome granted activeTab with the action; close that popup.
    let actionPopup: string | undefined;
    for (const deadline = Date.now() + 5000; !actionPopup && Date.now() < deadline; await Bun.sleep(25)) actionPopup = (await popupTargets()).find(id => !ownedPopups.has(id));
    if (!actionPopup) throw new Error("The extension action did not open its toolbar popup");
    await browserCdp.send("Target.closeTarget", { targetId: actionPopup });
    for (const deadline = Date.now() + 5000; (await popupTargets()).includes(actionPopup); await Bun.sleep(25)) if (Date.now() > deadline) throw new Error("The toolbar popup did not close");
    await popup.evaluate(() => document.querySelector<HTMLButtonElement>("#select")!.click());
    await popup.locator("#status").filter({ hasText: "Sharing selected tab" }).waitFor({ timeout: 5000 });
    // tabs.create resolves before the session document runs: return only once it holds the poll.
    const sessionUrl = `chrome-extension://${installed.id}/session.html`;
    let session = context.pages().find(opened => opened.url().startsWith(sessionUrl));
    for (const deadline = Date.now() + 5000; !session || !runtime.status().companion?.connected; await Bun.sleep(25)) {
      if (Date.now() > deadline) throw new Error("The selected tab session did not start polling");
      session ??= context.pages().find(opened => opened.url().startsWith(sessionUrl));
    }
    const provider = runtime.browserProvider();
    if (!provider?.current()) throw new Error("Selected fixture document observation is missing");
    return { runtime, page, popup, session: session!, provider, extensionId: installed.id, extensionEnabled, ungrantedReadRefused, close,
      async stopSharing() {
        await popup.getByRole("button", { name: "Stop sharing", exact: true }).click();
        await popup.locator("#status").filter({ hasText: "Sharing stopped" }).waitFor();
      } };
  } catch (error) { await close(); throw error; }
}
