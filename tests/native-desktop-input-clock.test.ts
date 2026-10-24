import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test.skipIf(process.platform !== 'darwin')('native input age sampling tolerates one scheduling pause but preserves 5ms and key autorepeat guards', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-input-clock-')));
  try {
    const executable = join(root, 'clock-harness');
    const built = spawnSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-Onone', '-D', 'NEKODEX_DESKTOP_HELPER_HARNESS',
      new URL('../launcher/native/desktop-provider.swift', import.meta.url).pathname,
      new URL('./fixtures/desktop-input-clock.swift', import.meta.url).pathname, '-o', executable], { encoding: 'utf8', timeout: 30000 });
    if (built.status !== 0) throw new Error(`native clock harness compilation failed: ${built.stderr}`);
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 5000 });
    if (run.status !== 0) throw new Error(`native clock harness failed: ${run.stderr}`);
    const value = JSON.parse(run.stdout);
    expect(value.oldFalseAdvance).toBeGreaterThan(0.029);
    expect(value.baseline.lower).toBeLessThanOrEqual(90);
    expect(value.baseline.upper).toBeGreaterThanOrEqual(90);
    expect(value.baseline.upper - value.baseline.lower).toBeLessThanOrEqual(0.001);
    expect(value.baseline.queries).toBe(14); // One wide query discarded; all 13 event types sampled.
    expect(value.unchangedAllowed).toBe(true);
    expect(value.within4msAllowed).toBe(true);
    expect(value.repeat6msRejected).toBe(true);
    expect(value.uncertain5msRejected).toBe(true);
    expect(value.keyDownQueried).toBe(true);
    expect(value.eventTypes).toContain(10); // CG keyDown remains an age query, including repeats.
    for (const result of Object.values(value.failures) as any[]) {
      expect(result).toEqual({ accepted: false, reason: 'human-input-clock-uncertain', queries: 3 });
    }
    expect(value.passive.sampled || value.passive.reason === 'human-input-clock-uncertain').toBe(true);
    console.log(JSON.stringify({ nativeInputClock: value }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 35000);
