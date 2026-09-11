import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import { ChatGptMarkdownBuffer } from "../src/adapters/chatgpt-web/markdown";
import { ChatGptVisibleTraceTracker } from "../src/adapters/chatgpt-web/browser-worker";
import { createProcessLineReader } from "../src/adapters/chatgpt-web/process-line-reader";
import { createProcessLineWriter } from "../src/adapters/chatgpt-web/process-line-writer";
import { ChatGptResourceLimitError, retainedRecordBytes } from "../src/adapters/chatgpt-web/resource-budgets";
import {
  ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSession, ChatGptTurnSessions,
  type ChatGptTurnRuntime,
} from "../src/adapters/chatgpt-web/turn-execution";

function runtime(cancel: (reason?: Error) => void = () => {}): ChatGptTurnRuntime {
  return {
    mode: "read-only", browser: new Promise(() => {}), physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(), cancel,
  };
}

test("trace bytes count UTF-8 and draining releases queue capacity", () => {
  const event = { kind: "commentary" as const, text: "🙂".repeat(8) };
  const feed = new ChatGptTraceFeed(retainedRecordBytes(event));
  feed.push(event);
  expect(() => feed.push({ ...event, text: "я" })).toThrow(ChatGptResourceLimitError);
  expect(feed.drain()).toEqual([event]);
  feed.push(event);
  expect(feed.drain()).toEqual([event]);
});

test("answer byte budget persists after drains and rejects a single oversized delta atomically", () => {
  const feed = new ChatGptTextFeed(100);
  feed.push("🙂".repeat(9));
  feed.drain();
  feed.push("🙂".repeat(9));
  feed.drain();
  expect(() => feed.push("🙂".repeat(8))).toThrow(ChatGptResourceLimitError);
  expect(feed.value()).toBe("🙂".repeat(18));
  expect(feed.drain()).toEqual([]);
});

test("many tiny text progress deltas cannot bypass the queue byte charge", () => {
  const feed = new ChatGptTextFeed(100);
  feed.push("a");
  expect(() => feed.push("b")).toThrow("text progress queue");
  expect(feed.drain()).toEqual(["a"]);
  feed.push("b");
  expect(feed.value()).toBe("ab");
});

test("replay journal caps bytes across events and reasoning without retaining a partial batch", () => {
  const cancellations: Array<Error | undefined> = [];
  const session = new ChatGptTurnSession(runtime(reason => cancellations.push(reason)), undefined, undefined,
    undefined, undefined, undefined, { maxBytes: 450 });
  session.appendRoundEvent("round", { type: "text_delta", text: "🙂".repeat(15) });
  session.appendRoundReasoning("round", ["some reasoning"]);
  const retained = session.retainedReplayBytes();
  expect(() => session.appendRoundEvents("round", [
    { type: "text_delta", text: "would fit alone" },
    { type: "text_delta", text: "я".repeat(300) },
  ])).toThrow(ChatGptResourceLimitError);
  expect(session.retainedReplayBytes()).toBe(retained);
  expect(cancellations).toHaveLength(1);
  expect(cancellations[0]).toBeInstanceOf(ChatGptResourceLimitError);
  expect(() => session.roundEvents("round")).toThrow(ChatGptResourceLimitError);
  expect(() => session.appendRoundEvent("another", { type: "done" })).toThrow(ChatGptResourceLimitError);
  // Recording a terminal failure cannot itself overflow the already-full journal.
  expect(() => session.failRound("round", cancellations[0]!)).not.toThrow();
  expect(cancellations).toHaveLength(1);
});

test("final replay copies and tool request payloads share the journal byte allowance", () => {
  const session = new ChatGptTurnSession(runtime(), undefined, undefined, undefined, undefined,
    undefined, { maxBytes: 400 });
  session.setFinalReasoning(["reason"]);
  session.setFinalEvents([{ type: "text_delta", text: "answer" }]);
  expect(() => session.setOutstanding([{
    callId: "call-1", wireName: "tool", freeform: false, arguments: { payload: "я".repeat(1000) },
  }])).toThrow(ChatGptResourceLimitError);
  expect(session.outstanding()).toEqual([]);
});

test("registry byte cap spans sessions and retiring one frees its retained journal allowance", () => {
  const sessions = new ChatGptTurnSessions(60_000, 256, 450);
  const first = sessions.getOrCreate("first", () => runtime());
  const second = sessions.getOrCreate("second", () => runtime());
  first.appendRoundEvent("a", { type: "text_delta", text: "x".repeat(100) });
  expect(() => second.appendRoundEvent("b", { type: "text_delta", text: "x".repeat(100) }))
    .toThrow("session replay registry");
  sessions.retire("first", first);
  const third = sessions.getOrCreate("third", () => runtime());
  expect(() => third.appendRoundEvent("c", { type: "text_delta", text: "x".repeat(100) })).not.toThrow();
  sessions.clear();
});

test("visible progress bounds unstable candidates before any trace is emitted", () => {
  const tracker = new ChatGptVisibleTraceTracker(250, 500);
  expect(tracker.observe([{ kind: "commentary", key: "a", text: "small", complete: false }], false, 0)).toEqual([]);
  expect(() => tracker.observe([{ kind: "commentary", key: "b", text: "я".repeat(300), complete: false }], false, 1))
    .toThrow("visible progress tracker");
});

test("Markdown candidates are bounded before uncommitted DOM data is retained", () => {
  const buffer = new ChatGptMarkdownBuffer(value => value, 750, 500);
  buffer.observe([{ key: "a", text: "small", html: "<p>small</p>", streamable: false }], 0);
  expect(() => buffer.observe([{ key: "b", text: "я".repeat(300), html: "<p>large</p>", streamable: false }], 1))
    .toThrow("Markdown progress buffer");
  expect(buffer.finish().markdown).toBe("small");
});

test("bounded JSONL reader handles split UTF-8, CRLF and multiple individually bounded frames", () => {
  const stream = new PassThrough();
  const lines: string[] = [];
  const failures: Error[] = [];
  createProcessLineReader(stream, line => lines.push(line), error => failures.push(error), { maxLineBytes: 5 });
  const encoded = Buffer.from("🙂\r\nя\nabc\n");
  stream.write(encoded.subarray(0, 2));
  stream.write(encoded.subarray(2));
  stream.end();
  expect(lines).toEqual(["🙂", "я", "abc"]);
  expect(failures).toEqual([]);
});

test("bounded JSONL reader rejects an unterminated frame before retaining excess bytes", () => {
  const stream = new PassThrough();
  const lines: string[] = [];
  const failures: Error[] = [];
  createProcessLineReader(stream, line => lines.push(line), error => failures.push(error), { maxLineBytes: 5 });
  stream.write(Buffer.from("🙂"));
  stream.write(Buffer.from("я"));
  stream.write("\nok\n");
  expect(failures).toHaveLength(1);
  expect(failures[0]).toBeInstanceOf(ChatGptResourceLimitError);
  expect(lines).toEqual([]);
  expect(stream.listenerCount("data")).toBe(0);
  stream.destroy();
});

test("bounded JSONL reader rejects a single oversized completed frame and stops after callback closure", () => {
  const oversized = new PassThrough();
  const failures: Error[] = [];
  createProcessLineReader(oversized, () => { throw new Error("must not parse"); }, error => failures.push(error), { maxLineBytes: 5 });
  oversized.write("123456\n");
  expect(failures[0]?.message).toContain("5-byte");
  oversized.destroy();
  const stream = new PassThrough();
  const lines: string[] = [];
  const reader = createProcessLineReader(stream, line => { lines.push(line); reader.close(); }, error => failures.push(error));
  stream.write("one\ntwo\n");
  expect(lines).toEqual(["one"]);
  stream.destroy();
});

test("IPC writer caps queued UTF-8 bytes when a reader stops consuming", () => {
  const failures: Error[] = [];
  const stream = new Writable({ write() {} });
  const writer = createProcessLineWriter(stream, error => failures.push(error), { maxLineBytes: 10, maxPendingBytes: 8 });
  expect(writer.write("🙂")).toBeTrue(); // Four payload bytes and newline.
  expect(writer.write("я")).toBeTrue(); // Two payload bytes and newline reaches eight.
  expect(stream.writableLength).toBe(8);
  expect(writer.write("x")).toBeFalse();
  expect(stream.writableLength).toBe(8);
  expect(failures).toHaveLength(1);
  expect(writer.write("late")).toBeFalse();
  stream.destroy();
});

test("IPC writer releases queue capacity on completed writes and rejects an oversized frame", async () => {
  const failures: Error[] = [];
  let complete: (() => void) | undefined;
  const stream = new Writable({ write(_chunk, _encoding, callback) { complete = callback; } });
  const writer = createProcessLineWriter(stream, error => failures.push(error), { maxLineBytes: 4, maxPendingBytes: 5 });
  expect(writer.write("🙂")).toBeTrue();
  complete!();
  await new Promise(resolve => setImmediate(resolve));
  expect(writer.write("🙂")).toBeTrue();
  complete!();
  await new Promise(resolve => setImmediate(resolve));
  expect(writer.write("🙂я")).toBeFalse();
  expect(failures).toHaveLength(1);
  expect(stream.writableLength).toBe(0);
  stream.destroy();
});
