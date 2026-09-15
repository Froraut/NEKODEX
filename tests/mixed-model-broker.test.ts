import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { TurnBroker } from '../src/adapters/chatgpt-web/turn-broker';

test('mixed-model: failed broker acquisition preserves a foreign socket and permits retry', async () => {
  const root = mkdtempSync('/tmp/nekodex-broker-');
  const endpoint = join(root, 'b.sock');
  const foreign = createServer(socket => socket.end());
  let retry: TurnBroker | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      foreign.once('error', reject);
      foreign.listen(endpoint, resolve);
    });
    chmodSync(endpoint, 0o600);
    const failed = TurnBroker.forSocket(endpoint);
    await expect(failed.listen()).rejects.toThrow(/already|active|running|listening|in use/i);
    expect(existsSync(endpoint)).toBe(true);
    expect(foreign.listening).toBe(true);
    await new Promise<void>((resolve, reject) => foreign.close(error => error ? reject(error) : resolve()));
    retry = TurnBroker.forSocket(endpoint);
    expect(retry).not.toBe(failed);
    await retry.listen();
    expect(existsSync(endpoint)).toBe(true);
  } finally {
    if (foreign.listening) await new Promise<void>(resolve => foreign.close(() => resolve()));
    await retry?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
