import { afterEach, expect, setSystemTime, test } from "bun:test";
import { ChatGptMarkdownBuffer } from "../src/adapters/chatgpt-web/markdown";
import { ChatGptCompletionTracker } from "../src/adapters/chatgpt-web/browser-response-policy";

afterEach(() => setSystemTime());
const paragraph = (text: string) => ({ key: "answer", tag: "p", html: `<p>${text}</p>`, text, streamable: false });

test("a stable final paragraph streams before terminal completion without weakening the tool fence", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const tracker = new ChatGptCompletionTracker();
  const state = { responsePresent: true, running: false, currentText: "Hello", completionActionVisible: true };
  setSystemTime(new Date(1_000));
  expect(buffer.observe([paragraph("Hello")], { tailReady: true })).toBe("");
  expect(tracker.update(state, 1_000)).toBe(false);
  setSystemTime(new Date(1_800));
  expect(buffer.observe([paragraph("Hello")], { tailReady: true })).toBe("Hello");
  expect(tracker.update(state, 1_800)).toBe(false);
  expect(tracker.update({ ...state, externalToolCallsInFlight: true }, 3_500)).toBe(false);
  expect(tracker.update(state, 3_600)).toBe(false);
  expect(tracker.update(state, 5_601)).toBe(true);
  expect(buffer.finish()).toEqual({ markdown: "Hello", delta: "" });
});

test("a changing or resumed final paragraph is not emitted before a new stable boundary", () => {
  const buffer = new ChatGptMarkdownBuffer();
  setSystemTime(new Date(1_000));
  buffer.observe([paragraph("Draft")], { tailReady: true });
  setSystemTime(new Date(1_700));
  expect(buffer.observe([paragraph("Final")], { tailReady: true })).toBe("");
  setSystemTime(new Date(2_600));
  expect(buffer.observe([paragraph("Final")])).toBe("");
  setSystemTime(new Date(3_000));
  expect(buffer.observe([paragraph("Final")], { tailReady: true })).toBe("");
  setSystemTime(new Date(3_800));
  expect(buffer.observe([paragraph("Final")], { tailReady: true })).toBe("Final");
});

test("atomic compaction and mutable file references still wait for completion", () => {
  const atomic = new ChatGptMarkdownBuffer("complete");
  const reference = new ChatGptMarkdownBuffer();
  for (const now of [1_000, 2_000]) {
    setSystemTime(new Date(now));
    expect(atomic.observe([paragraph("Summary")], { tailReady: true })).toBe("");
    expect(reference.observe([{ ...paragraph("File"), mutableReference: true }], { tailReady: true })).toBe("");
  }
  expect(atomic.finish().markdown).toBe("Summary");
  expect(reference.finish().markdown).toBe("File");
});
