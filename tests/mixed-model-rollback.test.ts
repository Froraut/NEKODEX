import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFilesWithCompensation } from '../src/codex-integration-shared';

test('mixed-model: a later write failure restores the owned symlink target', () => {
  const root = mkdtempSync('/tmp/nekodex-rollback-');
  const target = join(root, 'target.toml');
  const link = join(root, 'config.toml');
  const blocker = join(root, 'not-a-directory');
  writeFileSync(target, 'original = true\n');
  symlinkSync(target, link);
  writeFileSync(blocker, 'keep');
  try {
    expect(() => writeFilesWithCompensation([
      { path: link, data: 'replacement = true\n', followSymlink: true, managed: true },
      { path: join(blocker, 'child'), data: 'cannot write', managed: true },
    ])).toThrow();
    expect(readlinkSync(link)).toBe(target);
    expect(readFileSync(target, 'utf8')).toBe('original = true\n');
    expect(readFileSync(blocker, 'utf8')).toBe('keep');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
