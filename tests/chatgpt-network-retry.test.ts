import { expect, test } from "bun:test";
import {
  ChatGptBrowserWorker, chatGptNavigationRetryDelayMs, chatGptNavigationRetryReason,
} from "../src/adapters/chatgpt-web/browser-worker";

const URL = "https://chatgpt.com/";
const networkError = (code: string) => new Error(`page.goto: net::${code} at ${URL}\nCall log:\n  - navigating to "${URL}"`);

test("dropped or timed-out connections are retryable, a superseded navigation is not", () => {
  expect(chatGptNavigationRetryReason(networkError("ERR_TIMED_OUT"))).toBe("net::ERR_TIMED_OUT");
  expect(chatGptNavigationRetryReason(networkError("ERR_CONNECTION_CLOSED"))).toBe("net::ERR_CONNECTION_CLOSED");
  expect(chatGptNavigationRetryReason(networkError("ERR_INTERNET_DISCONNECTED"))).toBe("net::ERR_INTERNET_DISCONNECTED");
  expect(chatGptNavigationRetryReason(Object.assign(new Error("Timeout 30000ms exceeded"), { name: "TimeoutError" })))
    .toBe("page load timed out");
  expect(chatGptNavigationRetryReason(networkError("ERR_ABORTED"))).toBeNull();
  expect(chatGptNavigationRetryReason(new Error("ChatGPT login is expired"))).toBeNull();
});

test("retry pauses grow and stop once the five-minute budget cannot fit another attempt", () => {
  expect(chatGptNavigationRetryDelayMs(1, 0)).toBe(3_000);
  expect(chatGptNavigationRetryDelayMs(2, 10_000)).toBe(6_000);
  expect(chatGptNavigationRetryDelayMs(9, 100_000)).toBe(30_000);
  expect(chatGptNavigationRetryDelayMs(9, 250_000)).toBeNull();
});

function worker(failures: Error[]) {
  const notes: string[] = [];
  const waits: number[] = [];
  let navigations = 0;
  const page: any = { goto: async () => { navigations++; const failure = failures.shift(); if (failure) throw failure; } };
  const instance: any = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    waitBeforeNetworkRetry: async (delayMs: number) => { waits.push(delayMs); },
  });
  return { open: (signal?: AbortSignal) => instance.openChatGptWithNetworkRetry(page, URL, signal, (note: string) => notes.push(note)),
    notes, waits, navigations: () => navigations };
}

test("a new chat keeps retrying through a network drop and says so", async () => {
  const run = worker([networkError("ERR_TIMED_OUT"), networkError("ERR_CONNECTION_CLOSED")]);
  await run.open();
  expect(run.navigations()).toBe(3);
  expect(run.waits).toEqual([3_000, 6_000]);
  expect(run.notes).toEqual([
    "ChatGPT is unreachable (net::ERR_TIMED_OUT); nothing was sent. Retrying in 3 s (attempt 2).",
    "ChatGPT is unreachable (net::ERR_CONNECTION_CLOSED); nothing was sent. Retrying in 6 s (attempt 3).",
    "ChatGPT is reachable again; continuing the task.",
  ]);
});

test("other failures and cancellation are not retried", async () => {
  const other = worker([new Error("ChatGPT returned an error page")]);
  await expect(other.open()).rejects.toThrow("error page");
  expect(other.navigations()).toBe(1);
  const controller = new AbortController();
  controller.abort();
  const aborted = worker([networkError("ERR_TIMED_OUT")]);
  await expect(aborted.open(controller.signal)).rejects.toThrow();
  expect(aborted.notes).toEqual([]);
});
