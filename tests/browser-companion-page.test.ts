import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
// Bundled isolated-world function is exercised on inert local markup, not a real account/tab.
// @ts-ignore Extension JavaScript is deliberately shipped without a transpiler.
import { pageOperation } from "../browser-companion/page.js";

test("Chrome DOM fixture observes, types, rejects stale human/DOM input and document changes", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response('<!doctype html><title>Companion fixture</title><label>Name<input name="Name"></label><button>Save</button><output id="result"></output><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent="Saved";</script>', { headers: { "content-type": "text/html" } }) });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHATGPT_DOM_TEST_BROWSER || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
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
    await page.locator("output").evaluate(element => { element.textContent = "Human-visible change"; });
    let clickRef = fresh.snapshot.refs.find((row: any) => row.role === "button").ref;
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "click", ref: clickRef } })).toMatchObject({ outcome: "rejected", executed: false });
    fresh = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    clickRef = fresh.snapshot.refs.find((row: any) => row.role === "button").ref;
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "click", ref: clickRef } })).toMatchObject({ outcome: "completed", executed: true });
    expect(await page.locator("output").textContent()).toBe("Saved");
    fresh = await page.evaluate(pageOperation, { kind: "observe", ...binding });
    await page.locator("input").click();
    expect(await page.evaluate(pageOperation, { kind: "act", ...binding, observationId: fresh.snapshot.observationId, action: { kind: "type", ref: fresh.snapshot.refs.find((row: any) => row.role === "textbox").ref, text: "late" } })).toMatchObject({ outcome: "rejected", executed: false });
    await page.goto(`http://127.0.0.1:${server.port}/other`);
    expect(await page.evaluate(pageOperation, { kind: "observe", ...binding })).toMatchObject({ outcome: "rejected", executed: false });
  } finally { await browser.close(); server.stop(true); }
}, 15_000);
