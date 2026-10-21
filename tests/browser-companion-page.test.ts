import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
// Bundled isolated-world function is exercised on inert local markup, not a real account/tab.
// @ts-ignore Extension JavaScript is deliberately shipped without a transpiler.
import { pageOperation } from "../browser-companion/page.js";

test("Chrome DOM fixture observes, types, rejects stale human/DOM input and document changes", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('<!doctype html><title>Companion fixture</title><label>Name<input name="Name"></label><button>Save</button><output id="result"></output><div contenteditable="true" aria-label="Prompt"></div><button data-testid="send-button" disabled>Send</button><output id="sent"></output><script>document.querySelector("[contenteditable]").addEventListener("input",()=>document.querySelector("[data-testid=send-button]").disabled=false);document.querySelector("[data-testid=send-button]").onclick=()=>document.querySelector("#sent").textContent="Sent: "+document.querySelector("[contenteditable]").textContent;document.querySelector("button").onclick=()=>document.querySelector("output").textContent="Saved";</script>', { headers: { "content-type": "text/html" } }) });
  // Same browser as the CI DOM regressions: Playwright's headless shell unless overridden.
  const browser = await chromium.launch({ headless: true, ...(process.env.CHATGPT_DOM_TEST_BROWSER ? { executablePath: process.env.CHATGPT_DOM_TEST_BROWSER } : {}) });
  try {
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.port}/fixture`);
    const select: any = await page.evaluate(pageOperation, { kind: "select", scopeId: "scope" });
    expect(select.outcome).toBe("completed");
    const typeRef = select.snapshot.refs.find((row: any) => row.role === "textbox").ref;
    const binding = { scopeId: "scope", documentEpoch: select.snapshot.documentEpoch, observationId: select.snapshot.observationId };
    const typed: any = await page.evaluate(pageOperation, { kind: "act", ...binding, action: { kind: "type", ref: typeRef, text: "Fixture name" } });
    expect(typed).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("input").inputValue()).toBe("Fixture name");
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, action: { kind: "click", ref: typeRef } })).toMatchObject({ outcome: "rejected", executed: false });
    let fresh: any = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    await page.locator("#result").evaluate(element => { element.textContent = "Human-visible change"; });
    let clickRef = fresh.snapshot.refs.find((row: any) => row.role === "button").ref;
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "click", ref: clickRef } })).toMatchObject({ outcome: "rejected", executed: false });
    fresh = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    clickRef = fresh.snapshot.refs.find((row: any) => row.role === "button").ref;
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "click", ref: clickRef } })).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("#result").textContent()).toBe("Saved");
    fresh = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    await page.locator("input").click();
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "type", ref: fresh.snapshot.refs.find((row: any) => row.role === "textbox").ref, text: "late" } })).toMatchObject({ outcome: "rejected", executed: false });
    // A rich composer must receive an editing event, but typing must never send it.
    fresh = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    const promptRef = fresh.snapshot.refs.find((row: any) => row.label === "Prompt").ref;
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "type", ref: promptRef, text: "Companion rich composer fixture" } })).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("#sent").textContent()).toBe("");
    fresh = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    const sendRef = fresh.snapshot.refs.find((row: any) => row.label === "send-button").ref;
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "click", ref: sendRef } })).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("#sent").textContent()).toBe("Sent: Companion rich composer fixture");
    // ChatGPT-style SPA URL transitions can be read after send, but cannot acquire input authority.
    await page.evaluate(() => history.pushState(null, "", "/c/fixture"));
    fresh = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    expect(fresh.outcome).toBe("completed");
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "click", ref: fresh.snapshot.refs.find((row: any) => row.label === "send-button").ref } })).toMatchObject({ outcome: "rejected", executed: false });
    await page.goto(`http://127.0.0.1:${server.port}/other`);
    expect(await page.evaluate(pageOperation, { kind: "observe", ...binding })).toMatchObject({ outcome: "rejected", executed: false });
  } finally { await browser.close(); server.stop(true); }
}, 15_000);

test("occluded selected tab (macOS hidden while approving in NEKODEX) still accepts exact input; later hiding refuses", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('<!doctype html><title>P12 fixture</title><label>Message<input name="msg"></label><button>Submit</button>', { headers: { "content-type": "text/html" } }) });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHATGPT_DOM_TEST_BROWSER ? { executablePath: process.env.CHATGPT_DOM_TEST_BROWSER } : {}) });
  // Chrome's visibility model for a fully occluded window: `hidden` plus visibilitychange.
  const setVisibility = (state: "visible" | "hidden") => page.evaluate(value => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  let page: Awaited<ReturnType<typeof browser.newPage>>;
  try {
    page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.port}/`);
    const select: any = await page.evaluate(pageOperation, { kind: "select", scopeId: "scope" });
    const binding = { scopeId: "scope", documentEpoch: select.snapshot.documentEpoch };
    const textbox = (snapshot: any) => snapshot.refs.find((row: any) => row.role === "textbox").ref;
    let observed: any = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    await setVisibility("hidden");
    await Bun.sleep(5); // The approval happens after the window was covered.
    const act = (observation: any, extra: Record<string, unknown> = {}) => page.evaluate(pageOperation, { kind: "act", ...binding, observationId: observation.snapshot.observationId, action: { kind: "type", ref: textbox(observation.snapshot), text: "NEKODEX-P12" }, ...extra });
    // Without the dispatcher's active-tab proof, hiddenness alone refuses, with a distinct reason.
    expect(await act(observed)).toEqual({ outcome: "rejected", executed: false, reason: "Selected tab is hidden or was switched away from; show it and obtain a fresh observation" });
    // Hidden before the active-in-window check: occlusion. The same observation is still exact.
    expect(await act(observed, { shownAt: Date.now() })).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("input").inputValue()).toBe("NEKODEX-P12");
    // A text observation of the occluded tab works and is marked so no pixels are captured.
    observed = await page.evaluate(pageOperation, { kind: "observe", ...binding, shownAt: Date.now() });
    expect(observed).toMatchObject({ outcome: "completed", occluded: true });
    expect(await page.evaluate(pageOperation, { kind: "observe", ...binding })).toMatchObject({ outcome: "rejected", reason: "Selected tab must be visible" });
    // Hiding that begins after the dispatcher's check (a tab switch racing the call) refuses.
    await setVisibility("visible");
    observed = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    expect(observed.occluded).toBeUndefined();
    const shownAt = Date.now() - 50;
    await setVisibility("hidden");
    expect(await act(observed, { shownAt })).toMatchObject({ outcome: "rejected", executed: false, reason: expect.stringContaining("hidden") });
    // A real DOM change is reported as staleness, not hiddenness.
    await setVisibility("visible");
    observed = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    await page.evaluate(() => document.body.append("changed"));
    expect(await act(observed, { shownAt: Date.now() })).toEqual({ outcome: "rejected", executed: false, reason: "Observation is stale; obtain a fresh observation" });
  } finally { await browser.close(); server.stop(true); }
}, 15_000);
