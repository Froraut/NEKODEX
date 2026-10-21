import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Page } from "playwright-core";
import { ChatGptSubmissionRejectionObserver } from "../src/adapters/chatgpt-web/browser-page-guards";
import { chatGptResponsePollDelayMs } from "../src/adapters/chatgpt-web/browser-response-policy";

test("the response loop polls when a buffered block is due, within the regular interval", () => {
  expect(chatGptResponsePollDelayMs(undefined, 1_000)).toBe(250);
  expect(chatGptResponsePollDelayMs(1_100, 1_000)).toBe(100);
  expect(chatGptResponsePollDelayMs(5_000, 1_000)).toBe(250);
  // A due or overdue block never turns the observation loop into a busy loop.
  expect(chatGptResponsePollDelayMs(1_000, 1_000)).toBe(20);
  expect(chatGptResponsePollDelayMs(900, 1_000)).toBe(20);
});

function conversationPage() {
  const events = new EventEmitter();
  const mainFrame = {};
  const page = Object.assign(events, { mainFrame: () => mainFrame, isClosed: () => false });
  const request = { method: () => "POST", url: () => "https://chatgpt.com/backend-api/f/conversation", frame: () => mainFrame };
  const response = { request: () => request, status: () => 200, headers: () => ({ "content-type": "text/event-stream" }) };
  return { page: page as unknown as Page, events, request, response };
}

test("closing this turn's conversation stream ends the observation pause at once", async () => {
  const { page, events, request, response } = conversationPage();
  const observer = new ChatGptSubmissionRejectionObserver();
  observer.begin(page);
  events.emit("request", request);
  events.emit("response", response);
  expect(observer.hasActiveResponse()).toBe(true);
  const startedAt = performance.now();
  const pause = observer.waitForStreamChange(10_000);
  // ChatGPT aborts its own fetch after [DONE], which Playwright reports as a failed request.
  setTimeout(() => events.emit("requestfailed", request), 20);
  await pause;
  expect(performance.now() - startedAt).toBeLessThan(1_000);
  expect(observer.hasActiveResponse()).toBe(false);
  observer.dispose();
});

test("an observation pause without stream activity lasts its timeout, and dispose releases it", async () => {
  const { page } = conversationPage();
  const observer = new ChatGptSubmissionRejectionObserver();
  observer.begin(page);
  const startedAt = performance.now();
  await observer.waitForStreamChange(60);
  expect(performance.now() - startedAt).toBeGreaterThanOrEqual(50);
  const pending = observer.waitForStreamChange(10_000);
  observer.dispose();
  await pending;
});
