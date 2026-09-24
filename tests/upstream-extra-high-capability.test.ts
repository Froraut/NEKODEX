import { expect, test } from "bun:test";
import {
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR,
  detectChatGptAccountCapabilities,
} from "../src/chatgpt-session";

type FixtureOptions = {
  initialValue?: number;
  menuOpen?: boolean;
  gateOnExtraHigh?: boolean;
  persistExtraHigh?: boolean;
  preexistingDialog?: boolean;
  unrelatedDialogOnRestore?: boolean;
};

function extraHighFixture(options: FixtureOptions = {}) {
  const originalValue = options.initialValue ?? 1;
  let value = originalValue;
  let menuOpen = options.menuOpen ?? false;
  let probeDialogOpen = false;
  let unrelatedRestoreDialogOpen = false;
  const preexistingDialogOpen = options.preexistingDialog ?? false;
  const persistExtraHigh = options.persistExtraHigh ?? true;
  const events: string[] = [];
  let extraHighSelections = 0;

  const hidden = {
    filter() { return this; },
    last() { return this; },
    locator() { return this; },
    isVisible: async () => false,
  };
  const dialog = {
    filter() { return this; },
    last() { return this; },
    isVisible: async () => preexistingDialogOpen || probeDialogOpen || unrelatedRestoreDialogOpen,
  };
  const sliderControl = {
    press: async (key: string) => {
      events.push(key);
      value += key === "ArrowRight" ? 1 : -1;
      if (value === 3) {
        extraHighSelections += 1;
        if (options.gateOnExtraHigh) {
          probeDialogOpen = true;
          menuOpen = false;
        }
      }
      if (options.unrelatedDialogOnRestore && extraHighSelections > 0 && value === originalValue) {
        unrelatedRestoreDialogOpen = true;
        menuOpen = false;
      }
    },
  };
  const slider = {
    waitFor: async ({ state }: { state: string }) => { expect(state).toBe("attached"); },
    getAttribute: async (name: string) => ({
      "aria-valuemin": "0",
      "aria-valuemax": "3",
      "aria-valuenow": String(value),
    })[name as "aria-valuemin" | "aria-valuemax" | "aria-valuenow"] ?? null,
    locator: () => sliderControl,
  };
  const sliderContainer = {
    filter() { return this; },
    last() { return this; },
    locator: () => slider,
    isVisible: async () => menuOpen,
    waitFor: async ({ state }: { state: string }) => { expect(state).toBe("visible"); },
  };
  const menu = {
    filter() { return this; },
    last() { return this; },
    isVisible: async () => menuOpen,
  };
  const effortControl = {
    last() { return this; },
    isVisible: async () => true,
    getAttribute: async (name: string) => {
      if (name === "aria-controls") return menuOpen ? "effort-menu" : null;
      if (name === "aria-expanded") return String(menuOpen);
      if (name === "data-state") return menuOpen ? "open" : "closed";
      return null;
    },
    click: async () => { events.push("open"); menuOpen = true; },
    dispatchEvent: async () => { events.push("pointerdown"); menuOpen = true; },
  };
  const composerForm = {
    count: async () => 1,
    locator: (selector: string) => selector === CHATGPT_EFFORT_CONTROL_SELECTOR ? effortControl : hidden,
  };
  const composers = {
    filter() { return this; },
    last() { return this; },
    count: async () => 1,
    locator: () => composerForm,
  };
  const page = {
    locator: (selector: string) => {
      if (selector === CHATGPT_COMPOSER_SELECTOR) return composers;
      if (selector === CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR) return sliderContainer;
      if (selector === '[id="effort-menu"]') return menu;
      if (selector === '[role="dialog"], [role="alertdialog"]') return dialog;
      return hidden;
    },
    evaluate: async () => true,
    keyboard: {
      press: async (key: string) => {
        expect(key).toBe("Escape");
        events.push(probeDialogOpen
          ? "dismiss-probe-dialog"
          : unrelatedRestoreDialogOpen ? "dismiss-unrelated-restore-dialog" : "close-menu");
        if (probeDialogOpen) {
          probeDialogOpen = false;
          return;
        }
        if (unrelatedRestoreDialogOpen) {
          unrelatedRestoreDialogOpen = false;
          return;
        }
        if (menuOpen) {
          menuOpen = false;
          if (!persistExtraHigh && value === 3) value = 2;
        }
      },
    },
  };

  return {
    page,
    events,
    state: () => ({ value, menuOpen, probeDialogOpen, preexistingDialogOpen, extraHighSelections }),
    unrelatedRestoreDialogVisible: () => unrelatedRestoreDialogOpen,
  };
}

test("issue #610: Extra High is true only after an actual persistent selection, with original open state restored", async () => {
  const fixture = extraHighFixture({ initialValue: 3, menuOpen: true });

  await expect(detectChatGptAccountCapabilities(fixture.page as never, { selectorTimeoutMs: 3_000 }))
    .resolves.toEqual({ solAvailable: true, extraHighAvailable: true, proAvailable: false });

  expect(fixture.state()).toEqual({
    value: 3,
    menuOpen: true,
    probeDialogOpen: false,
    preexistingDialogOpen: false,
    extraHighSelections: 1,
  });
  expect(fixture.events).toContain("ArrowLeft");
  expect(fixture.events).toContain("ArrowRight");
});

test("issue #610: a newly opened structural modal proves Extra High unavailable and is cleaned up transactionally", async () => {
  const fixture = extraHighFixture({ initialValue: 2, gateOnExtraHigh: true });

  await expect(detectChatGptAccountCapabilities(fixture.page as never, { selectorTimeoutMs: 3_000 }))
    .resolves.toEqual({ solAvailable: true, extraHighAvailable: false, proAvailable: false });

  expect(fixture.state()).toEqual({
    value: 2,
    menuOpen: false,
    probeDialogOpen: false,
    preexistingDialogOpen: false,
    extraHighSelections: 1,
  });
  expect(fixture.events.filter(event => event === "dismiss-probe-dialog")).toHaveLength(1);
});

test("issue #610: a pre-existing unrelated dialog yields unknown without selection or dismissal", async () => {
  const fixture = extraHighFixture({ initialValue: 1, preexistingDialog: true });

  await expect(detectChatGptAccountCapabilities(fixture.page as never, { selectorTimeoutMs: 3_000 }))
    .rejects.toThrow("unknown because a dialog was already visible");

  expect(fixture.state()).toEqual({
    value: 1,
    menuOpen: false,
    probeDialogOpen: false,
    preexistingDialogOpen: true,
    extraHighSelections: 0,
  });
  expect(fixture.events).toEqual([]);
});

test("issue #610: a non-persistent selection yields unknown rather than false capability proof", async () => {
  const fixture = extraHighFixture({ initialValue: 1, persistExtraHigh: false });

  await expect(detectChatGptAccountCapabilities(fixture.page as never, { selectorTimeoutMs: 3_000 }))
    .rejects.toThrow("unknown because the selected value did not persist");

  expect(fixture.state()).toEqual({
    value: 1,
    menuOpen: false,
    probeDialogOpen: false,
    preexistingDialogOpen: false,
    extraHighSelections: 1,
  });
});

test("issue #610: an unrelated restore-time dialog remains untouched and prevents a false capability result", async () => {
  const fixture = extraHighFixture({
    initialValue: 2,
    gateOnExtraHigh: true,
    unrelatedDialogOnRestore: true,
  });

  await expect(detectChatGptAccountCapabilities(fixture.page as never, { selectorTimeoutMs: 3_000 }))
    .rejects.toThrow("unrelated or ambiguous modal while restoring effort");

  expect(fixture.unrelatedRestoreDialogVisible()).toBeTrue();
  expect(fixture.events).not.toContain("dismiss-unrelated-restore-dialog");
  expect(fixture.state().value).toBe(2);
});

test("issue #610: cleanup failure retains the original unknown-capability cause", async () => {
  const fixture = extraHighFixture({
    initialValue: 1,
    persistExtraHigh: false,
    unrelatedDialogOnRestore: true,
  });

  let failure: unknown;
  try {
    await detectChatGptAccountCapabilities(fixture.page as never, { selectorTimeoutMs: 3_000 });
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AggregateError);
  const messages = (failure as AggregateError).errors.map(error => String(error));
  expect(messages.some(message => message.includes("selected value did not persist"))).toBeTrue();
  expect(messages.some(message => message.includes("unrelated or ambiguous modal while restoring effort"))).toBeTrue();
  expect(fixture.unrelatedRestoreDialogVisible()).toBeTrue();
  expect(fixture.events).not.toContain("dismiss-unrelated-restore-dialog");
});
