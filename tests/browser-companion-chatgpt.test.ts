import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createBrowserCompanionHost } from "../src/browser-companion/host";
import { createCompanionChatGptTransport } from "../src/browser-companion/chatgpt-transport";
import { COMPANION_ORIGIN, type BrowserObservation, type CompanionCommand } from "../src/browser-companion/protocol";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { chatGptCompanionTransport, installChatGptCompanionTransport } from "../src/adapters/chatgpt-web/companion-transport-port";

const extensionId = "e".repeat(32);
const ACCOUNT = "a".repeat(64), OTHER_ACCOUNT = "b".repeat(64);
/** The fingerprint NEKODEX shows for the binding; an opted-in turn names it. */
const FINGERPRINT = ACCOUNT.slice(0, 12);
type Reply = { outcome: "completed" | "rejected" | "unknown"; executed: boolean; reason?: string; chatgpt?: unknown } | "drop";

/** Inert extension protocol fixture driving the real host over its HTTP handler. */
async function companion(options: { features?: string[]; url?: string } = {}) {
  const host = createBrowserCompanionHost({ extensionId, hostId: "chatgpt-host" });
  const offer = host.createPairing();
  let credentials: { hostId: string; sessionId?: string; token?: string } = offer;
  async function post(route: string, payload: unknown = {}, signal?: AbortSignal) {
    const response = await host.fetch(new Request(`${COMPANION_ORIGIN}/v1/companion/${route}`, { method: "POST", signal,
      headers: { origin: `chrome-extension://${extensionId}`, "content-type": "application/json", ...(credentials.token ? { authorization: `Bearer ${credentials.token}` } : {}) },
      body: JSON.stringify({ version: 1, hostId: credentials.hostId, sessionId: credentials.sessionId, ...(payload as object) }) }));
    return { status: response.status, body: await response.json() as any };
  }
  credentials = (await post("pair", { pairingCode: offer.pairingCode })).body;
  const observation = (scope = "scope-1", documentId = "document-1"): BrowserObservation => ({ kind: "browser", sessionId: credentials.sessionId!, scopeId: scope,
    tabId: 4, windowId: 2, frameId: 0, documentId, documentEpoch: `epoch-${documentId}`, observationId: `observation-${scope}`,
    url: options.url ?? "https://chatgpt.com/", title: "ChatGPT", text: "", refs: [] });
  const select = async (scope?: string, documentId?: string, features = options.features ?? ["chatgpt-v1", "chatgpt-turns-v1"]) =>
    expect((await post("select", { observation: observation(scope, documentId), features })).status).toBe(200);
  await select();
  // Page model: one account, one visible model label, one new chat, one possible send.
  const page = { account: ACCOUNT, label: "Pro", sends: 0, reads: 0, answerAfterReads: 2, html: "<p>Hello from <strong>ChatGPT</strong></p>", userTurnFound: true, path: "/c/conversation-1" };
  const commands: CompanionCommand[] = [];
  let handler = (command: CompanionCommand): Reply => {
    const op = command.chatgpt!;
    if (op.op === "identify") return { outcome: "completed", executed: false, chatgpt: { op: "identify", account: page.account, modelLabel: page.label, path: "/", newChat: true, composerReady: true, generating: false } };
    if (op.op === "send") {
      if (op.expectedAccount !== page.account) return { outcome: "rejected", executed: false, reason: "The signed-in ChatGPT account changed; bind the tab again" };
      page.sends++;
      return { outcome: "completed", executed: true, chatgpt: { op: "send", userMessageId: "message:user-1", path: "/c/conversation-1" } };
    }
    page.reads++;
    const ready = page.reads > page.answerAfterReads;
    return { outcome: "completed", executed: false, chatgpt: { op: "read", path: page.path, userTurnFound: page.userTurnFound, generating: !ready,
      ...(op.verifyAccount ? { account: page.account } : {}),
      ...(ready ? { assistant: { messageId: "message:assistant-1", html: page.html, truncated: false, completionAction: true } } : {}) } };
  };
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const polled = await post("poll", {}, AbortSignal.timeout(200)).catch(() => ({ body: { commands: [] } }));
      // A refused poll resolves without a macrotask; yield so timers are never starved.
      if (!polled.body.commands?.length) await new Promise(resolve => setTimeout(resolve, 5));
      for (const command of polled.body.commands ?? []) {
        commands.push(command);
        const reply = handler(command);
        if (reply !== "drop") await post("result", { result: { operationId: command.operationId, ...reply } });
      }
    }
  })();
  return { host, post, page, commands, select, setHandler: (next: typeof handler) => { const previous = handler; handler = next; return previous; },
    async close() { stopped = true; await loop; host.close(); } };
}

function turn(overrides: Partial<BrowserTurn> = {}) {
  const calls = { prepare: 0, activated: 0, submitted: 0, deltas: [] as string[] };
  const value: BrowserTurn = { traceId: `trace-${crypto.randomUUID()}`, modelId: "gpt-5.6-sol", reasoning: "max", companionAccount: FINGERPRINT,
    capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
    prepare: async () => { calls.prepare++; return { text: "Say hello", images: [], release: () => {} }; },
    onSendActivated: () => { calls.activated++; }, onSubmitted: () => { calls.submitted++; },
    onTextDelta: delta => { calls.deltas.push(delta); }, ...overrides };
  return { turn: value, calls };
}
const fast = { sendReceiptMs: 150, readMs: 500, pollMs: 5, responseMs: 5_000 };
const sends = (commands: CompanionCommand[]) => commands.filter(command => command.chatgpt?.op === "send");

test("bound ChatGPT document sends once and settles with the observed answer tied to that message", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    expect(transport.status().state).toBe("unbound");
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    expect(transport.status()).toMatchObject({ state: "bound", bound: { modelLabel: "Pro", accountFingerprint: FINGERPRINT, tabId: 4, documentId: "document-1" } });
    const { turn: request, calls } = turn();
    const answer = await transport.port.run(request);
    expect(answer).toBe("Hello from **ChatGPT**");
    expect(calls).toEqual({ prepare: 1, activated: 1, submitted: 1, deltas: ["Hello from **ChatGPT**"] });
    expect(f.page.sends).toBe(1);
    const [send] = sends(f.commands);
    expect(send!.chatgpt).toEqual({ op: "send", text: "Say hello", expectedAccount: ACCOUNT, expectedModelLabel: "Pro" });
    expect(send!.binding.documentId).toBe("document-1");
    const reads = f.commands.filter(command => command.chatgpt?.op === "read");
    expect(reads.every(command => command.chatgpt!.op === "read" && command.chatgpt!.userMessageId === "message:user-1")).toBe(true);
    expect(reads.at(-1)!.chatgpt).toMatchObject({ verifyAccount: true, textDigest: createHash("sha256").update("Say hello").digest("hex") });
    expect(transport.status().lastTurn).toMatchObject({ traceId: request.traceId, userMessageId: "message:user-1", assistantMessageId: "message:assistant-1", path: "/c/conversation-1" });
    expect(transport.status().lastTurn!.answerSha256).toMatch(/^[a-f0-9]{64}$/);
  } finally { await f.close(); }
});

test("lost send acknowledgement is held, never replayed, and a late ACK does not release it", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    const previous = f.setHandler(command => command.chatgpt?.op === "send" ? "drop" : previous(command));
    const first = turn();
    await expect(transport.port.run(first.turn)).rejects.toMatchObject({ code: "companion_outcome_unknown", retryable: false });
    expect(first.calls.activated).toBe(1); expect(first.calls.submitted).toBe(0);
    const held = transport.status().held!;
    expect(held).toMatchObject({ stage: "send" });
    expect(sends(f.commands)).toHaveLength(1);
    // The extension's late receipt reconciles the host, but the held turn stays held.
    expect((await f.post("result", { result: { operationId: held.operationId, outcome: "completed", executed: true, chatgpt: { op: "send", userMessageId: "message:user-1", path: "/c/x" } } })).status).toBe(200);
    expect(f.host.receipt(held.operationId)).toMatchObject({ outcome: "completed", cancelRequested: true });
    const second = turn();
    await expect(transport.port.run(second.turn)).rejects.toMatchObject({ code: "companion_outcome_held" });
    expect(second.calls.prepare).toBe(0);
    // Unbinding does not lift the hold: a later opted-in turn is still refused, unprepared.
    transport.unbind();
    const afterUnbind = turn();
    await expect(transport.port.run(afterUnbind.turn)).rejects.toMatchObject({ code: "companion_outcome_held" });
    expect(afterUnbind.calls.prepare).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(sends(f.commands)).toHaveLength(1);
    expect(() => transport.release("another-operation")).toThrow("No held");
    transport.release(held.operationId);
    expect(transport.status()).toMatchObject({ state: "unbound", held: null });
  } finally { await f.close(); }
});

test("an unknown page send receipt is held by the transport and by the host", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    const previous = f.setHandler(command => command.chatgpt?.op === "send" ? { outcome: "unknown", executed: true, reason: "ChatGPT did not show the sent message" } : previous(command));
    await expect(transport.port.run(turn().turn)).rejects.toMatchObject({ code: "companion_outcome_unknown" });
    expect(transport.status().held).toMatchObject({ stage: "send", reason: "ChatGPT did not show the sent message" });
    transport.release(transport.status().held!.operationId);
    // Releasing the transport hold does not erase the host's own unknown slot: the old session
    // must be revoked and paired again before any new ChatGPT operation can be offered.
    await expect(transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" })).rejects.toThrow("uncertain");
    expect(sends(f.commands)).toHaveLength(1);
  } finally { await f.close(); }
});

test("an answer that becomes unobservable after the send is held, not resent", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    // Pairing revoked after the send (session closed): the answer is unobservable and held.
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    f.page.answerAfterReads = 1_000;
    const waiting = transport.port.run(turn().turn);
    while (!f.commands.some(command => command.chatgpt?.op === "read")) await new Promise(resolve => setTimeout(resolve, 5));
    f.host.revoke();
    await expect(waiting).rejects.toMatchObject({ code: "companion_response_unobserved" });
    expect(transport.status().held).toMatchObject({ stage: "response", userMessageId: "message:user-1" });
    expect(sends(f.commands)).toHaveLength(1);
    expect(f.page.sends).toBe(1);
  } finally { await f.close(); }
});

test("same-document navigation to another conversation during settlement is held, never rebound", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    f.page.answerAfterReads = 3;
    const previous = f.setHandler(command => {
      // The user opens another chat in the bound tab after the first read.
      if (command.chatgpt?.op === "read" && f.page.reads >= 1) f.page.path = "/c/another-conversation";
      return previous(command);
    });
    await expect(transport.port.run(turn().turn)).rejects.toMatchObject({ code: "companion_response_unobserved" });
    expect(transport.status().held).toMatchObject({ stage: "response", reason: "the bound tab navigated to another conversation" });
    expect(f.page.sends).toBe(1);
  } finally { await f.close(); }
});

/** Live P11 (6.1.33-nekodex.8): ChatGPT moves a new chat "/" -> "/c/local-chatgpt%3A<uuid>" -> "/c/<id>". */
function newChatNavigation(f: Awaited<ReturnType<typeof companion>>, options: { savedAfterReads?: number; userTurnCount?: () => number; savedPath?: string } = {}) {
  const provisional = "/c/local-chatgpt%3Ae7b99a63-8626-44d7-827f-6efb58121825";
  f.page.path = provisional;
  let moved = false;
  const previous = f.setHandler(command => {
    const op = command.chatgpt!;
    if (op.op === "send") { f.page.sends++; return { outcome: "completed", executed: true, chatgpt: { op: "send", userMessageId: "ordinal:1", path: provisional } }; }
    if (op.op === "read" && !moved && f.page.reads + 1 >= (options.savedAfterReads ?? 2)) { moved = true; f.page.path = options.savedPath ?? "/c/6ad9031a-f698-83ea-95d5-b1281ab83277"; }
    const reply = previous(command);
    if (op.op === "read" && reply !== "drop" && reply.chatgpt) (reply.chatgpt as { userTurnCount?: number }).userTurnCount = options.userTurnCount?.() ?? 1;
    return reply;
  });
}

test("a new chat's own transition to its saved /c/<id> during the bound send settles (live P11 sequence)", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    f.page.answerAfterReads = 3; f.page.html = "<p>p11-ok</p>";
    newChatNavigation(f);
    expect(await transport.port.run(turn().turn)).toBe("p11-ok");
    expect(transport.status()).toMatchObject({ state: "bound", held: null, lastTurn: { userMessageId: "ordinal:1", path: "/c/6ad9031a-f698-83ea-95d5-b1281ab83277" } });
    expect(f.page.sends).toBe(1);
  } finally { await f.close(); }
});

test("new-chat transitions are refused unless the new conversation holds exactly the sent turn and moves forward once", async () => {
  // A second user turn in the conversation the tab moved to: not this send's own new chat.
  let f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    f.page.answerAfterReads = 3;
    newChatNavigation(f, { userTurnCount: () => f.page.path.startsWith("/c/local-chatgpt") ? 1 : 2 });
    await expect(transport.port.run(turn().turn)).rejects.toMatchObject({ code: "companion_response_unobserved" });
    expect(transport.status().held).toMatchObject({ stage: "response", reason: "the bound tab navigated to another conversation" });
    expect(f.page.sends).toBe(1);
  } finally { await f.close(); }
  // Once the saved conversation is pinned, a later move to another conversation is still held.
  f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    f.page.answerAfterReads = 4;
    newChatNavigation(f, { savedAfterReads: 1 });
    const previous = f.setHandler(command => {
      if (command.chatgpt?.op === "read" && f.page.reads >= 2) f.page.path = "/c/another-conversation";
      return previous(command);
    });
    await expect(transport.port.run(turn().turn)).rejects.toMatchObject({ code: "companion_response_unobserved" });
    expect(transport.status().held).toMatchObject({ reason: "the bound tab navigated to another conversation" });
  } finally { await f.close(); }
  // Leaving for a project conversation or back to a new chat is never the send's own transition.
  for (const savedPath of ["/g/g-p-project/c/6ad9031a", "/"]) {
    f = await companion();
    try {
      const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
      await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
      f.page.answerAfterReads = 3;
      newChatNavigation(f, { savedAfterReads: 1, savedPath });
      await expect(transport.port.run(turn().turn)).rejects.toMatchObject({ code: "companion_response_unobserved" });
      expect(transport.status().held).toMatchObject({ reason: "the bound tab left the new conversation" });
    } finally { await f.close(); }
  }
});

test("an extension that cannot report user turns is refused before the send fence", async () => {
  const f = await companion({ features: ["chatgpt-v1"] });
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    const { turn: request, calls } = turn();
    await expect(transport.port.run(request)).rejects.toMatchObject({ code: "companion_extension_outdated" });
    expect(calls.activated).toBe(0);
    expect(sends(f.commands)).toHaveLength(0); expect(f.page.sends).toBe(0);
    expect(transport.status().held).toBeNull();
  } finally { await f.close(); }
});

test("an in-flight companion turn stays active through Unbind, and a busy slot refuses before the send fence", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    f.page.answerAfterReads = 5;
    const running = transport.port.run(turn().turn);
    while (!f.commands.some(command => command.chatgpt?.op === "read")) await new Promise(resolve => setTimeout(resolve, 5));
    transport.unbind();
    // A later opted-in turn cannot start a second send while this one is still settling.
    expect(transport.status().state).toBe("sending");
    await expect(transport.port.run(turn().turn)).rejects.toMatchObject({ code: "companion_busy" });
    expect(await running).toBe("Hello from **ChatGPT**");
    expect(transport.status().state).toBe("unbound");
    // Another approved operation owns the host slot: refused before onSendActivated.
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    const previous = f.setHandler(command => command.kind === "observe" ? "drop" : previous(command));
    const observing = new AbortController();
    const observe = f.host.observe(f.host.status().selected!, observing.signal);
    while (!f.commands.some(command => command.kind === "observe")) await new Promise(resolve => setTimeout(resolve, 5));
    const busy = turn();
    await expect(transport.port.run(busy.turn)).rejects.toMatchObject({ code: "companion_busy" });
    expect(busy.calls.activated).toBe(0);
    observing.abort(); expect((await observe).outcome).toBe("unknown");
    expect(f.page.sends).toBe(1);
  } finally { await f.close(); }
});

test("account, tab, model and turn mismatches are refused before anything is sent", async () => {
  const f = await companion();
  try {
    const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
    await expect(transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max", account: OTHER_ACCOUNT })).rejects.toThrow("different account");
    await expect(transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max", selector: "button" })).rejects.toThrow();
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    // The opt-in names the bound account: another (or a malformed) fingerprint is refused unprepared.
    const otherAccount = turn({ companionAccount: OTHER_ACCOUNT.slice(0, 12) });
    await expect(transport.port.run(otherAccount.turn)).rejects.toMatchObject({ code: "companion_account_mismatch", retryable: false });
    const malformed = turn({ companionAccount: ACCOUNT });
    await expect(transport.port.run(malformed.turn)).rejects.toMatchObject({ code: "companion_account_mismatch" });
    // Model selection is explicit: another requested mode is refused without preparing a prompt.
    const model = turn({ reasoning: "high" });
    await expect(transport.port.run(model.turn)).rejects.toMatchObject({ code: "companion_model_mismatch" });
    const family = turn({ modelFamily: "5.5" });
    await expect(transport.port.run(family.turn)).rejects.toMatchObject({ code: "companion_model_mismatch" });
    const tools = turn({ externalProgress: {} as BrowserTurn["externalProgress"], completionFence: { begin: async () => ({ revision: 0 }) as never, commit: async () => true } });
    await expect(transport.port.run(tools.turn)).rejects.toMatchObject({ code: "companion_turn_unsupported" });
    const attachment = turn({ prepare: async () => ({ text: "x", images: [{ mimeType: "image/png", data: "", detail: "auto" } as never], release: () => {} }) });
    await expect(transport.port.run(attachment.turn)).rejects.toMatchObject({ code: "companion_turn_unsupported" });
    expect([otherAccount, malformed, model, family, tools].every(row => row.calls.prepare === 0 && row.calls.activated === 0)).toBe(true);
    // The page reports another signed-in account: refused by the document, executed nothing.
    f.page.account = OTHER_ACCOUNT;
    const account = turn();
    await expect(transport.port.run(account.turn)).rejects.toMatchObject({ code: "companion_send_refused" });
    expect(transport.status().held).toBeNull(); expect(f.page.sends).toBe(0);
    f.page.account = ACCOUNT;
    // Another tab/document selection after binding is refused before dispatch.
    await f.select("scope-2", "document-2");
    const tab = turn();
    await expect(transport.port.run(tab.turn)).rejects.toMatchObject({ code: "companion_tab_mismatch" });
    expect(tab.calls.prepare).toBe(0);
    expect(sends(f.commands)).toHaveLength(1); expect(f.page.sends).toBe(0);
  } finally { await f.close(); }
});

test("outdated extension and non-ChatGPT documents cannot be bound or receive a send", async () => {
  const outdated = await companion({ features: [] });
  try {
    const transport = createCompanionChatGptTransport({ host: () => outdated.host, timing: fast });
    await expect(transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" })).rejects.toThrow("does not support ChatGPT send");
    const selected = outdated.host.status().selected!;
    expect(() => outdated.host.chatgpt(selected, { op: "send", text: "x", expectedAccount: ACCOUNT, expectedModelLabel: "Pro" })).toThrow("does not support ChatGPT send");
    expect(outdated.commands).toHaveLength(0);
  } finally { await outdated.close(); }
  const foreign = await companion({ url: "https://example.com/" });
  try {
    const transport = createCompanionChatGptTransport({ host: () => foreign.host, timing: fast });
    await expect(transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" })).rejects.toThrow("chatgpt.com");
    expect(foreign.commands).toHaveLength(0);
  } finally { await foreign.close(); }
});

test("host protocol accepts only the exact ChatGPT receipt for the delivered bundled operation", async () => {
  const f = await companion();
  f.setHandler(() => "drop");
  try {
    const selected = f.host.status().selected!;
    expect(() => f.host.chatgpt(selected, { op: "evaluate", script: "anything" })).toThrow();
    expect(() => f.host.chatgpt(selected, { op: "read", userMessageId: "message:1", selector: "body" })).toThrow();
    const reading = f.host.chatgpt(selected, { op: "read", userMessageId: "message:1" });
    while (!f.commands.length) await new Promise(resolve => setTimeout(resolve, 5));
    const command = f.commands[0]!;
    expect(command).toMatchObject({ kind: "chatgpt", chatgpt: { op: "read", userMessageId: "message:1" } });
    // A read can never claim input execution, a different operation or a generic observation.
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: true, chatgpt: { op: "read", path: "/", userTurnFound: false, generating: false } } })).status).toBe(400);
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: false, chatgpt: { op: "send", userMessageId: "message:2", path: "/" } } })).status).toBe(400);
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: false } })).status).toBe(400);
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: false, chatgpt: { op: "read", path: "/", userTurnFound: false, generating: false } } })).status).toBe(200);
    expect((await reading).chatgpt).toMatchObject({ op: "read", userTurnFound: false });
    // A send result must report execution when completed; a rejection cannot claim it.
    const sending = f.host.chatgpt(selected, { op: "send", text: "x", expectedAccount: ACCOUNT, expectedModelLabel: "Pro" });
    while (f.commands.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
    const send = f.commands[1]!;
    expect((await f.post("result", { result: { operationId: send.operationId, outcome: "rejected", executed: true } })).status).toBe(400);
    expect((await f.post("result", { result: { operationId: send.operationId, outcome: "completed", executed: false, chatgpt: { op: "send", userMessageId: "message:2", path: "/c/1" } } })).status).toBe(400);
    expect((await f.post("result", { result: { operationId: send.operationId, outcome: "completed", executed: true, chatgpt: { op: "send", userMessageId: "message:2", path: "/c/1" } } })).status).toBe(200);
    expect(await sending).toMatchObject({ outcome: "completed", executed: true });
    // Consumed operation identities are never accepted again.
    expect(() => f.host.chatgpt(selected, { op: "read", userMessageId: "message:2" }, undefined, send.operationId)).toThrow("already consumed");
  } finally { await f.close(); }
});

function embeddedWorker(embedded: string[]) {
  return Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { browserHost: "managed-chrome" }, activeRuns: new Map(),
    runExclusive: async (request: BrowserTurn) => { embedded.push(request.traceId); return "embedded answer"; },
  }) as ChatGptBrowserWorker;
}

test("the existing worker run owner routes only opted-in turns to the companion, with no parallel sender", async () => {
  const routed: string[] = [], embedded: string[] = [];
  const uninstall = installChatGptCompanionTransport({ run: async request => { routed.push(request.traceId); await new Promise(resolve => setTimeout(resolve, 10)); return "answer"; } });
  try {
    expect(() => installChatGptCompanionTransport({ run: async () => "" })).toThrow("already installed");
    const worker = embeddedWorker(embedded);
    const request = turn().turn;
    const running = worker.run(request);
    // The same registry still refuses a duplicate of the in-flight turn.
    await expect(worker.run(request)).rejects.toThrow("Duplicate");
    expect(await running).toBe("answer");
    expect(routed).toEqual([request.traceId]);
    // A turn without the opt-in keeps the embedded sender, whatever the companion state.
    const unrelated = turn({ companionAccount: undefined }).turn;
    expect(await worker.run(unrelated)).toBe("embedded answer");
    expect(embedded).toEqual([unrelated.traceId]); expect(routed).toHaveLength(1);
  } finally { uninstall(); }
  // Without an installed companion an opted-in turn is refused, never sent through the embedded page.
  expect(chatGptCompanionTransport()).toBeUndefined();
  await expect(embeddedWorker(embedded).run(turn().turn)).rejects.toMatchObject({ code: "companion_unavailable", retryable: false });
  expect(embedded).toHaveLength(1);
});

test("a bound, sending or held companion tab captures no other client's turn", async () => {
  const f = await companion();
  const transport = createCompanionChatGptTransport({ host: () => f.host, timing: fast });
  const uninstall = installChatGptCompanionTransport(transport.port);
  const embedded: string[] = [];
  const worker = embeddedWorker(embedded);
  try {
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    // Bound: same model and effort, but no opt-in (another client, account or task) stays embedded.
    const unrelated = turn({ companionAccount: undefined });
    expect(await worker.run(unrelated.turn)).toBe("embedded answer");
    expect(unrelated.calls.prepare).toBe(0); expect(f.page.sends).toBe(0);
    // Sending: an unrelated turn runs beside the companion send without touching the tab.
    f.page.answerAfterReads = 5;
    const opted = worker.run(turn().turn);
    while (!f.commands.some(command => command.chatgpt?.op === "read")) await new Promise(resolve => setTimeout(resolve, 5));
    expect(transport.status().state).toBe("sending");
    expect(await worker.run(turn({ companionAccount: undefined }).turn)).toBe("embedded answer");
    expect(await opted).toBe("Hello from **ChatGPT**");
    expect(f.page.sends).toBe(1);
    // Held: only opted-in turns are refused; others keep the embedded path, and nothing is resent.
    await transport.bind({ modelId: "gpt-5.6-sol", reasoning: "max" });
    const previous = f.setHandler(command => command.chatgpt?.op === "send" ? "drop" : previous(command));
    await expect(worker.run(turn().turn)).rejects.toMatchObject({ code: "companion_outcome_unknown" });
    expect(transport.status().state).toBe("held");
    await expect(worker.run(turn().turn)).rejects.toMatchObject({ code: "companion_outcome_held" });
    expect(await worker.run(turn({ companionAccount: undefined }).turn)).toBe("embedded answer");
    expect(embedded).toHaveLength(3);
    expect(sends(f.commands)).toHaveLength(2);
  } finally { uninstall(); await f.close(); }
});
