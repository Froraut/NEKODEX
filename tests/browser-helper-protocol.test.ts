import { expect, test } from 'bun:test';
import { parseHelperMessage, type HelperOutputMessage } from '../src/adapters/chatgpt-web/browser-helper-protocol';

test('helper completion fence round-trips its exact owner and zero revision', () => {
  const message: HelperOutputMessage = { type: 'event', id: 'turn-a', event: 'completion_fence_commit', requestId: 3, revision: 0 };
  expect(parseHelperMessage(JSON.stringify(message))).toEqual(message);
});

test('helper decoder rejects malformed fence revision and unknown event', () => {
  expect(() => parseHelperMessage(JSON.stringify({ type: 'event', id: 'turn-a',
    event: 'completion_fence_commit', requestId: 3, revision: -1 }))).toThrow('revision is invalid');
  expect(() => parseHelperMessage(JSON.stringify({ type: 'event', id: 'turn-a',
    event: 'future_event' }))).toThrow('unknown event');
});

test('maintenance result is producer-typed but rejected by the turn receiver', () => {
  const message: HelperOutputMessage = { type: 'result', id: 'inspect-a',
    value: { authenticated: true, temporary: true, url: 'https://chatgpt.com/' } };
  expect(() => parseHelperMessage(JSON.stringify(message))).toThrow('result text is invalid');
});
