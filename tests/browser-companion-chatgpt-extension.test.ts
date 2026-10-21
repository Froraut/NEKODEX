import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { companionChromiumMissing, startBrowserCompanionExtensionFixture } from "./fixtures/browser-companion-extension";

/** Inert ChatGPT-shaped document using the adapter's reviewed DOM markers; no OpenAI network. */
const chatgpt = `<!doctype html><meta charset="utf-8"><title>ChatGPT</title><main id="thread"></main>
<form data-chatgpt-composer><button type="button" aria-haspopup="menu" data-testid="model-switcher-dropdown-button">Pro</button>
<div id="prompt-textarea" contenteditable="true" style="min-height:40px"></div><button data-testid="send-button" type="button" disabled>Send</button></form>
<script>
const field = document.querySelector("#prompt-textarea"), send = document.querySelector('[data-testid="send-button"]'), thread = document.querySelector("#thread");
window.fixtureSends = 0;
field.addEventListener("input", () => { send.disabled = !field.innerText.trim(); });
send.addEventListener("click", () => {
  window.fixtureSends++;
  const text = field.innerText; field.textContent = ""; send.disabled = true;
  // Live ChatGPT (P11, 2026-10-21): a new chat first gets its client-side id, then its saved id
  // after send has returned (its message-ID wait is about 1s).
  history.pushState(null, "", "/c/local-chatgpt%3Ae7b99a63-8626-44d7-827f-6efb58121825");
  setTimeout(() => history.replaceState(null, "", "/c/fixture-conversation"), 1300);
  // The message ID hydrates only after send has returned: reads must keep the ordinal identity.
  thread.insertAdjacentHTML("beforeend", '<article data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user"></div></article>');
  const user = thread.querySelector('[data-message-author-role="user"]'); user.textContent = text;
  setTimeout(() => user.setAttribute("data-message-id", "user-1"), 1500);
  const stop = document.createElement("button"); stop.type = "button"; stop.dataset.testid = "stop-button"; stop.textContent = "Stop";
  document.querySelector("form").append(stop);
  setTimeout(() => {
    thread.insertAdjacentHTML("beforeend", '<article data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="assistant-1"><div class="markdown"><p>Fixture <strong>answer</strong></p></div></div><button data-testid="copy-turn-action-button">Copy</button></article>');
    stop.remove();
  }, 2000);
});
</script>`;

test.skipIf(Boolean(companionChromiumMissing))("actual MV3 extension binds a ChatGPT-shaped document, sends once and reads the tied answer", async () => {
  const fixture = await startBrowserCompanionExtensionFixture({ url: "https://chatgpt.com/", routes: {
    "/": { body: chatgpt, contentType: "text/html" },
    "/api/auth/session": { body: JSON.stringify({ user: { id: "user-fixture", email: "fixture@example.invalid" }, accessToken: "never-leaves-page" }), contentType: "application/json" },
  } });
  try {
    const { runtime, page } = fixture;
    await page.bringToFront();
    const bound = (await runtime.bindChatGpt({ modelId: "gpt-5.6-sol", reasoning: "max" })).chatGpt;
    expect(bound.bound).toMatchObject({ modelLabel: "Pro", accountFingerprint: createHash("sha256").update("chatgpt-user:user-fixture").digest("hex").slice(0, 12) });
    expect(JSON.stringify(runtime.status())).not.toContain("never-leaves-page");
    const deltas: string[] = [];
    // The turn opts in by naming the bound account fingerprint, as a Local API request header does.
    const turn: BrowserTurn = { traceId: "trace-mv3-chatgpt", modelId: "gpt-5.6-sol", reasoning: "max", companionAccount: bound.bound!.accountFingerprint,
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "Reply with the fixture answer", images: [], release: () => {} }), onTextDelta: delta => { deltas.push(delta); } };
    expect(await runtime.chatGptTransport().run(turn)).toBe("Fixture **answer**");
    expect(deltas).toEqual(["Fixture **answer**"]);
    expect(await page.evaluate(() => (window as unknown as { fixtureSends: number }).fixtureSends)).toBe(1);
    expect(await page.locator('[data-message-author-role="user"]').allInnerTexts()).toEqual(["Reply with the fixture answer"]);
    expect(runtime.status().chatGpt.lastTurn).toMatchObject({ userMessageId: "ordinal:1", assistantMessageId: "message:assistant-1", path: "/c/fixture-conversation" });
    // The conversation is no longer a new chat: a further turn is refused by the page, never typed.
    await expect(runtime.chatGptTransport().run({ ...turn, traceId: "trace-mv3-chatgpt-2" })).rejects.toMatchObject({ code: "companion_send_refused" });
    expect(await page.evaluate(() => (window as unknown as { fixtureSends: number }).fixtureSends)).toBe(1);
    expect(runtime.status().chatGpt.held).toBeNull();
    await fixture.stopSharing(); expect(runtime.status().companion?.paired).toBe(false);
  } finally { await fixture.close(); }
}, 40_000);

for (const scenario of ["failed", "hidden", "literal"] as const) test.skipIf(Boolean(companionChromiumMissing))(`MV3 companion distinguishes a ${scenario} response renderer marker without resending`, async () => {
  const answer = scenario === "failed"
    ? '<div role="status" data-dil-render-failed>This response couldn’t load</div>'
    : scenario === "hidden"
      ? '<div role="status" data-dil-render-failed hidden>This response couldn’t load</div><p>Fixture <strong>answer</strong></p>'
      : '<p>This response couldn’t load</p>';
  const document = chatgpt.replace('<p>Fixture <strong>answer</strong></p>', answer);
  const fixture = await startBrowserCompanionExtensionFixture({ url: "https://chatgpt.com/", routes: {
    "/": { body: document, contentType: "text/html" },
    "/api/auth/session": { body: JSON.stringify({ user: { id: "user-fixture" } }), contentType: "application/json" },
  } });
  try {
    await fixture.page.bringToFront();
    const bound = (await fixture.runtime.bindChatGpt({ modelId: "gpt-5.6-sol", reasoning: "max" })).chatGpt;
    const deltas: string[] = [];
    const turn: BrowserTurn = { traceId: `trace-render-${scenario}`, modelId: "gpt-5.6-sol", reasoning: "max", companionAccount: bound.bound!.accountFingerprint,
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "Reply with the fixture answer", images: [], release: () => {} }), onTextDelta: delta => { deltas.push(delta); } };
    if (scenario === "failed") {
      await expect(fixture.runtime.chatGptTransport().run(turn)).rejects.toMatchObject({ code: "companion_response_unobserved" });
      expect(fixture.runtime.status().chatGpt).toMatchObject({ held: { stage: "response", reason: "ChatGPT's response renderer could not load the sent answer; inspect the conversation in the selected tab" }, lastTurn: null });
      expect(deltas).toEqual([]);
      await expect(fixture.runtime.chatGptTransport().run({ ...turn, traceId: "trace-render-must-not-retry" })).rejects.toMatchObject({ code: "companion_outcome_held" });
    } else {
      const expected = scenario === "hidden" ? "Fixture **answer**" : "This response couldn’t load";
      expect(await fixture.runtime.chatGptTransport().run(turn)).toBe(expected);
      expect(deltas).toEqual([expected]);
      expect(fixture.runtime.status().chatGpt.held).toBeNull();
    }
    expect(await fixture.page.evaluate(() => (window as unknown as { fixtureSends: number }).fixtureSends)).toBe(1);
  } finally { await fixture.close(); }
}, 40_000);
