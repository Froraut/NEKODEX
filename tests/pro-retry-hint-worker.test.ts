import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import {
  CHATGPT_EFFORT_MENU_SELECTOR,
  CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR,
} from "../src/chatgpt-session";
import { proRetryTooltipFixture } from "./fixtures/pro-retry-tooltip";

const BASE_ERROR = "ChatGPT model controls are unavailable. Reload ChatGPT and retry the task.";

function picker(options: Parameters<typeof proRetryTooltipFixture>[0] & { max?: number } = {}) {
  const tooltip = proRetryTooltipFixture(options);
  let value = 0;
  const keys: string[] = [];
  const hidden = {
    filter() { return this; }, last() { return this; }, getByText() { return this; },
    isVisible: async () => false,
    waitFor: ({ signal }: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    }),
  };
  const sliderControl = { press: async (key: string) => {
    keys.push(key);
    value += key === "ArrowRight" ? 1 : -1;
  } };
  const slider = {
    waitFor: async () => {},
    getAttribute: async (name: string) => ({
      "aria-valuemin": "0", "aria-valuemax": String(options.max ?? 3), "aria-valuenow": String(value),
    })[name] ?? null,
    locator: () => sliderControl,
  };
  const container = {
    filter() { return this; }, last() { return this; }, locator: () => slider,
    isVisible: async () => true, waitFor: async () => {},
  };
  const control = {
    last() { return this; }, waitFor: async () => {},
    getAttribute: async (name: string) => name === "aria-expanded" ? "true" : null,
  };
  const composer = { locator: () => ({ locator: () => control }) };
  const page = {
    locator: (selector: string) => {
      if (selector === CHATGPT_EFFORT_MENU_SELECTOR) return tooltip.menu;
      if (selector === CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR) return container;
      return hidden;
    },
    keyboard: { press: async () => {} },
  };
  const select = (ChatGptBrowserWorker.prototype as unknown as {
    selectModelAndEffort(...args: unknown[]): Promise<unknown>;
  }).selectModelAndEffort;
  return {
    ...tooltip,
    keys,
    value: () => value,
    select: (effort: string) => select.call(
      { activeComposer: async () => composer }, page, "gpt-5.6-sol", effort,
      { localToolsEnabled: false, solAvailable: true, extraHighAvailable: true, proAvailable: true },
    ),
  };
}

test("a linked Pro retry date reaches the existing adapter error without changing status, code or effort", async () => {
  const fixture = picker();
  const error = await fixture.select("max").catch((error: unknown) => error);
  expect(error).toMatchObject({
    message: `${BASE_ERROR} Try again after Sep 15, 2026.`,
    status: 502,
    errorType: "server_error",
    code: "upstream_server_error",
    retryable: false,
  });
  expect(fixture.hovered()).toBe(true);
  expect(fixture.keys).toEqual([]);
  expect(fixture.value()).toBe(0);
});

test.each([
  { name: "missing linked portal", mount: false },
  { name: "unlinked portal beside existing chat and tooltip dates", descriptionId: null },
])("Pro without verified retry detail retains the exact base error: $name", async options => {
  const fixture = picker(options);
  const error = await fixture.select("max").catch((error: unknown) => error);
  expect(error).toMatchObject({ message: BASE_ERROR, status: 502, code: "upstream_server_error", retryable: false });
  expect(fixture.hovered()).toBe(true);
  expect(fixture.reads).toEqual([]);
  expect(fixture.keys).toEqual([]);
});

test("Extra High selects its original effort and never hovers or reads the Pro tooltip", async () => {
  const fixture = picker();
  await expect(fixture.select("xhigh")).resolves.toMatchObject({ displayLabel: "Extra High", uiEffortIndex: 3 });
  expect(fixture.value()).toBe(3);
  expect(fixture.keys).toEqual(["ArrowRight", "ArrowRight", "ArrowRight"]);
  expect(fixture.hovered()).toBe(false);
  expect(fixture.reads).toEqual([]);
});

test("a different unavailable slider range cannot inherit a Pro retry date", async () => {
  const fixture = picker({ max: 2 });
  const error = await fixture.select("max").catch((error: unknown) => error);
  expect(error).toMatchObject({ message: BASE_ERROR, code: "upstream_server_error" });
  expect(fixture.hovered()).toBe(false);
  expect(fixture.reads).toEqual([]);
  expect(fixture.keys).toEqual([]);
});
