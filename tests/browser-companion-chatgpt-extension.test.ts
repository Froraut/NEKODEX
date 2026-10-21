import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { startBrowserCompanionExtensionFixture } from "./fixtures/browser-companion-extension";

/** Inert ChatGPT-shaped document using the adapter's reviewed DOM markers; no OpenAI network. */
const chatgpt = `<!doctype html><title>ChatGPT</title><main id="thread"></main>
<form data-chatgpt-composer><button type="button" aria-haspopup="menu" data-testid="model-switcher-dropdown-button">Pro</button>
<div id="prompt-textarea" contenteditable="true" style="min-height:40px"></div><button data-testid="send-button" type="button" disabled>Send</button></form>
<script>
const field = document.querySelector("#prompt-textarea"), send = document.querySelector('[data-testid="send-button"]'), thread = document.querySelector("#thread");
window.fixtureSends = 0;
field.addEventListener("input", () => { send.disabled = !field.innerText.trim(); });
send.addEventListener("click", () => {
  window.fixtureSends++;
  const text = field.innerText; field.textContent = ""; send.disabled = true;
  history.pushState(null, "", "/c/fixture-conversation");
  thread.insertAdjacentHTML("beforeend", '<article data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user" data-message-id="user-1"></div></article>');
  thread.querySelector('[data-message-id="user-1"]').textContent = text;
  const stop = document.createElement("button"); stop.type = "button"; stop.dataset.testid = "stop-button"; stop.textContent = "Stop";
  document.querySelector("form").append(stop);
  setTimeout(() => {
    thread.insertAdjacentHTML("beforeend", '<article data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant" data-message-id="assistant-1"><div class="markdown"><p>Fixture <strong>answer</strong></p></div></div><button data-testid="copy-turn-action-button">Copy</button></article>');
    stop.remove();
  }, 400);
});
</script>`;

test("actual MV3 extension binds a ChatGPT-shaped document, sends once and reads the tied answer", async () => {
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
    const turn: BrowserTurn = { traceId: "trace-mv3-chatgpt", modelId: "gpt-5.6-sol", reasoning: "max",
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "Reply with the fixture answer", images: [], release: () => {} }), onTextDelta: delta => { deltas.push(delta); } };
    expect(await runtime.chatGptTransport().run(turn)).toBe("Fixture **answer**");
    expect(deltas).toEqual(["Fixture **answer**"]);
    expect(await page.evaluate(() => (window as unknown as { fixtureSends: number }).fixtureSends)).toBe(1);
    expect(await page.locator('[data-message-author-role="user"]').allInnerTexts()).toEqual(["Reply with the fixture answer"]);
    expect(runtime.status().chatGpt.lastTurn).toMatchObject({ userMessageId: "message:user-1", assistantMessageId: "message:assistant-1", path: "/c/fixture-conversation" });
    // The conversation is no longer a new chat: a further turn is refused by the page, never typed.
    await expect(runtime.chatGptTransport().run({ ...turn, traceId: "trace-mv3-chatgpt-2" })).rejects.toMatchObject({ code: "companion_send_refused" });
    expect(await page.evaluate(() => (window as unknown as { fixtureSends: number }).fixtureSends)).toBe(1);
    expect(runtime.status().chatGpt.held).toBeNull();
    await fixture.stopSharing(); expect(runtime.status().companion?.paired).toBe(false);
  } finally { await fixture.close(); }
}, 40_000);
