import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChatGptBrowserWorker,
  type BrowserTurn,
} from "../src/adapters/chatgpt-web/browser-worker";
import { settleActiveCompactionSource } from "../src/adapters/chatgpt-web/compaction-handoff";
import {
  ChatGptTextFeed,
  ChatGptTraceFeed,
  ChatGptTurnSession,
} from "../src/adapters/chatgpt-web/turn-execution";
import type { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import type { CodexParsedRequest } from "../src/types";

test("targeted cancellation reaches a pending browser-page acquisition", async () => {
  const diagnostics = mkdtempSync(join(tmpdir(), "nekodex-bridge-cancel-"));
  const controller = new AbortController();
  let acquisitionStarted!: () => void;
  const started = new Promise<void>(resolve => { acquisitionStarted = resolve; });
  let released = false;
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: {
      appName: "Codex Native6",
      browserHost: "managed-chrome",
      browserDiagnosticsPath: diagnostics,
    },
    runStage: async (
      _traceId: string,
      _stage: string,
      _timeoutMs: number,
      action: (signal: AbortSignal) => Promise<unknown>,
    ) => action(new AbortController().signal),
    pageForNewTurn: () => {
      acquisitionStarted();
      return new Promise<never>(() => {});
    },
  }) as unknown as {
    runBrowserTurn(turn: BrowserTurn): Promise<string>;
  };

  try {
    const running = worker.runBrowserTurn({
      traceId: "bridge_cancel_page_acquisition",
      modelId: "gpt-5.6-sol",
      reasoning: "high",
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
      prepare: async () => ({ text: "fixture", images: [], release: () => { released = true; } }),
      abortSignal: controller.signal,
      onTextDelta: () => {},
    });
    await started;
    controller.abort(new Error("targeted cancellation"));

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(released).toBe(true);
  } finally {
    rmSync(diagnostics, { recursive: true, force: true });
  }
});

test("compaction cancellation does not wait for a pending source capability token", async () => {
  const controller = new AbortController();
  let cancellations = 0;
  const pending = new Promise<never>(() => {});
  const source = new ChatGptTurnSession({
    mode: "tools",
    token: pending,
    externalProgress: { recordToolResult() {} } as never,
    browser: pending,
    physicalSettlement: pending,
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancellations += 1; },
  });
  const parsed = {
    modelId: "gpt-5.6-sol",
    context: { systemPrompt: [], messages: [] },
    stream: true,
    options: { reasoning: "high" },
    _compactionRequest: true,
  } as CodexParsedRequest;
  const broker = {
    requestCompaction() { throw new Error("must not request compaction after cancellation"); },
    completeTool() { throw new Error("must not deliver a tool result after cancellation"); },
    compactionDeliveryCount() { return 0; },
    revoke() {},
  } as unknown as TurnBroker;

  const settling = settleActiveCompactionSource(parsed, source, broker, controller.signal);
  await Promise.resolve();
  controller.abort(new Error("compaction owner cancelled"));

  await expect(settling).rejects.toThrow("compaction owner cancelled");
  expect(cancellations).toBe(1);
});

test("submitted compaction controls expire unless their summary is consumed", async () => {
  const { CompactionTransactionStore } = await import("../src/adapters/chatgpt-web/compaction-transaction");
  const store = new CompactionTransactionStore();
  try {
    const abandoned = store.begin("fixture-abandoned", 10);
    store.submit(abandoned.token, abandoned.handoffId, "abandoned summary");
    await Bun.sleep(20);
    await expect(store.wait(abandoned.token)).rejects.toThrow("expired");
    const current = store.begin("fixture-consumed", 1000);
    store.submit(current.token, current.handoffId, "current summary");
    expect(await store.wait(current.token)).toBe("current summary");
    await expect(store.wait(current.token)).rejects.toThrow("consumed");
  } finally { store.close(); }
});

test("retry capacity never resets an unexpired exhausted turn budget", async () => {
  const { ChatGptWebTurnRetryPolicy } = await import("../src/adapters/chatgpt-web/retry-policy");
  const { ChatGptWebAdapterError } = await import("../src/adapters/chatgpt-web/adapter-error");
  const policy = new ChatGptWebTurnRetryPolicy();
  const failure = new ChatGptWebAdapterError("fixture retry", {
    status: 503, errorType: "server_error", code: "fixture_retry", retryable: true,
  });
  for (let i = 0; i < 4; i++) policy.recordRetryableFailure("retained-turn", failure, 1000);
  for (let i = 1; i < 4096; i++) policy.recordRetryableFailure(`other-${i}`, failure, 1000);
  expect(policy.exhaustedError("new-turn", 1000)?.code).toBe("chatgpt_retry_capacity");
  expect(policy.exhaustedError("retained-turn", 1000)?.retryable).toBe(false);
  policy.clear("other-1");
  expect(policy.exhaustedError("new-turn", 1000)).toBeUndefined();
  expect(policy.exhaustedError("retained-turn", 1000)?.retryable).toBe(false);
});
