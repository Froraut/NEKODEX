import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { resolveProductionVmOrigin } from '../src/execution-environments/production-runtime';
import { verifyProductionVmOriginFiles } from '../src/execution-environments/executor';
import { sha256 } from '../src/execution-environments/protocol';
const { packagedVmOriginEnvironment, PACKAGED_VM_ORIGIN_ENV } = createRequire(import.meta.url)('../launcher/electron/runtime-command.cjs');

test('launcher origin binds copied CLI and Bun to the sealed bundle manifest before runtime admission', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-vm-origin-')));
  try {
    const resourcesPath = join(root, 'NEKODEX.app/Contents/Resources');
    const bundle = join(resourcesPath, 'runtime'), copied = join(root, 'core/versions/fixed-runtime');
    const cli = Buffer.from('fixture CLI bytes'), bun = Buffer.from('fixture Bun bytes');
    const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, platform: 'darwin', arch: 'arm64', entrypoint: 'app/cli.js',
      files: [{ path: 'app/cli.js', size: cli.length, sha256: sha256(cli) }, { path: 'runtime/bun', size: bun.length, sha256: sha256(bun) }] }));
    for (const directory of [bundle, copied]) {
      mkdirSync(join(directory, 'app'), { recursive: true }); mkdirSync(join(directory, 'runtime'), { recursive: true });
      writeFileSync(join(directory, 'app/cli.js'), cli, { mode: 0o600 });
      writeFileSync(join(directory, 'runtime/bun'), bun, { mode: 0o700 });
      writeFileSync(join(directory, 'manifest.json'), manifest, { mode: 0o600 });
    }
    const entry = join(copied, 'app/cli.js'), executable = join(copied, 'runtime/bun');
    const binding = packagedVmOriginEnvironment({ resourcesPath, entrypoint: entry, executable, platform: 'darwin' })[PACKAGED_VM_ORIGIN_ENV];
    const resolved = resolveProductionVmOrigin(entry, executable, binding)!;
    expect(resolved.appBundlePath).toBe(join(root, 'NEKODEX.app'));
    expect(resolved.origin.bundledEntryPath).toBe(join(bundle, 'app/cli.js'));
    expect(() => verifyProductionVmOriginFiles(resolved.origin)).not.toThrow();
    expect(resolveProductionVmOrigin(entry, executable)).toBeUndefined();
    const changedClaim = { ...JSON.parse(binding), runtimeEntryPath: join(root, 'foreign/app/cli.js') };
    expect(() => resolveProductionVmOrigin(entry, executable, JSON.stringify(changedClaim))).toThrow('vm-production-origin-mismatch');
    writeFileSync(entry, 'changed copied CLI', { mode: 0o600 });
    expect(() => verifyProductionVmOriginFiles(resolved.origin)).toThrow('vm-artifact-hash-mismatch');
    writeFileSync(entry, cli, { mode: 0o600 });
    writeFileSync(executable, 'changed copied Bun', { mode: 0o700 });
    expect(() => verifyProductionVmOriginFiles(resolved.origin)).toThrow('vm-artifact-hash-mismatch');
    writeFileSync(join(copied, 'manifest.json'), Buffer.concat([readFileSync(join(bundle, 'manifest.json')), Buffer.from(' ')]));
    expect(() => resolveProductionVmOrigin(entry, executable, binding)).toThrow('vm-production-origin-manifest-mismatch');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
