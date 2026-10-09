import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { defaultConfig } from "../src/config";
import { parseChatCompletion } from "../src/chat-completions/contract";
import { NativeChatCompletionBridge } from "../src/chat-completions/native-bridge";
import { publicChatError } from "../src/chat-completions/http";
import { ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { ChatGptTextFeed, ChatGptTraceFeed } from "../src/adapters/chatgpt-web/turn-feeds";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { AccountOperationLeases } = require("../launcher/electron/account-operation-leases.cjs");

test("the API tool bridge preserves a never-sent account failure and does not turn it into a retried 502", async () => {
  const message = "No request was sent: Primary has no tool tunnel";
  let calls = 0;
  const bridge = new NativeChatCompletionBridge(async () => {
    calls++;
    return Response.json({ status: "failed", error: { code: "account_not_ready", message } });
  });
  const input = parseChatCompletion({ model: "chatgpt-web/gpt-5.6-sol", messages: [{ role: "user", content: "Hello" }],
    tools: [{ type: "function", function: { name: "echo", parameters: { type: "object", properties: {} } } }] });
  let failure: unknown;
  try { await bridge.execute(input, defaultConfig("full"), new AbortController().signal, () => {}); }
  catch (error) { failure = error; }
  expect(calls).toBe(1);
  expect(publicChatError(failure)).toMatchObject({ status: 400, body: { error: { code: "account_not_ready", message } } });
});

test("forgetting an unsent round preserves the retained conversation and allows another attempt", async () => {
  const sessions = new ChatGptTurnSessions();
  const key = "a".repeat(64);
  let releases = 0;
  const runtime = (browser: Promise<string>) => ({ mode: "read-only" as const, browser,
    physicalSettlement: browser.then(() => {}, () => {}), trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(),
    conversationKey: key, releaseRetainedConversation: async () => { releases++; }, cancel: () => {} });
  const first = sessions.getOrCreate("first", () => runtime(Promise.resolve("answer")), "first", "owner");
  await first.browserOutcome;
  const failed = sessions.getOrCreate("second", () => runtime(Promise.reject(new ChatGptWebAdapterError("not ready", {
    status: 409, code: "account_not_ready", retryable: false,
  }))), "second", "owner");
  await failed.browserOutcome;
  failed.cancel();
  expect(sessions.forget("second", failed)).toBe(true);
  expect(sessions.find("second")).toBeUndefined();
  expect(sessions.find("first")).toBe(first);
  expect(sessions.findConversationHead(key)).toBe(first);
  expect(first.conversationKey()).toBe(key);
  const next = sessions.getOrCreate("second", () => runtime(Promise.resolve("retry answer")), "retry", "owner");
  await next.browserOutcome;
  expect(next).not.toBe(failed);
  expect(releases).toBe(0);
});

// Only browser observations are stubbed. Scheduling, admission and evidence ownership use the pool.
function restorePool() {
  const caps = { solAvailable: true, modelCapabilities: { families: { "5.6": ["low"] }, names: {} } };
  let busy = true, ready = false, checks = 0;
  const host: any = { state: { authenticated: true }, turnTabs: new Map(), activeTraceId: null,
    currentOperation: () => busy ? "sign-in" : null, ready: async () => {},
    inspectSession: async () => { checks++; return caps; },
    verifyConnector: async () => ({ ok: true }), connectorName: () => "Codex Native6",
    exactRetainedTurnTab: () => undefined };
  const pool = Object.create(AccountBrowserPool.prototype);
  Object.assign(pool, { hosts: new Map([["default", host]]), destroyed: false, inspectionsPaused: false,
    registry: { snapshot: () => ({ mode: "selected", selectedId: "default", accounts: [{ id: "default", enabled: true }] }) },
    getHost: () => host, publish: () => {}, accountSnapshot: () => ({}), accountOperationLabel: () => host.currentOperation(),
    capabilities: new Map(), connectors: new Map(), capabilityObservedAt: new Map(), evidenceEpochs: new Map(),
    evidenceRefreshing: new Set(), evidenceRestores: new Map(), authenticationRefreshOperations: new Map(),
    reservations: new Map(), traceOwners: new Map(), affinity: new Map(), pendingAffinity: new Map(),
    taskLedgers: new Map(), turnAdmission: { open: true }, initializingHosts: false,
    admissionQueue: { accountPaused: () => false }, safety: { availability: () => ({ eligible: true }) },
    options: { maxTabs: 16, getBrowserInteractionMode: () => "automatic", bootstrapAccountConnectors: () => true,
      getAccountTunnel: () => ({ required: true, ready, status: ready ? "ready" : "starting" }) },
    logger: { warn() {} }, recordCapabilityEvidence: (_id: string, evidence: any) => pool.capabilities.set("default", evidence) });
  pool.operationLeases = new AccountOperationLeases();
  pool.writeDescriptor = () => {};
  Object.defineProperty(pool, "turnTabs", { get: () => host.turnTabs });
  return { pool, host, idle: () => { busy = false; }, ready: () => { ready = true; }, checks: () => checks };
}

async function withScheduledWaits(run: (advance: () => Promise<void>) => Promise<void>) {
  const original = globalThis.setTimeout;
  const waits: Array<() => void> = [];
  globalThis.setTimeout = ((callback: () => void) => {
    waits.push(callback);
    return { unref() {} };
  }) as any;
  const advance = async () => {
    waits.shift()?.();
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  try { await run(advance); } finally { globalThis.setTimeout = original; }
}

test.serial("sign-in evidence restoration survives a long user operation", async () => {
  await withScheduledWaits(async advance => {
    const h = restorePool(); h.ready();
    h.pool.scheduleEvidenceRestore("default");
    // More than the former 45 x 2-second limit; no wall-clock wait or browser request.
    for (let i = 0; i < 50; i++) await advance();
    expect(h.checks()).toBe(0);
    h.idle();
    await advance();
    expect(h.checks()).toBe(1);
    expect(h.pool.connectors.get("default")).toBe("Codex Native6");
    expect(h.pool.evidenceRestores.size).toBe(0);
  });
});

test.serial("waiting for a tunnel keeps its real admission cause and checks when it eventually starts", async () => {
  await withScheduledWaits(async advance => {
    const h = restorePool(); h.idle();
    h.pool.scheduleEvidenceRestore("default", { waitForTunnel: true });
    for (let i = 0; i < 50; i++) await advance();
    const request = { traceId: "restore_probe", key: null, retained: false, requestedModel: "chatgpt-web/gpt-5.6-sol-instant",
      effort: "low", connector: "Codex Native6", routingKey: null, requestedAccountId: "default" };
    expect(h.pool.previewAdmission(request)).toMatchObject({ reason: "account-not-ready", blocker: "account_tunnel_not_ready" });
    // Missing tools must not prevent the same account from serving a plain Web request.
    expect(h.pool.previewAdmission({ ...request, connector: null })).toBeNull();
    h.ready(); await advance();
    expect(h.pool.connectors.get("default")).toBe("Codex Native6");
    expect(h.pool.previewAdmission(request)).toBeNull();
    expect(h.pool.evidenceRestores.size).toBe(0);
  });
});

test.serial("a new sign-in during an evidence check retries the superseded check", async () => {
  await withScheduledWaits(async advance => {
    const h = restorePool(); h.idle(); h.ready();
    let attempts = 0;
    const check = h.pool.checkAccount.bind(h.pool);
    h.pool.checkAccount = async (...args: any[]) => {
      if (++attempts === 1) {
        h.pool.invalidateEvidence("default");
        h.pool.scheduleEvidenceRestore("default", { waitForTunnel: true });
        throw new Error("ChatGPT account readiness changed while checking it");
      }
      return check(...args);
    };
    h.pool.scheduleEvidenceRestore("default");
    await advance();
    expect(attempts).toBe(2);
    expect(h.pool.connectors.get("default")).toBe("Codex Native6");
    expect(h.pool.evidenceRestores.size).toBe(0);
    expect(h.pool.evidenceRefreshing.size).toBe(0);
  });
});

test.serial("explicit tunnel setup cancels and joins only its automatic account check", async () => {
  await withScheduledWaits(async advance => {
    const h = restorePool(); h.idle(); h.ready();
    const events: string[] = [];
    const normalCheck = h.pool.checkAccount.bind(h.pool);
    let rejectCheck: (error: Error) => void;
    let checking = false;
    h.host.currentOperation = () => checking ? "session inspection" : null;
    h.pool.checkAccount = async () => {
      checking = true;
      try { await new Promise((_, reject) => { rejectCheck = reject; }); }
      finally { checking = false; events.push("settled"); }
    };
    h.host.cancelReadOnlyInspection = async () => { events.push("cancel"); rejectCheck(new Error("cancelled")); };
    h.pool.scheduleEvidenceRestore("default"); await advance();
    await h.pool.withAccountTunnelMutation("default", async () => {
      expect(checking).toBe(false);
      expect(h.pool.operationLeases.exclusiveLabel("default")).toBe("tool tunnel setup");
      events.push("mutation"); return { ok: true };
    });
    expect(events).toEqual(["cancel", "settled", "mutation"]);
    h.pool.checkAccount = normalCheck;
    await advance();
    expect(h.pool.connectors.get("default")).toBe("Codex Native6");
    expect(h.pool.evidenceRestoreSuppressed.size).toBe(0);
  });
});

test.serial("a probe that repeatedly changes auth state does not monopolize the account", async () => {
  await withScheduledWaits(async advance => {
    const h = restorePool(); h.idle(); h.ready();
    let attempts = 0;
    h.pool.checkAccount = async () => {
      attempts++;
      h.pool.scheduleEvidenceRestore("default");
      throw new Error("readiness changed while checking");
    };
    h.pool.scheduleEvidenceRestore("default"); await advance();
    expect(attempts).toBe(2);
    expect(h.pool.evidenceRestores.size).toBe(0);
    expect(h.pool.evidenceRefreshing.size).toBe(0);
  });
});
