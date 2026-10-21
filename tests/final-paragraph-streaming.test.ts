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

test("a final paragraph that settled before the turn proved complete is released one observation later", () => {
  const buffer = new ChatGptMarkdownBuffer();
  setSystemTime(new Date(1_000));
  expect(buffer.observe([paragraph("pong")])).toBe("");
  expect(buffer.nextReleaseAt()).toBeUndefined();
  // Stop hid, actions rendered and the stream closed a second after the text last changed.
  setSystemTime(new Date(2_000));
  expect(buffer.observe([paragraph("pong")], { tailReady: true })).toBe("");
  expect(buffer.nextReleaseAt()).toBe(2_250);
  setSystemTime(new Date(2_250));
  expect(buffer.observe([paragraph("pong")], { tailReady: true })).toBe("pong");
  expect(buffer.nextReleaseAt()).toBeUndefined();
});

test("the completed-turn proof does not shorten the content window of a paragraph that just changed", () => {
  const buffer = new ChatGptMarkdownBuffer();
  setSystemTime(new Date(1_000));
  buffer.observe([paragraph("Hello")]);
  setSystemTime(new Date(1_900));
  buffer.observe([paragraph("Hello world")]);
  setSystemTime(new Date(2_000));
  expect(buffer.observe([paragraph("Hello world")], { tailReady: true })).toBe("");
  expect(buffer.nextReleaseAt()).toBe(2_650);
  setSystemTime(new Date(2_300));
  expect(buffer.observe([paragraph("Hello world")], { tailReady: true })).toBe("");
  setSystemTime(new Date(2_650));
  expect(buffer.observe([paragraph("Hello world")], { tailReady: true })).toBe("Hello world");
});

test("a block bounded by the next block still waits the full window after that boundary appears", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const block = (key: string, text: string, streamable: boolean) => ({ key, tag: "p", html: `<p>${text}</p>`, text, streamable });
  setSystemTime(new Date(500));
  buffer.observe([block("first", "First", false)]);
  setSystemTime(new Date(1_000));
  expect(buffer.observe([block("first", "First", true), block("second", "Sec", false)])).toBe("");
  expect(buffer.nextReleaseAt()).toBe(1_750);
  setSystemTime(new Date(1_749));
  expect(buffer.observe([block("first", "First", true), block("second", "Second", false)])).toBe("");
  setSystemTime(new Date(1_750));
  expect(buffer.observe([block("first", "First", true), block("second", "Second", false)])).toBe("First");
});

test("a bounded block or tail still waiting on a citation target keeps the whole window after the proof", () => {
  const buffer = new ChatGptMarkdownBuffer();
  const cited = (key: string, text: string) => ({ key, tag: "p", html: `<p>${text} <a>[1]</a></p>`, text: `${text} [1]`,
    streamable: false, pendingLinks: true });
  setSystemTime(new Date(500));
  buffer.observe([cited("first", "First"), paragraph("Second")]);
  setSystemTime(new Date(2_000));
  expect(buffer.observe([cited("first", "First"), paragraph("Second")], { tailReady: true })).toBe("");
  expect(buffer.nextReleaseAt()).toBe(2_750);
  setSystemTime(new Date(2_250));
  expect(buffer.observe([cited("first", "First"), paragraph("Second")], { tailReady: true })).toBe("");
  setSystemTime(new Date(2_750));
  expect(buffer.observe([cited("first", "First"), paragraph("Second")], { tailReady: true })).toContain("Second");

  const tail = new ChatGptMarkdownBuffer();
  setSystemTime(new Date(500));
  tail.observe([cited("answer", "Only")]);
  setSystemTime(new Date(2_000));
  expect(tail.observe([cited("answer", "Only")], { tailReady: true })).toBe("");
  setSystemTime(new Date(2_250));
  expect(tail.observe([cited("answer", "Only")], { tailReady: true })).toBe("");
  setSystemTime(new Date(2_750));
  expect(tail.observe([cited("answer", "Only")], { tailReady: true })).toContain("Only");
});
