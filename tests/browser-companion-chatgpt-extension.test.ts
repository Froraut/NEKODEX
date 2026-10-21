import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { companionChromiumMissing, startBrowserCompanionExtensionFixture } from "./fixtures/browser-companion-extension";

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

test("runtime .8 companion waits through ChatGPT's provisional URL and returns the one saved conversation", async () => {
  const provisional = chatgpt
    .replace('history.pushState(null, "", "/c/fixture-conversation");', 'history.pushState(null, "", "/c/local-chatgpt%3Afixture-new-chat"); window.fixturePaths = [location.pathname]; setTimeout(() => { history.replaceState(null, "", "/c/fixture-conversation"); window.fixturePaths.push(location.pathname); }, 1800);');
  const fixture = await startBrowserCompanionExtensionFixture({ url: "https://chatgpt.com/", routes: {
    "/": { body: provisional, contentType: "text/html" },
    "/api/auth/session": { body: JSON.stringify({ user: { id: "user-fixture" } }), contentType: "application/json" },
  } });
  try {
    await fixture.page.bringToFront();
    const bound = (await fixture.runtime.bindChatGpt({ modelId: "gpt-5.6-sol", reasoning: "max" })).chatGpt;
    const turn: BrowserTurn = { traceId: "trace-runtime8-provisional", modelId: "gpt-5.6-sol", reasoning: "max", companionAccount: bound.bound!.accountFingerprint,
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "Reply with the fixture answer", images: [], release: () => {} }), onTextDelta: () => {} };
    expect(await fixture.runtime.chatGptTransport().run(turn)).toBe("Fixture **answer**");
    expect(fixture.runtime.status().chatGpt).toMatchObject({ held: null, lastTurn: { path: "/c/fixture-conversation" } });
    expect(await fixture.page.evaluate(() => (window as unknown as { fixturePaths: string[] }).fixturePaths)).toEqual(["/c/local-chatgpt%3Afixture-new-chat", "/c/fixture-conversation"]);
    expect(await fixture.page.evaluate(() => (window as unknown as { fixtureSends: number }).fixtureSends)).toBe(1);
  } finally { await fixture.close(); }
}, 40_000);

for (const replacedPath of ["/c/local-chatgpt%3Aanother-chat", "/"]) test(`runtime .8 companion holds a replaced provisional conversation (${replacedPath}) without another send`, async () => {
  const replaced = chatgpt
    .replace('history.pushState(null, "", "/c/fixture-conversation");', `history.pushState(null, "", "/c/local-chatgpt%3Afixture-new-chat"); window.fixturePaths = [location.pathname]; setTimeout(() => { history.replaceState(null, "", ${JSON.stringify(replacedPath)}); window.fixturePaths.push(location.pathname); }, 1800);`);
  const fixture = await startBrowserCompanionExtensionFixture({ url: "https://chatgpt.com/", routes: {
    "/": { body: replaced, contentType: "text/html" },
    "/api/auth/session": { body: JSON.stringify({ user: { id: "user-fixture" } }), contentType: "application/json" },
  } });
  try {
    await fixture.page.bringToFront();
    const bound = (await fixture.runtime.bindChatGpt({ modelId: "gpt-5.6-sol", reasoning: "max" })).chatGpt;
    const turn: BrowserTurn = { traceId: "trace-runtime8-replaced", modelId: "gpt-5.6-sol", reasoning: "max", companionAccount: bound.bound!.accountFingerprint,
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "Reply with the fixture answer", images: [], release: () => {} }), onTextDelta: () => {} };
    await expect(fixture.runtime.chatGptTransport().run(turn)).rejects.toMatchObject({ code: "companion_outcome_unknown" });
    expect(fixture.runtime.status().chatGpt.held).toMatchObject({ stage: "send" });
    expect(await fixture.page.evaluate(() => (window as unknown as { fixturePaths: string[] }).fixturePaths)).toEqual(["/c/local-chatgpt%3Afixture-new-chat", replacedPath]);
    expect(await fixture.page.evaluate(() => (window as unknown as { fixtureSends: number }).fixtureSends)).toBe(1);
  } finally { await fixture.close(); }
}, 40_000);
