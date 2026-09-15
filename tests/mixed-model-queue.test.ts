import { expect, test } from 'bun:test';
import { AsyncEventQueue } from '../src/event-queue';

test('mixed-model: streaming backlog releases its byte budget and discards cancelled delivery', async () => {
  const queue = new AsyncEventQueue<string>(10, 8, value => Buffer.byteLength(value));
  const iterator = queue[Symbol.asyncIterator]();
  queue.push('12345678');
  expect(() => queue.push('x')).toThrow(/byte backlog/i);
  expect((await iterator.next()).value).toBe('12345678');
  queue.push('abcdefgh');
  expect((await iterator.next()).value).toBe('abcdefgh');
  queue.push('retained');
  await iterator.return!();
  queue.push('late delivery exceeding the former budget');
  expect((await iterator.next()).done).toBe(true);
});
