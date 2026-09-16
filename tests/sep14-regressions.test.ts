import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CHATGPT_STOPPED_THINKING_LABELS } from "../src/adapters/chatgpt-web/ui-labels";
import { chatGptModelStateMatches } from "../src/chatgpt-session";
import { forwardNativeCodexRequest } from "../src/native-passthrough";
import { rememberRetryableTurnFailure, isAcceptedRetryContinuation, clearRetryableTurnHandoff } from "../src/adapters/chatgpt-web/retry-continuation";
import type { CodexParsedRequest } from "../src/types";

test("contradictory model descriptions cannot authorize a pinned send", () => {
  expect(chatGptModelStateMatches(["5.6 Pro, item 5", "6 Pro, item 5"], "5.6", true)).toBeFalse();
  expect(chatGptModelStateMatches(["5.6 Pro, item 5", "Use arrow keys"], "5.6", true, "max")).toBeTrue();
  expect(chatGptModelStateMatches(["5.6 High, item 3"], "5.6", false, "medium")).toBeFalse();
});

test("French stopped-thinking UI is terminal while quoted answer text remains content", () => {
  const { createDocument } = require("@mixmark-io/domino");
  const source = readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8").split("// CHATGPT_STOPPED_THINKING_BEGIN")[1]!.split("// CHATGPT_STOPPED_THINKING_END")[0]!;
  const detect = new Function("root", "overlapsRenderedAnswer", "overlapsCommentary", "renderedInDom", "document", "NodeFilter", "options", new Bun.Transpiler({ loader: "ts" }).transformSync(source) + "; return stoppedThinkingVisible;");
  const document = createDocument('<section id="turn"><button aria-label="Réflexion interrompue"></button></section>');
  const root = document.getElementById("turn");
  const query = root.querySelectorAll.bind(root);
  Object.defineProperty(root, "querySelectorAll", { value: (selector: string) => Array.from(query(selector)) });
  const options = { stoppedThinkingLabels: CHATGPT_STOPPED_THINKING_LABELS };
  expect(detect(root, () => false, () => false, () => true, document, { SHOW_TEXT: 4 }, options)).toBeTrue();
  expect(detect(root, () => true, () => false, () => true, document, { SHOW_TEXT: 4 }, options)).toBeFalse();
});

test("the native passthrough consumes its own proxy without changing destination or authorization", async () => {
  const previousFetch = globalThis.fetch;
  const previousProxy = process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY;
  let captured: { url: string; authorization: string | null; proxy: unknown } | undefined;
  process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY = "http://localhost:8888";
  globalThis.fetch = (async (request: Request, options: any) => {
    captured = { url: request.url, authorization: request.headers.get("authorization"), proxy: options?.proxy };
    return new Response('{"models":[]}');
  }) as typeof fetch;
  try {
    await forwardNativeCodexRequest(new Request("http://127.0.0.1:17841/v1/models", { headers: { authorization: "Bearer fixture-only" } }), "models");
    expect(captured).toEqual({ url: "https://chatgpt.com/backend-api/codex/models", authorization: "Bearer fixture-only", proxy: "http://localhost:8888" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProxy === undefined) delete process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY;
    else process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY = previousProxy;
  }
});

test("retry handoff accepts one exact successor and refuses changed or unrelated instructions", () => {
  const parsed = { modelId: "gpt-5.6-sol", options: { reasoning: "high" } } as CodexParsedRequest;
  const source = { turnId: "failed-turn", itemId: "human-message", content: "Read the fixture" };
  const origin = { threadId: "retry-fixture", turnId: "failed-turn" };
  const successor = { ...origin, turnId: "successor" };
  expect(isAcceptedRetryContinuation(parsed, successor, source)).toBeFalse();
  rememberRetryableTurnFailure(parsed, origin, source);
  expect(isAcceptedRetryContinuation(parsed, successor, source)).toBeTrue();
  expect(isAcceptedRetryContinuation(parsed, { ...successor, threadId: "different-thread" }, source)).toBeFalse();
  expect(isAcceptedRetryContinuation(parsed, { ...successor, turnId: "second-successor" }, source)).toBeFalse();
  rememberRetryableTurnFailure(parsed, origin, source);
  expect(isAcceptedRetryContinuation(parsed, successor, { ...source, content: "Different instruction" })).toBeFalse();
  clearRetryableTurnHandoff(parsed, origin);
});
