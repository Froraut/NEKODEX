import { expect, test } from "bun:test";
import type { Page } from "playwright-core";
import {
  ChatGptBrowserWorker,
  chatGptProUnavailableAdapterError,
  throwIfChatGptEffortCapabilityDialog,
  throwIfChatGptTerminalErrorAlert,
} from "../src/adapters/chatgpt-web/browser-worker";

function rateLimitPage(visible: boolean): { page: Page; acknowledged: string[] } {
  const acknowledged: string[] = [];
  const button = {
    last: () => button,
    isVisible: async () => visible,
    press: async (key: string) => { acknowledged.push(key); },
  };
  const dialog = {
    filter: () => dialog,
    last: () => dialog,
    isVisible: async () => visible,
    getByRole: () => button,
  };
  return { page: { locator: () => dialog } as unknown as Page, acknowledged };
}

function responseTextScope(text: string): Page {
  const match = (pattern: string | RegExp): boolean => typeof pattern === "string"
    ? text.includes(pattern)
    : pattern.test(text);
  const textLocator = (pattern: string | RegExp) => {
    const locator = {
      last: () => locator,
      isVisible: async () => match(pattern),
    };
    return locator;
  };
  const absent = {
    last: () => absent,
    isVisible: async () => false,
  };
  return {
    getByText: (pattern: string | RegExp) => textLocator(pattern),
    getByTestId: () => absent,
  } as unknown as Page;
}

test("an explicit Pro retry date is a typed non-retryable account limit without effort fallback", () => {
  const error = chatGptProUnavailableAdapterError(
    "ChatGPT effort slider does not expose Pro item index 4 (min=0; max=3)",
    "Try again after Sep 22, 2026.",
  );

  expect(error).toMatchObject({
    name: "ChatGptWebAdapterError",
    status: 429,
    errorType: "rate_limit_error",
    code: "chatgpt_pro_unavailable",
    retryable: false,
  });
  expect(error.message).toContain("Try again after Sep 22, 2026.");
  expect(error.message).toContain("No lower-effort fallback was used.");
  expect(error.cause).toBeInstanceOf(Error);
});

test("missing Pro without limit evidence remains an ambiguous capability conflict", () => {
  const error = chatGptProUnavailableAdapterError(
    "ChatGPT effort slider does not expose Pro item index 4 (min=0; max=3)",
  );

  expect(error).toMatchObject({
    status: 409,
    errorType: "invalid_request_error",
    code: "chatgpt_pro_unavailable",
    retryable: false,
  });
  expect(error.message).toContain("account capability changes");
  expect(error.message).toContain("No lower-effort fallback was used.");
});

test("the exact collapsed Thinking failed status is structured but never clicked", async () => {
  await expect(throwIfChatGptTerminalErrorAlert(responseTextScope("Thinking failed ›")))
    .rejects.toMatchObject({
      name: "ChatGptWebAdapterError",
      status: 502,
      errorType: "server_error",
      code: "upstream_server_error",
      retryable: true,
      message: "ChatGPT ended the turn with 'Thinking failed'. Retry the turn.",
    });

  await expect(throwIfChatGptTerminalErrorAlert(
    responseTextScope("The phrase Thinking failed appears in this answer."),
  )).resolves.toBeUndefined();
});

test("a post-selection blocking dialog is a capability failure without effort fallback", async () => {
  const dialogs = {
    filter: () => dialogs,
    count: async () => 1,
  };
  const page = { locator: () => dialogs } as unknown as Page;
  await expect(throwIfChatGptEffortCapabilityDialog(page, { displayLabel: "Extra High" }))
    .rejects.toMatchObject({
      status: 403,
      errorType: "permission_error",
      code: "model_effort_unavailable",
      retryable: false,
      message: expect.stringContaining("requested Extra High effort"),
    });

  const controller = new AbortController();
  controller.abort();
  await expect(throwIfChatGptEffortCapabilityDialog(page, { displayLabel: "Extra High" }, controller.signal))
    .rejects.toMatchObject({ name: "AbortError" });
});

test("a rate-limit dialog blocks mutation of the next multipart composer", async () => {
  const fixture = rateLimitPage(true);
  let attached = false;
  const attachMultipartStagePrompt = (ChatGptBrowserWorker.prototype as unknown as {
    attachMultipartStagePrompt(page: Page, prompt: string): Promise<void>;
  }).attachMultipartStagePrompt;

  await expect(attachMultipartStagePrompt.call(Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    attachPrompt: async () => { attached = true; },
  }), fixture.page, "stage two"))
    .rejects.toMatchObject({
      name: "ChatGptWebAdapterError",
      status: 429,
      code: "rate_limit_exceeded",
      retryable: false,
    });

  expect(attached).toBeFalse();
  expect(fixture.acknowledged).toEqual(["Enter"]);
});

test("multipart attachment proceeds when no rate-limit dialog is visible", async () => {
  const fixture = rateLimitPage(false);
  const calls: unknown[][] = [];
  const attachMultipartStagePrompt = (ChatGptBrowserWorker.prototype as unknown as {
    attachMultipartStagePrompt(
      page: Page,
      prompt: string,
      captureDiagnostic?: (checkpoint: string) => Promise<void>,
      abortSignal?: AbortSignal,
    ): Promise<void>;
  }).attachMultipartStagePrompt;
  const signal = new AbortController().signal;
  const capture = async () => {};

  await attachMultipartStagePrompt.call(Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    attachPrompt: async (...args: unknown[]) => { calls.push(args); },
  }), fixture.page, "stage two", capture, signal);

  expect(calls).toEqual([[fixture.page, "stage two", false, capture, signal]]);
  expect(fixture.acknowledged).toEqual([]);
});
