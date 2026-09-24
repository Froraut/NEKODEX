import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { CHATGPT_EFFORT_CONTROL_SELECTOR } from "../src/chatgpt-session";

// Real imported send method; only browser/acceptance boundaries are fixtures.
// No browser launch, source extraction, provider access or mutable shared test file.
async function exercise(requested: boolean, afterReady: (state: any) => void, accepts: boolean) {
  const events: string[] = [];
  const draft = { prompt: "prepared prompt", files: ["kept.txt"] };
  const originalDraft = structuredClone(draft);
  const state = { pressed: [requested ? "true" : "false"] as (string | null)[], sol: 0 };
  const hidden = {
    filter() { return this; }, last() { return this; },
    isVisible: async () => false, count: async () => 0,
  };
  const send = {
    waitFor: async () => { events.push("visible"); },
    isEnabled: async () => true,
    press: async (key: string) => { expect(key).toBe("Enter"); events.push("Enter"); },
  };
  const think = {
    filter(options: unknown) { expect(options).toEqual({ visible: true }); return this; },
    count: async () => { events.push("think-read"); return state.pressed.length; },
    getAttribute: async (name: string) => {
      expect(name).toBe("aria-pressed");
      expect(state.pressed.length).toBe(1);
      return state.pressed[0];
    },
  };
  const form = {
    getByTestId(id: string) { expect(id).toBe("send-button"); return send; },
    locator(selector: string) {
      expect(selector).toBe(CHATGPT_EFFORT_CONTROL_SELECTOR);
      return { filter(options: unknown) {
        expect(options).toEqual({ visible: true });
        return { count: async () => { events.push("sol-read"); return state.sol; } };
      } };
    },
    getByRole(role: string, options: unknown) {
      expect(role).toBe("button"); expect(options).toEqual({ name: "Think", exact: true }); return think;
    },
  };
  const worker = Object.create(ChatGptBrowserWorker.prototype);
  worker.activeComposer = async () => ({ locator(selector: string) {
    expect(selector).toBe("xpath=ancestor::form[1]"); return form;
  } });
  worker.waitForSubmissionAcceptedWithRecovery = async () => {
    expect(events.at(-1)).toBe("Enter"); events.push("accepted"); return "user_turn";
  };
  const page = { isClosed: () => false, locator: () => hidden };
  const result = worker.sendAttachedPrompt(page, {}, async (checkpoint: string) => {
    expect(checkpoint).toBe("send-ready");
    expect(events).toEqual(["visible"]);
    events.push("send-ready");
    // Fault is injected only once the actual send method has passed readiness/dialog checks.
    afterReady(state);
  }, undefined, undefined, {
    onSendActivated: async () => { events.push("activated"); },
    onSubmitted: async () => { events.push("receipt"); },
  }, undefined, undefined, undefined, {
    uiEffortIndex: null, effort: requested ? "medium" : "low", thinkEnabled: requested,
  });
  if (accepts) {
    expect(await result).toBe("user_turn");
    expect(events).toEqual(["visible", "send-ready", "sol-read", "think-read", "activated", "Enter", "accepted", "receipt"]);
  } else {
    const failure = await result.then(() => undefined, (error: unknown) => error);
    expect(failure?.name).toBe("ChatGptWebAdapterError");
    expect(failure?.retryable).toBe(false);
    expect(failure?.cause?.message).toMatch(/before submission/);
    expect(events.slice(0, 3)).toEqual(["visible", "send-ready", "sol-read"]);
    expect(events).not.toContain("activated");
    expect(events).not.toContain("Enter");
    expect(events).not.toContain("accepted");
    expect(events).not.toContain("receipt");
  }
  expect(draft).toEqual(originalDraft);
  // Fixture deliberately supplies no draft mutation, slash-command, click, or keyboard API;
  // any attempted repair fails rather than silently mutating the retained draft/files.
}

test("final Luna/Think send rejects both user mode toggles after readiness", async () => {
  await exercise(true, state => { state.pressed = ["false"]; }, false);
  await exercise(false, state => { state.pressed = ["true"]; }, false);
});

test("final Luna/Think send preserves valid Think and ordinary Luna including absent button", async () => {
  await exercise(true, () => {}, true);
  await exercise(false, () => {}, true);
  await exercise(false, state => { state.pressed = []; }, true);
});

test("final Luna/Think send rejects missing semantic state, ambiguous controls and Sol drift", async () => {
  await exercise(true, state => { state.pressed = []; }, false);
  await exercise(false, state => { state.pressed = [null]; }, false);
  await exercise(false, state => { state.pressed = ["false", "false"]; }, false);
  await exercise(true, state => { state.sol = 1; }, false);
});
