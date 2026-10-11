import { expect, test } from "bun:test";
import { ChatGptTurnDomHealthTracker } from "../src/adapters/chatgpt-web/browser-response-policy";

test("an open response stream keeps a turn alive while ChatGPT hides Stop", () => {
  const tracker = new ChatGptTurnDomHealthTracker(1_000, 1_000, 1_000);
  const state = { responsePresent: false, running: false, currentText: "", completionActionVisible: false };
  expect(tracker.update({ ...state, responseStreamActive: true }, 0)).toBeUndefined();
  expect(tracker.update({ ...state, responseStreamActive: true }, 5_000)).toBeUndefined();
  // Once the stream closes, a fresh grace window starts rather than an immediate failure.
  expect(tracker.update(state, 5_001)).toBeUndefined();
  expect(tracker.update(state, 6_100)).toContain("did not create a response DOM");
});
