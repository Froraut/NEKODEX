import { expect, test } from "bun:test";
import { AsyncEventQueue } from "../src/event-queue";

test("a full event queue delivers its failure after the buffered prefix", async () => {
  const queue = new AsyncEventQueue<string>(2);
  queue.push("first");
  queue.push("second");
  const failure = new Error("backlog failed");
  queue.fail(failure);
  queue.push("ignored after failure");
  const iterator = queue[Symbol.asyncIterator]();
  expect(await iterator.next()).toEqual({ value: "first", done: false });
  expect(await iterator.next()).toEqual({ value: "second", done: false });
  await expect(iterator.next()).rejects.toBe(failure);
});

test("event queue failure wakes a waiting consumer", async () => {
  const queue = new AsyncEventQueue<string>();
  const next = queue[Symbol.asyncIterator]().next();
  const failure = new Error("producer failed");
  queue.fail(failure);
  await expect(next).rejects.toBe(failure);
});

test("event queue preserves an undefined value instead of mistaking it for EOF", async () => {
  const queue = new AsyncEventQueue<string | undefined>();
  queue.push(undefined);
  queue.push("following value");
  queue.close();
  expect(await queue.collect()).toEqual([undefined, "following value"]);
});

test("returning an event queue releases the buffered suffix", async () => {
  const queue = new AsyncEventQueue<string>();
  queue.push("unconsumed");
  const iterator = queue[Symbol.asyncIterator]();
  await iterator.return!();
  expect(await iterator.next()).toEqual({ value: undefined, done: true });
});

test("event queue byte accounting uses enqueue-time size for mutable values", async () => {
  const first = { text: "a" };
  const queue = new AsyncEventQueue<typeof first>(10, 5, value => value.text.length);
  queue.push(first);
  first.text = "changed after enqueue";

  const iterator = queue[Symbol.asyncIterator]();
  const delivered = await iterator.next();
  expect(delivered.value).toBe(first);
  expect(delivered.done).toBe(false);

  queue.push({ text: "12345" });
  expect(() => queue.push({ text: "x" })).toThrow("Adapter event byte backlog exceeded");
});
