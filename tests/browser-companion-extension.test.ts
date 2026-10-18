import { expect, test } from "bun:test";
import { browserBindingOf } from "../src/browser-companion/protocol";
import { startBrowserCompanionExtensionFixture } from "./fixtures/browser-companion-extension";

/** Real MV3 permission/transport fixture, not visible toolbar or installed-system proof. */
test("actual MV3 popup pairs, selects with activeTab, observes and types on inert local markup", async () => {
  const fixture = await startBrowserCompanionExtensionFixture();
  try {
    expect(fixture.extensionEnabled).toBe(true); expect(fixture.ungrantedReadRefused).toBe(true);
    const { runtime, page, provider } = fixture;

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
    await fixture.stopSharing(); expect(runtime.status().companion?.paired).toBe(false);
  } finally { await fixture.close(); }
}, 25_000);
