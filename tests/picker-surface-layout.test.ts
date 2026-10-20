import { afterEach, expect, setSystemTime, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { CHATGPT_TURN_SURFACE_LAYOUT_TIMEOUT_MS } from "../src/adapters/chatgpt-web/browser-model-selection";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";

afterEach(() => { setSystemTime(); });

interface Surface { width: number; height: number; bound?: boolean }

const UNBOUND_ZERO: Surface = { width: 0, height: 0 };
const LAID_OUT: Surface = { width: 1728, height: 994, bound: true };

/** Runs the real probe function against one synthetic page state, as Playwright would in the page. */
function inPage<T>(surface: Surface, pageFunction: (element: unknown) => T): T {
  const scope = globalThis as Record<string, unknown>;
  const keys = ["document", "innerWidth", "innerHeight", "__CODEX_WEB_GPT_SURFACE_ID__"];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(scope, key)] as const);
  Object.assign(scope, { document: { readyState: "interactive" }, innerWidth: surface.width, innerHeight: surface.height });
  if (surface.bound) scope.__CODEX_WEB_GPT_SURFACE_ID__ = "synthetic-surface";
  else delete scope.__CODEX_WEB_GPT_SURFACE_ID__;
  try {
    // As in trace f5133e3e22a7: the control keeps its size, but at 0x0 it sits left of the viewport.
    return pageFunction({ getBoundingClientRect: () => ({ x: surface.width ? 1257.7 : -71.5, y: 71, width: 72.5, height: 36 }) });
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(scope, key, descriptor);
      else delete scope[key];
    }
  }
}

function pickerFixture(surfaces: Surface[], onProbe?: (probe: number) => void) {
  const checkpoints: string[] = [];
  const events: string[] = [];
  let probes = 0;
  // No rate-limit dialog, expired session or other page guard is present.
  const absent: any = {
    filter() { return this; }, last() { return this; }, first() { return this; }, getByRole() { return this; },
    isVisible: async () => false,
    count: async () => 0,
    waitFor: (options: { signal?: AbortSignal } = {}) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    }),
  };
  const control: any = {
    filter() { return this; },
    waitFor: async () => {},
    getAttribute: async (name: string) => name === "aria-expanded" ? "false" : name === "data-state" ? "closed" : null,
    evaluate: async (pageFunction: (element: unknown) => unknown) => {
      const surface = surfaces[Math.min(probes, surfaces.length - 1)]!;
      probes += 1;
      events.push(`probe ${surface.width}x${surface.height}`);
      onProbe?.(probes);
      return inPage(surface, pageFunction);
    },
    click: async () => {
      events.push("picker opened");
      throw new Error("Synthetic picker opened");
    },
  };
  const composer: any = { locator: () => ({ locator: () => control }) };
  const page: any = { url: () => "https://chatgpt.com/", locator: () => absent };
  const worker: any = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    activeComposer: async () => composer,
  });
  return {
    select: (signal?: AbortSignal) => worker.selectModelAndEffort(
      page, CHATGPT_WEB_MODEL_ID, "low", { localToolsEnabled: false, solAvailable: true, proAvailable: false },
      async (checkpoint: string) => { checkpoints.push(checkpoint); }, "5.6", signal, "low",
    ),
    checkpoints,
    events,
  };
}

test("the model picker waits until the new turn surface has a viewport", async () => {
  const fixture = pickerFixture([UNBOUND_ZERO, UNBOUND_ZERO, { width: 1728, height: 994 }]);
  await expect(fixture.select()).rejects.toThrow("Synthetic picker opened");
  expect(fixture.events).toEqual(["probe 0x0", "probe 0x0", "probe 1728x994", "picker opened"]);
  expect(fixture.checkpoints).toEqual(["effort-control-ready", "turn-surface-laid-out"]);
});

test("the launcher surface marker also ends the wait", async () => {
  const fixture = pickerFixture([UNBOUND_ZERO, { ...UNBOUND_ZERO, bound: true }]);
  await expect(fixture.select()).rejects.toThrow("Synthetic picker opened");
  expect(fixture.events).toEqual(["probe 0x0", "probe 0x0", "picker opened"]);
  expect(fixture.checkpoints).toEqual(["effort-control-ready", "turn-surface-bound"]);
});

test("a surface that never lays out stops the wait at its bound and the picker still opens", async () => {
  const start = Date.UTC(2026, 9, 20, 14, 3, 12);
  const step = CHATGPT_TURN_SURFACE_LAYOUT_TIMEOUT_MS / 2 + 1;
  setSystemTime(new Date(start));
  // Each probe advances the frozen clock past half the bound, so the bound passes on the second.
  const fixture = pickerFixture([UNBOUND_ZERO], probe => setSystemTime(new Date(start + probe * step)));
  await expect(fixture.select()).rejects.toThrow("Synthetic picker opened");
  expect(fixture.events).toEqual(["probe 0x0", "probe 0x0", "picker opened"]);
  expect(fixture.checkpoints).toEqual(["effort-control-ready", "turn-surface-layout-timeout"]);
});

test("an aborted turn stops the layout wait without opening the picker", async () => {
  const controller = new AbortController();
  const fixture = pickerFixture([UNBOUND_ZERO], probe => { if (probe === 2) controller.abort(); });
  await expect(fixture.select(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fixture.events).toEqual(["probe 0x0", "probe 0x0"]);
  expect(fixture.checkpoints).toEqual(["effort-control-ready"]);
});

test("an already laid-out surface opens the picker after one probe", async () => {
  const fixture = pickerFixture([LAID_OUT]);
  await expect(fixture.select()).rejects.toThrow("Synthetic picker opened");
  expect(fixture.events).toEqual(["probe 1728x994", "picker opened"]);
  expect(fixture.checkpoints).toEqual(["effort-control-ready", "turn-surface-laid-out"]);
});
