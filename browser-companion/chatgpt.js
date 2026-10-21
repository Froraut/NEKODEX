/**
 * Bundled ChatGPT document operations. Injected only into the exact selected main-frame
 * document after an explicit NEKODEX binding; the host supplies data, never selectors or code.
 * Selectors mirror src/chatgpt-session.ts (a focused test keeps them identical).
 */
export async function chatGptOperation(request) {
  const S = {
    composer: "[data-testid=\"prompt-textarea\"], #prompt-textarea, [contenteditable=\"true\"][data-lexical-editor=\"true\"], form:has([data-testid=\"send-button\"]) .ProseMirror[contenteditable=\"true\"], form[data-chatgpt-composer] [data-composer-markdown][contenteditable=\"true\"][role=\"textbox\"]",
    effort: "button[aria-haspopup=\"menu\"][data-tone=\"neutral\"], button[data-testid=\"model-switcher-dropdown-button\"][aria-haspopup=\"menu\"], button[data-codex-intelligence-trigger=\"true\"][data-composer-navigation-target=\"reasoning\"][aria-haspopup=\"menu\"]",
    send: "[data-testid=\"send-button\"], button[type=\"submit\"]",
    stop: "[data-testid=\"stop-button\"], form[data-chatgpt-composer] button[type=\"button\"][aria-label=\"Stop\"], form[data-chatgpt-composer] button[type=\"button\"][aria-label=\"Arrêter\"], form[data-chatgpt-composer] button[type=\"button\"].size-token-button-composer:has(svg.icon-primary-action > path[d=\"M4.5 5.75C4.5 5.05964 5.05964 4.5 5.75 4.5H14.25C14.9404 4.5 15.5 5.05964 15.5 5.75V14.25C15.5 14.9404 14.9404 15.5 14.25 15.5H5.75C5.05964 15.5 4.5 14.9404 4.5 14.25V5.75Z\"])",
    completion: "button[data-testid=\"copy-turn-action-button\"], [data-turn-key] .turn-action-controls button",
    assistantTurn: "[data-testid^=\"conversation-turn-\"][data-turn=\"assistant\"]:not([data-turn-key] *), [data-testid^=\"conversation-turn-\"][data-message-author-role=\"assistant\"]:not([data-turn-key] *), [data-testid^=\"conversation-turn-\"]:has([data-message-author-role=\"assistant\"]):not([data-turn-key] *), [data-turn-key]:has([data-conversation-role=\"assistant\"], [data-chatgpt-agent-turn-start])",
    userTurn: "[data-testid^=\"conversation-turn-\"][data-turn=\"user\"]:not([data-turn-key] *), [data-testid^=\"conversation-turn-\"][data-message-author-role=\"user\"]:not([data-turn-key] *), [data-testid^=\"conversation-turn-\"]:has([data-message-author-role=\"user\"]):not([data-turn-key] *), [data-turn-key]:has([data-user-message-bubble])",
    answer: ".markdown, [data-message-author-role=\"assistant\"] .puik-root.not-markdown > [class*=\"_DilResponseRoot\"], [data-markdown-text-style=\"assistant-message\"]",
    userMessage: "[data-message-author-role=\"user\"], [data-user-message-bubble]",
  };
  const MAX_HTML = 400_000;
  const refuse = reason => ({ outcome: "rejected", executed: false, reason });
  const state = globalThis.__nekodexCompanionV1;
  if (!state || state.scopeId !== request.scopeId || state.epoch !== request.documentEpoch) return refuse("Selected document or user scope changed; select the ChatGPT tab again");
  if (location.origin !== "https://chatgpt.com") return refuse("The selected tab is not a chatgpt.com document");
  const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const visible = element => {
    if (!element?.isConnected) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
  };
  const all = selector => [...document.querySelectorAll(selector)];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const generating = () => all(S.stop).some(visible);
  const userTurns = () => all(S.userTurn);
  const turnCount = () => userTurns().length + all(S.assistantTurn).length;
  const modelLabel = () => {
    const controls = all(S.effort).filter(visible);
    return controls.length === 1 ? (normalize(controls[0].innerText).slice(0, 120) || "none") : controls.length ? "ambiguous" : "none";
  };
  const composer = () => { const rows = all(S.composer).filter(visible); return rows.length === 1 ? rows[0] : undefined; };
  async function sha256(value) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function account() {
    // Firefox content scripts use content.fetch for page-context requests; Chrome's fetch is already page-relative.
    const pageFetch = typeof content !== "undefined" && typeof content?.fetch === "function" ? content.fetch.bind(content) : fetch;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await pageFetch("/api/auth/session", { credentials: "include", cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
      const endpoint = new URL(response.url);
      if (!response.ok || endpoint.origin !== location.origin || endpoint.pathname !== "/api/auth/session") return undefined;
      const text = await response.text();
      if (text.length > 256 * 1024) return undefined;
      const id = JSON.parse(text)?.user?.id;
      if (typeof id !== "string" || !id) return undefined;
      // Only a one-way digest of the account's user ID leaves the page; tokens/email never do.
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`chatgpt-user:${id}`));
      return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
    } catch { return undefined; } finally { clearTimeout(timer); }
  }
  function userMessageElement(turn) { return turn.matches(S.userMessage) ? turn : turn.querySelector(S.userMessage) ?? turn; }
  function userMessageId(turn, ordinal) {
    const id = userMessageElement(turn).closest("[data-message-id]")?.getAttribute("data-message-id") ?? turn.querySelector("[data-message-author-role=\"user\"][data-message-id]")?.getAttribute("data-message-id");
    return id && /^[A-Za-z0-9:_-]{1,120}$/.test(id) ? `message:${id}` : `ordinal:${ordinal}`;
  }

  if (request.op === "identify") {
    const digest = await account();
    if (!digest) return refuse("ChatGPT is not signed in on the selected tab, or its session could not be read");
    const field = composer();
    return { outcome: "completed", executed: false, chatgpt: { op: "identify", account: digest, modelLabel: modelLabel(), path: location.pathname.slice(0, 2048),
      newChat: location.pathname === "/" && turnCount() === 0, composerReady: !!field && !normalize(field.innerText), generating: generating() } };
  }

  if (request.op === "read") {
    const turns = userTurns();
    // A message ID may hydrate after send returned `ordinal:N`; that ordinal stays authoritative
    // because send required an empty new chat. A hydrated ID must still match exactly.
    const ordinal = /^ordinal:(\d+)$/.exec(request.userMessageId);
    let index = ordinal ? Number(ordinal[1]) - 1 < turns.length ? Number(ordinal[1]) - 1 : -1
      : turns.findIndex((turn, position) => userMessageId(turn, position + 1) === request.userMessageId);
    // Position alone is not identity: the matched turn must still carry exactly the sent text.
    if (index >= 0 && request.textDigest && await sha256(normalize(userMessageElement(turns[index]).innerText)) !== request.textDigest) index = -1;
    // The user-turn count lets the host accept ChatGPT's own new-chat URL transition only while the
    // conversation still holds exactly the one sent message.
    const result = { op: "read", path: location.pathname.slice(0, 2048), userTurnFound: index >= 0, userTurnCount: Math.min(turns.length, 10_000), generating: generating() };
    if (request.verifyAccount) { const digest = await account(); if (digest) result.account = digest; }
    if (index < 0) return { outcome: "completed", executed: false, chatgpt: result };
    const anchor = userMessageElement(turns[index]);
    const next = turns[index + 1];
    const follows = node => !!(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) && !anchor.contains(node)
      && !node.closest(S.userMessage) && (!next || !!(node.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING));
    const roots = all(S.answer).filter(node => follows(node) && !all(S.answer).some(other => other !== node && other.contains(node)));
    const root = roots.at(-1);
    if (root) {
      // A DIL renderer failure is visible UI, not the assistant's answer. Keep it tied to
      // this sent turn and let the host retain its response hold; reads never regenerate.
      const renderFailures = [...root.querySelectorAll("[data-dil-render-failed]")];
      if (renderFailures.some(visible)) return refuse("ChatGPT's response renderer could not load the sent answer; inspect the conversation in the selected tab");
      const answer = renderFailures.length ? root.cloneNode(true) : root;
      // Hidden error templates are neither a failure nor answer text. Remove only from the copy.
      if (renderFailures.length) for (const marker of answer.querySelectorAll("[data-dil-render-failed]")) marker.remove();
      const html = answer.innerHTML;
      const completionAction = all(S.completion).some(button => !!(root.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) && (!next || !!(button.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING)));
      const id = root.closest("[data-message-author-role=\"assistant\"][data-message-id]")?.getAttribute("data-message-id");
      result.assistant = { ...(id && /^[A-Za-z0-9:_-]{1,120}$/.test(id) ? { messageId: `message:${id}` } : {}),
        html: html.length > MAX_HTML ? "" : html, truncated: html.length > MAX_HTML, completionAction };
    }
    return { outcome: "completed", executed: false, chatgpt: result };
  }

  if (request.op !== "send" || typeof request.text !== "string" || !request.text) return refuse("Unsupported ChatGPT operation");
  if (document.visibilityState !== "visible") return refuse("Keep the selected ChatGPT tab visible in its window");
  const digest = await account();
  if (!digest || digest !== request.expectedAccount) return refuse("The signed-in ChatGPT account changed; bind the tab again");
  if (modelLabel() !== request.expectedModelLabel) return refuse("The visible ChatGPT model selection changed since binding; restore it or bind again");
  if (location.pathname !== "/" || turnCount() !== 0 || generating()) return refuse("Open a new chat in the selected ChatGPT tab before sending");
  const field = composer();
  if (!field || normalize(field.innerText)) return refuse("The ChatGPT composer is unavailable or not empty");
  field.focus();
  const selection = getSelection();
  if (document.activeElement !== field || !selection) return refuse("The ChatGPT composer did not accept focus");
  const range = document.createRange(); range.selectNodeContents(field); range.collapse(false);
  selection.removeAllRanges(); selection.addRange(range);
  const clearDraft = () => {
    // Nothing was submitted. Remove only our own draft so the composer is empty again.
    try { range.selectNodeContents(field); selection.removeAllRanges(); selection.addRange(range); document.execCommand("delete"); } catch { /* still not sent */ }
  };
  const inserted = document.execCommand("insertText", false, request.text);
  if (!inserted || normalize(field.innerText) !== normalize(request.text)) { clearDraft(); return refuse("ChatGPT composer readback did not match the prompt; nothing was sent"); }
  const form = field.closest("form");
  let button;
  for (let waited = 0; waited <= 5000; waited += 100) {
    const buttons = form ? [...form.querySelectorAll(S.send)].filter(visible) : [];
    if (buttons.length > 1) { clearDraft(); return refuse("ChatGPT shows more than one send control; nothing was sent"); }
    if (buttons[0] && !buttons[0].disabled && buttons[0].getAttribute("aria-disabled") !== "true") { button = buttons[0]; break; }
    await delay(100);
  }
  if (!button) { clearDraft(); return refuse("The ChatGPT send control did not become available; nothing was sent"); }
  // The click is the one input boundary. Everything after it is evidence, never a retry.
  try { button.click(); } catch { return { outcome: "unknown", executed: true, reason: "Send click began without a terminal receipt" }; }
  for (let waited = 0; waited <= 20_000; waited += 200) {
    const turns = userTurns();
    if (turns.length > 1) return { outcome: "unknown", executed: true, reason: "More than one user message appeared after send" };
    if (turns.length === 1) {
      if (normalize(userMessageElement(turns[0]).innerText) !== normalize(request.text)) return { outcome: "unknown", executed: true, reason: "The observed ChatGPT user message does not match the prompt" };
      // Prefer a hydrated message ID; reads also accept the ordinal if it appears later.
      const sent = () => userTurns()[0] ?? turns[0];
      for (let hydrate = 0; hydrate < 5 && userMessageId(sent(), 1).startsWith("ordinal:"); hydrate++) await delay(200);
      return { outcome: "completed", executed: true, chatgpt: { op: "send", userMessageId: userMessageId(sent(), 1), path: location.pathname.slice(0, 2048) } };
    }
    await delay(200);
  }
  return { outcome: "unknown", executed: true, reason: "ChatGPT did not show the sent message; the outcome is unknown" };
}
