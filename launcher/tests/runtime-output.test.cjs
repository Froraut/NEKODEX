const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { once } = require('node:events');
const { collectRuntimeLines, collectCapturedRuntimeOutput } = require('../electron/runtime-output.cjs');

test('runtime output preserves split UTF-8 while keeping exact raw capture bytes', async () => {
  const input = new PassThrough(), lines = [], chunks = [];
  collectCapturedRuntimeOutput(input, chunks, line => lines.push(line));
  const bytes = Buffer.from('Привет 🙂\nready');
  for (const byte of bytes) input.write(Buffer.from([byte]));
  input.end(); await once(input, 'end');
  assert.deepEqual(lines, ['Привет 🙂', 'ready']);
  assert.deepEqual(Buffer.concat(chunks), bytes);
});

test('runtime output clips oversized complete and fragmented lines and recovers at newline', async () => {
  const input = new PassThrough(), lines = [];
  collectRuntimeLines(input, line => lines.push(line), undefined, { maxLineChars: 8 });
  input.write('123456789012\nnormal\n12345'); input.write('6789012\nlast');
  input.end(); await once(input, 'end');
  assert.deepEqual(lines, ['12345678…[truncated]', 'normal', '12345678…[truncated]', 'last']);
});
