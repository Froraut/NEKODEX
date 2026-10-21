import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { readRecordedServiceTier } = require('../launcher/electron/codex-rollout-settings.cjs');

const ROOT = '0199a001-0000-7000-8000-000000000001';
const OTHER = '0199a001-0000-7000-8000-000000000002';
const directories: string[] = [];
afterEach(() => { while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true }); });

const settings = (threadId: string | undefined, serviceTier?: unknown, padding = '') => JSON.stringify({
  timestamp: '2026-10-21T10:00:00Z', ordinal: 1, type: 'event_msg', payload: { type: 'thread_settings_applied',
    ...(threadId === undefined ? {} : { thread_id: threadId }),
    thread_settings: { model: 'gpt-test', ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
      ...(padding ? { padding } : {}) } } });
/** A non-snapshot line that mentions the marker, as a tool output reading a rollout would. */
const output = (size: number) => JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output',
  output: `"thread_settings_applied" ${'x'.repeat(size)}` } });
function home(lines: string[], { name = `rollout-2026-10-21T10-00-00-${ROOT}.jsonl`, directory = 'sessions' } = {}) {
  const codexHome = mkdtempSync(join(tmpdir(), 'nekodex-rollout-settings-'));
  directories.push(codexHome);
  const folder = join(codexHome, directory, '2026', '10', '21');
  mkdirSync(folder, { recursive: true });
  const rolloutPath = join(folder, name);
  writeFileSync(rolloutPath, lines.join('\n'));
  return { codexHome, rolloutPath };
}
const read = (target: { codexHome: string; rolloutPath: string }, options: any = {}) =>
  readRecordedServiceTier({ ...target, threadId: ROOT, ...options });

test('the latest snapshot the thread owns wins; copies, other lines and a cut final write do not', async () => {
  const target = home([
    JSON.stringify({ type: 'session_meta', payload: { id: ROOT } }),
    settings(ROOT, 'ultrafast'), output(300), settings(ROOT, 'flex'), output(5000),
    settings(OTHER, 'ultrafast'), settings(undefined, 'ultrafast'), output(10),
    settings(ROOT, 'default').slice(0, -8),
  ]);
  // Tiny chunks split every line, so the result must not depend on where reads fall.
  for (const chunkBytes of [1, 7, 64, 4096, 1024 * 1024]) {
    expect(await read(target, { chunkBytes })).toEqual({ recorded: true, serviceTier: 'flex' });
  }
  expect(await read(home([settings(ROOT, 'ultrafast'), settings(ROOT), ''])))
    .toEqual({ recorded: true, serviceTier: null });
  expect(await read(home([settings(ROOT, null)]))).toEqual({ recorded: true, serviceTier: null });
  expect(await read(home([settings(OTHER, 'flex'), output(20), '']))).toEqual({ recorded: false, serviceTier: null });
  expect(await read(home([]))).toEqual({ recorded: false, serviceTier: null });
  expect(await read(home([settings(ROOT, 'fast')], { name: `rollout-2026-10-21T10-00-00-${ROOT}_${OTHER}.jsonl`, directory: 'archived_sessions' })))
    .toEqual({ recorded: true, serviceTier: 'fast' });
});

test('lines longer than the bound are skipped without being parsed or kept, at any chunk size', async () => {
  const target = home([settings(ROOT, 'flex'), output(900), settings(ROOT, 'ultrafast', 'p'.repeat(600)), output(40), '']);
  for (const chunkBytes of [3, 100, 512, 8192]) {
    expect(await read(target, { chunkBytes, maxLineBytes: 512 })).toEqual({ recorded: true, serviceTier: 'flex' });
  }
  expect(await read(target, { chunkBytes: 100 })).toEqual({ recorded: true, serviceTier: 'ultrafast' });
  expect(await read(home([settings(ROOT, 'flex', 'p'.repeat(600))]), { chunkBytes: 50, maxLineBytes: 512 }))
    .toEqual({ recorded: false, serviceTier: null });
});

test('only a regular rollout of this thread inside the session store is read', async () => {
  const valid = home([settings(ROOT, 'flex')]);
  const unreadable = { code: 'settings_unreadable' };
  await expect(read({ ...valid, rolloutPath: undefined as any })).rejects.toMatchObject(unreadable);
  await expect(read({ ...valid, rolloutPath: 'sessions/rollout.jsonl' })).rejects.toMatchObject(unreadable);
  await expect(read({ ...valid, rolloutPath: `${valid.rolloutPath}.missing` })).rejects.toMatchObject(unreadable);
  await expect(readRecordedServiceTier({ ...valid, threadId: OTHER })).rejects.toMatchObject(unreadable);
  await expect(readRecordedServiceTier({ ...valid, threadId: 'not-a-thread' })).rejects.toMatchObject(unreadable);
  const outside = home([settings(ROOT, 'flex')], { directory: 'elsewhere' });
  await expect(read({ codexHome: valid.codexHome, rolloutPath: outside.rolloutPath })).rejects.toMatchObject(unreadable);
  await expect(read(outside)).rejects.toMatchObject(unreadable);
  const link = join(valid.codexHome, 'sessions', `rollout-2026-10-21T11-00-00-${ROOT}.jsonl`);
  symlinkSync(outside.rolloutPath, link);
  await expect(read({ codexHome: valid.codexHome, rolloutPath: link })).rejects.toMatchObject(unreadable);
  await expect(read(home([settings(ROOT, 42)]))).rejects.toMatchObject(unreadable);
  await expect(read(home([settings(ROOT, 'bad tier\n')]))).rejects.toMatchObject(unreadable);
  await expect(read(valid, { chunkBytes: 0 })).rejects.toMatchObject(unreadable);
});
