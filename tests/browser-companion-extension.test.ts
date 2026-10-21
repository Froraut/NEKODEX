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

test("actual MV3 popup and session show a NEKODEX revoke instead of a retained pairing", async () => {
  const fixture = await startBrowserCompanionExtensionFixture();
  try {
    const { runtime, popup, extensionId } = fixture;
    const session = popup.context().pages().find(page => page.url().startsWith(`chrome-extension://${extensionId}/session.html`))!;
    expect(session).toBeDefined();
    // Revoked while sharing: the session names the real state and forgets the dead pairing.
    runtime.revoke();
    await session.locator("#status").filter({ hasText: "NEKODEX revoked this pairing" }).waitFor({ timeout: 5000 });
    await popup.reload();
    await popup.locator("#status").filter({ hasText: "Not paired" }).waitFor({ timeout: 5000 });
    expect(await popup.locator("#select").isDisabled()).toBe(true);
    // Pair again without selecting: the reopened popup confirms the still-valid pairing with the host.
    await popup.locator("#pairing").fill(JSON.stringify(runtime.createPairing().pairing));
    await popup.getByRole("button", { name: "Pair with local host", exact: true }).click();
    await popup.locator("#status").filter({ hasText: "Paired. Select this tab" }).waitFor({ timeout: 5000 });
    await popup.reload();
    await popup.locator("#status").filter({ hasText: "Paired with NEKODEX" }).waitFor({ timeout: 5000 });
    // Revoked while no session runs: the reopened popup shows that, never "Pairing retained".
    runtime.revoke();
    await popup.reload();
    await popup.locator("#status").filter({ hasText: "NEKODEX revoked this pairing" }).waitFor({ timeout: 5000 });
    expect(await popup.locator("#select").isDisabled()).toBe(true);
    expect(await popup.locator("#host").textContent()).toContain(extensionId);
    expect(runtime.status().companion?.paired).toBe(false);
  } finally { await fixture.close(); }
}, 25_000);
