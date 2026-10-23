import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createNativeAccountAuthority } = require('../launcher/electron/native-account-authority.cjs');
const roots: string[] = [];
const services: any[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.destroy();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const prompt = (code = 'SAMPLE-ONLY') => `\nWelcome to Codex [v\x1b[90m0.163.0\x1b[0m]\n\x1b[90mOpenAI's command-line coding agent\x1b[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94m${code}\x1b[0m\n\n\x1b[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\x1b[0m\n\n`;
function fixture(options: { closeOnSignal?: boolean; beforeSpawn?: () => void; afterConfigRename?: () => void } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-account-fixture-'))); roots.push(root);
  const packageRoot = join(root, 'official-fixture'), binary = join(packageRoot, 'bin', 'codex');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true, mode: 0o700 });
  // Never executed. Injection proves exact spawn intent without any real CLI/auth/network launch.
  writeFileSync(binary, 'inert official layout fixture', { mode: 0o700 });
  writeFileSync(join(packageRoot, 'codex-package.json'), JSON.stringify({ version: '0.163.0', layoutVersion: 1, entrypoint: 'bin/codex', variant: 'codex', target: 'aarch64-apple-darwin' }), { mode: 0o600 });
  const calls: any[] = [], children: any[] = [], signals: any[] = [];
  const authorityHome = join(root, 'accounts');
  const create = () => {
    const service = createNativeAccountAuthority({ authorityHome, executable: binary,
      executableSha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), stopGraceMs: 100,
      testHooks: { platform: 'darwin', probePolicy() {}, afterConfigRename: options.afterConfigRename, spawn(executable: string, args: string[], config: any) {
        options.beforeSpawn?.(); calls.push({ executable, args, config });
        const child = Object.assign(new EventEmitter(), { pid: 999001 + children.length, stdout: new EventEmitter(), stderr: new EventEmitter() });
        children.push(child); return child;
      }, killGroup(pid: number, signal: string) {
        signals.push({ pid, signal });
        if (options.closeOnSignal !== false) queueMicrotask(() => children.find(child => child.pid === pid)?.emit('close', null, signal));
      } } });
    services.push(service); return service;
  };
  const service = create();
  const prepare = () => service.prepareProfile({ actionId: randomUUID(), label: 'Personal Native' });
  const login = (profile: any) => service.beginDeviceLogin({ profileId: profile.id, epoch: profile.epoch, actionId: randomUUID() });
  return { root, authorityHome, binary, service, create, calls, children, signals, prepare, login };
}
function diskFiles(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const file = join(directory, name); return lstatSync(file).isDirectory() ? diskFiles(file) : [file];
  });
}
test.skipIf(process.platform !== 'darwin')('preparation owns private persistent files, passive status has no filesystem/process side effect, no replay', async () => {
  const f = fixture();
  expect(f.service.inspect().profiles).toEqual([]);
  expect(readdirSync(f.root)).toEqual(['official-fixture']);
  const actionId = randomUUID(), p = f.service.prepareProfile({ actionId, label: ' Native account ' });
  expect(p.label).toBe('Native account'); expect(p.state).toBe('fresh'); expect(p.id).not.toBe(p.epoch);
  expect(() => f.service.prepareProfile({ actionId, label: 'Native account' })).toThrow('cannot be replayed');
  const metadata = diskFiles(f.authorityHome);
  for (const file of metadata) expect(lstatSync(file).mode & 0o777).toBe(0o600);
  for (const file of metadata) expect(readFileSync(file, 'utf8')).not.toContain('SAMPLE-ONLY');
  expect(f.calls.length).toBe(0);
  await f.service.destroy();
  const restored = f.create(); expect(restored.inspect().profiles[0]).toEqual(p);
  expect(f.calls.length).toBe(0);
});
test.skipIf(process.platform !== 'darwin')('only exact pinned device prompt crosses projection; chunked ANSI/UTF8 works and receipt precedes spawn', async () => {
  let reached = false;
  const f = fixture({ beforeSpawn() {
    const receipts = JSON.parse(readFileSync(join(f.authorityHome, 'registry.json'), 'utf8')).receipts;
    reached = receipts.some((row: any) => row.kind === 'device-login' && row.state === 'prepared');
  } });
  const p = f.prepare(), login = f.login(p), child = f.children[0];
  expect(reached).toBe(true); expect(login.state).toBe('running');
  child.stderr.emit('data', Buffer.from('SECRET-STDERR-TOKEN account@example.invalid'));
  const output = Buffer.from(prompt('code-π-123'));
  for (let offset = 0; offset < output.length; offset += 3) child.stdout.emit('data', output.subarray(offset, offset + 3));
  expect(f.service.inspectLogin(login.id)).toMatchObject({ state: 'pending', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'code-π-123' });
  const stored = diskFiles(f.authorityHome).map(file => readFileSync(file, 'utf8')).join('');
  expect(stored).not.toContain('code-π-123'); expect(stored).not.toContain('SECRET-STDERR-TOKEN');
  const snapshotText = JSON.stringify(f.service.inspect());
  expect(snapshotText).not.toContain('SECRET-STDERR-TOKEN'); expect(snapshotText).not.toContain('account@example.invalid');
  expect(f.calls[0].args).toEqual(['login', '--device-auth']);
  expect(Object.keys(f.calls[0].config.env).sort()).toEqual(['CODEX_HOME','CODEX_SQLITE_HOME','HOME','LANG','PATH','TERM','TMPDIR','XDG_CACHE_HOME','XDG_CONFIG_HOME'].sort());
  expect(f.calls[0].config.detached).toBe(true);
  writeFileSync(join(f.calls[f.children.indexOf(child)].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 });
  child.emit('close', 0, null);
  expect(f.service.inspectLogin(login.id)).toMatchObject({ state: 'signed-in-checking' });
  expect(f.service.inspectLogin(login.id).userCode).toBeUndefined();
  expect(f.service.inspect().executionAvailable).toBe(false);
  expect(() => f.login(p)).toThrow('new unused physical profile epoch');
});
test.skipIf(process.platform !== 'darwin')('foreign URL, duplicate candidates, controls and unbounded output never become a device code', async () => {
  const f = fixture();
  for (const output of [prompt().replace('auth.openai.com', 'attacker.invalid'), prompt() + prompt('SECOND'), prompt('bad\x07value'), 'x'.repeat(17000) + prompt()]) {
    const login = f.login(f.prepare()), child = f.children.at(-1);
    child.stdout.emit('data', Buffer.from(output));
    expect(f.service.inspectLogin(login.id).userCode).toBeUndefined();
    child.emit('close', 1, null);
    expect(f.service.inspectLogin(login.id).state).toBe('failed');
  }
  expect(f.calls.length).toBe(4);
});
test.skipIf(process.platform !== 'darwin')('cancellation retains physical owner until exact close, preserves epoch and never claims remote revoke', async () => {
  const f = fixture({ closeOnSignal: false }), p = f.prepare(), login = f.login(p), child = f.children[0];
  child.stdout.emit('data', prompt());
  let returned = false;
  const cancellation = f.service.cancelLogin({ loginAttemptId: login.id, actionId: randomUUID() }).then((result: any) => { returned = true; return result; });
  await Promise.resolve(); expect(returned).toBe(false);
  expect(f.service.inspect().activeCount).toBe(1); expect(f.service.inspectLogin(login.id).state).toBe('cancel-requested');
  expect(f.service.inspectLogin(login.id).userCode).toBeUndefined();
  expect(f.signals).toEqual([{ pid: child.pid, signal: 'SIGTERM' }]);
  child.emit('close', null, 'SIGTERM');
  expect((await cancellation).state).toBe('auth-outcome-unknown');
  expect(f.service.inspect().activeCount).toBe(0);
  expect(f.service.inspect().profiles[0].epoch).toBe(p.epoch);
  expect(f.service.inspect().receipts.at(-1).state).toBe('settled');
  await f.service.destroy();
  const next = f.create(); expect(next.inspect().profiles[0].state).toBe('auth-outcome-unknown');
  expect(f.calls.length).toBe(1);
});
test.skipIf(process.platform !== 'darwin')('exit zero racing cancellation means signed-in-checking only; a lost terminal/error is never replayed', async () => {
  const f = fixture({ closeOnSignal: false }), p = f.prepare(), login = f.login(p), child = f.children[0];
  const cancellation = f.service.cancelLogin({ loginAttemptId: login.id, actionId: randomUUID() });
  writeFileSync(join(f.calls[f.children.indexOf(child)].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 });
  child.emit('close', 0, null); expect((await cancellation).state).toBe('signed-in-checking');
  const second = f.login(f.prepare()), secondChild = f.children[1];
  secondChild.emit('error', new Error('must-never-be-projected-secret'));
  expect(f.service.inspectLogin(second.id).state).toBe('auth-outcome-unknown');
  expect(f.service.inspect().activeCount).toBe(1);
  secondChild.emit('close', -1, null);
  await f.service.destroy(); const reopened = f.create();
  expect(reopened.inspect().profiles[1].state).toBe('auth-outcome-unknown');
  expect(f.calls.length).toBe(2); expect(JSON.stringify(reopened.inspect())).not.toContain('must-never-be-projected-secret');
});
test.skipIf(process.platform !== 'darwin')('owner loss projects uncertainty passively and a concurrent owner cannot spawn', async () => {
  const f = fixture(), p = f.prepare(), login = f.login(p);
  const other = f.create(); expect(other.inspect().available).toBe(false);
  expect(() => other.prepareProfile({ actionId: randomUUID(), label: 'Another' })).toThrow('requires reconciliation');
  f.children[0].emit('close', 1, null); await f.service.destroy();
  // Model a persisted in-flight receipt after owner death, with no physical live child to adopt.
  const file = join(f.authorityHome, 'registry.json'), registry = JSON.parse(readFileSync(file, 'utf8'));
  registry.profiles[0].state = 'login-pending'; registry.profiles[0].login.state = 'running';
  registry.receipts.find((row: any) => row.loginAttemptId === login.id).state = 'running';
  writeFileSync(file, JSON.stringify(registry), { mode: 0o600 });
  const passive = f.create(); expect(passive.inspectLogin(login.id).state).toBe('auth-outcome-unknown');
  expect(f.calls.length).toBe(1);
  passive.prepareProfile({ actionId: randomUUID(), label: 'New explicit epoch' });
  expect(passive.inspectLogin(login.id).state).toBe('auth-outcome-unknown');
});
test.skipIf(process.platform !== 'darwin')('preflight refuses changed executable and existing auth metadata without reading auth or spawning', async () => {
  const f = fixture(), p = f.prepare();
  const codexHome = join(f.authorityHome, 'profiles', p.id, 'epochs', p.epoch, 'codex');
  const outside = join(f.root, 'do-not-read-auth'); writeFileSync(outside, 'sensitive fixture sentinel', { mode: 0o600 });
  // Directory is enough to prove the selected profile is not fresh; auth content is never opened.
  mkdirSync(join(codexHome, 'auth.json'), { mode: 0o700 });
  expect(() => f.login(p)).toThrow('untouched profile epoch'); expect(f.calls.length).toBe(0);
  expect(f.service.inspect().profiles[0].login.reasonCode).toBe('fresh_epoch_required');
  const next = f.prepare(); writeFileSync(f.binary, 'changed inert bytes');
  expect(() => f.login(next)).toThrow('executable pin changed'); expect(f.calls.length).toBe(0);
  expect(f.service.inspect().profiles[1].login.state).toBe('failed');
});

test.skipIf(process.platform !== 'darwin')('trusted inventory resolution waits for exact login close and stats auth metadata only', async () => {
  const f = fixture(), p = f.prepare(), login = f.login(p), child = f.children[0];
  const codexHome = join(f.authorityHome, 'profiles', p.id, 'epochs', p.epoch, 'codex');
  // A zero-length file is sufficient: the parent contract validates metadata, not token contents.
  writeFileSync(join(codexHome, 'auth.json'), '', { mode: 0o600 });
  expect(() => f.service.resolveProfile(p.id, p.epoch)).toThrow('settled signed-in-checking');
  writeFileSync(join(f.calls[f.children.indexOf(child)].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 });
  child.emit('close', 0, null);
  expect(f.service.resolveProfile(p.id, p.epoch)).toMatchObject({ profileId: p.id, epoch: p.epoch, codexHome });
  expect(JSON.stringify(f.service.inspect())).not.toContain(codexHome);
  expect(f.service.inspectLogin(login.id).state).toBe('signed-in-checking');
});

test.skipIf(process.platform !== 'darwin')('exit zero without native private auth persistence stays unknown and rejected pre-intent action is classified', async () => {
  const f = fixture(), p = f.prepare(), login = f.login(p);
  f.children[0].emit('close', 0, null);
  expect(f.service.inspectLogin(login.id).state).toBe('auth-outcome-unknown');
  let rejected: any;
  try { f.service.beginDeviceLogin({ profileId: p.id, epoch: p.epoch, actionId: randomUUID() }); } catch (error) { rejected = error; }
  expect(rejected.code).toBe('fresh_epoch_required'); expect(rejected.actionRecorded).toBe(false);
  const next = f.prepare(); writeFileSync(f.binary, 'changed inert bytes');
  try { f.login(next); } catch (error) { rejected = error; }
  expect(rejected.actionRecorded).toBe(true);
});

test.skipIf(process.platform !== 'darwin')('journaled config publication compares exact bytes and reconciles a lost write without replay', async () => {
  let loseWrite = false;
  const f = fixture({ afterConfigRename() { if (loseWrite) throw new Error('fixture lost config terminal'); } });
  const p = f.prepare(), login = f.login(p), child = f.children[0];
  writeFileSync(join(f.calls[0].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 }); child.emit('close', 0, null);
  const before = f.service.resolveProfile(p.id, p.epoch), original = readFileSync(before.config, 'utf8');
  const configText = original + 'log_dir = "/private/owned/log"\nthread_unload_delay_secs = 0\n';
  const committed = f.service.publishProfileConfig({ profileId: p.id, epoch: p.epoch, actionId: randomUUID(), expectedConfigSha256: before.configSha256, configText });
  expect(committed.state).toBe('completed');
  expect(f.service.resolveProfile(p.id, p.epoch).configSha256).toBe(committed.configSha256);
  expect(() => f.service.publishProfileConfig({ profileId: p.id, epoch: p.epoch, actionId: randomUUID(), expectedConfigSha256: before.configSha256, configText: original })).toThrow('expectation changed');
  expect(readFileSync(before.config, 'utf8')).toBe(configText);
  for (const value of ['1800', '-1', '"0"', '0.0']) {
    expect(() => f.service.publishProfileConfig({ profileId: p.id, epoch: p.epoch, actionId: randomUUID(), expectedConfigSha256: committed.configSha256,
      configText: configText.replace('thread_unload_delay_secs = 0', `thread_unload_delay_secs = ${value}`) })).toThrow('reviewed zero value');
    expect(readFileSync(before.config, 'utf8')).toBe(configText);
  }
  expect(() => f.service.publishProfileConfig({ profileId: p.id, epoch: p.epoch, actionId: randomUUID(), expectedConfigSha256: committed.configSha256, configText: configText + 'api_key = "never-store-this"\n' })).toThrow('unsupported fields');
  const unknownAction = randomUUID(), nextText = configText + 'web_search = "disabled"\n';
  loseWrite = true;
  expect(() => f.service.publishProfileConfig({ profileId: p.id, epoch: p.epoch, actionId: unknownAction, expectedConfigSha256: committed.configSha256, configText: nextText })).toThrow('fixture lost config terminal');
  expect(f.service.inspect().receipts.find((row: any) => row.actionId === unknownAction).state).toBe('config-outcome-unknown');
  expect(readFileSync(before.config, 'utf8')).toBe(nextText);
  const reconciled = f.service.resolveProfile(p.id, p.epoch);
  expect(reconciled.configSha256).toBe(createHash('sha256').update(nextText).digest('hex'));
  expect(f.service.inspect().receipts.find((row: any) => row.actionId === unknownAction)).toMatchObject({ state: 'completed', reasonCode: 'config_write_reconciled' });
  expect(f.calls.length).toBe(1); expect(f.service.inspectLogin(login.id).state).toBe('signed-in-checking');
});
test.skipIf(process.platform !== 'darwin')('shutdown blocks new admission, shares exact physical close wait and releases only after settlement', async () => {
  const f = fixture({ closeOnSignal: false }), p = f.prepare(); f.login(p);
  let settled = false; const shutdown = f.service.destroy().then(() => { settled = true; });
  const duplicate = f.service.destroy(); await Promise.resolve();
  expect(settled).toBe(false); expect(f.service.inspect().available).toBe(false);
  expect(() => f.service.prepareProfile({ actionId: randomUUID(), label: 'Must wait' })).toThrow('owner is closed');
  expect(f.signals.length).toBe(1); f.children[0].emit('close', null, 'SIGTERM');
  await Promise.all([shutdown, duplicate]); expect(settled).toBe(true);
  expect(f.service.inspect().storageOwner).toBe('unclaimed');
});

test.skipIf(process.platform !== 'darwin')('inventory lease excludes competing profile mutation and keeps shutdown owner until released', async () => {
  const f = fixture(), p = f.prepare(); f.login(p);
  writeFileSync(join(f.calls[0].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 }); f.children[0].emit('close', 0, null);
  const lease = f.service.acquireProfileOwner({ profileId: p.id, epoch: p.epoch, actionId: randomUUID(), kind: 'inventory' });
  expect(() => f.service.resolveProfile(p.id, p.epoch)).toThrow('another live owner');
  expect(() => f.service.releaseProfileOwner({ ...lease })).toThrow('exact lease');
  const resolved = f.service.resolveProfile(p.id, p.epoch, lease);
  expect(resolved.authStat.size).toBe(0); expect(resolved.authStat.ino).toBeGreaterThan(0);
  const configText = readFileSync(resolved.config, 'utf8') + 'web_search = "disabled"\n';
  expect(f.service.publishProfileConfig({ profileId: p.id, epoch: p.epoch, actionId: randomUUID(), expectedConfigSha256: resolved.configSha256, configText, profileOwner: lease }).state).toBe('completed');
  await expect(f.service.destroy()).rejects.toThrow('inventory owner physical settlement');
  expect(f.service.inspect().storageOwner).toBe('current');
  f.service.releaseProfileOwner(lease); await f.service.destroy();
  expect(f.service.inspect().storageOwner).toBe('unclaimed');
});
test.skipIf(process.platform !== 'darwin')('profile removal drops an unsigned profile, its private data and earlier receipts, keeping one removal receipt', async () => {
  const f = fixture(), kept = f.prepare(), failed = f.prepare(), login = f.login(failed), child = f.children[0];
  child.emit('close', 1, null);
  expect(f.service.inspect().profiles.find((row: any) => row.id === failed.id).state).toBe('login-failed');
  const root = join(f.authorityHome, 'profiles', failed.id);
  expect(lstatSync(root).isDirectory()).toBe(true);
  const actionId = randomUUID();
  expect(f.service.removeProfile({ actionId, profileId: failed.id, epoch: failed.epoch })).toEqual({ actionId, profileId: failed.id, epoch: failed.epoch, state: 'completed' });
  expect(() => lstatSync(root)).toThrow();
  const snapshot = f.service.inspect();
  expect(snapshot.profiles.map((row: any) => row.id)).toEqual([kept.id]);
  expect(snapshot.receipts.filter((row: any) => row.profileId === failed.id)).toEqual([{ actionId, kind: 'remove-profile', profileId: failed.id, epoch: failed.epoch, state: 'completed' }]);
  expect(snapshot.receipts.some((row: any) => row.actionId === login.actionId)).toBe(false);
  expect(() => f.service.removeProfile({ actionId, profileId: kept.id, epoch: kept.epoch })).toThrow();
  expect(() => f.service.removeProfile({ actionId: randomUUID(), profileId: failed.id, epoch: failed.epoch })).toThrow('does not exist');
  await f.service.destroy();
  expect(f.create().inspect().profiles.map((row: any) => row.id)).toEqual([kept.id]);
});
test.skipIf(process.platform !== 'darwin')('profile removal refuses a live login and a signed-in profile without explicit confirmation', async () => {
  const f = fixture(), p = f.prepare(), login = f.login(p), child = f.children[0];
  const refused = randomUUID();
  let error: any; try { f.service.removeProfile({ actionId: refused, profileId: p.id, epoch: p.epoch, confirmSignedIn: true }); } catch (cause) { error = cause; }
  expect(error?.code).toBe('native_login_busy'); expect(error?.actionRecorded).toBe(false);
  writeFileSync(join(f.calls[0].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 });
  child.emit('close', 0, null);
  expect(f.service.inspectLogin(login.id).state).toBe('signed-in-checking');
  error = undefined; try { f.service.removeProfile({ actionId: randomUUID(), profileId: p.id, epoch: p.epoch }); } catch (cause) { error = cause; }
  expect(error?.code).toBe('profile_signed_in'); expect(error?.actionRecorded).toBe(false);
  expect(() => f.service.checkRemovable({ profileId: p.id, epoch: p.epoch })).toThrow('explicit confirmation');
  const registryBefore = readFileSync(join(f.authorityHome, 'registry.json'), 'utf8');
  expect(f.service.checkRemovable({ profileId: p.id, epoch: p.epoch, confirmSignedIn: true })).toEqual({ signedIn: true });
  expect(readFileSync(join(f.authorityHome, 'registry.json'), 'utf8')).toBe(registryBefore);
  expect(f.service.inspect().profiles).toHaveLength(1);
  // Auth content is never opened: removal unlinks it with the profile tree.
  f.service.removeProfile({ actionId: randomUUID(), profileId: p.id, epoch: p.epoch, confirmSignedIn: true });
  expect(f.service.inspect().profiles).toHaveLength(0);
  expect(() => lstatSync(join(f.authorityHome, 'profiles', p.id))).toThrow();
});
test.skipIf(process.platform !== 'darwin')('profile removal refuses a held profile owner and finishes an interrupted erase on the next owner', async () => {
  const f = fixture(), p = f.prepare(), child = (f.login(p), f.children[0]);
  writeFileSync(join(f.calls[0].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 });
  child.emit('close', 0, null);
  // Profile-owner leases are the execution/inventory exclusion; a held lease refuses even a confirmed removal.
  const lease = { profileId: p.id, epoch: p.epoch };
  const holder = f.service.acquireProfileOwner({ ...lease, actionId: randomUUID(), kind: 'execution' });
  let error: any; try { f.service.removeProfile({ actionId: randomUUID(), ...lease, confirmSignedIn: true }); } catch (cause) { error = cause; }
  expect(error?.code).toBe('profile_owner_busy'); expect(error?.actionRecorded).toBe(false);
  // The precheck tolerates only the execution lease main is about to close.
  expect(() => f.service.checkRemovable({ ...lease, confirmSignedIn: true })).toThrow('Close the Native profile');
  expect(f.service.checkRemovable({ ...lease, confirmSignedIn: true, executionHeld: true })).toEqual({ signedIn: true });
  f.service.releaseProfileOwner(holder);
  const inventory = f.service.acquireProfileOwner({ ...lease, actionId: randomUUID(), kind: 'inventory' });
  expect(() => f.service.checkRemovable({ ...lease, confirmSignedIn: true, executionHeld: true })).toThrow('Close the Native profile');
  f.service.releaseProfileOwner(inventory);
  await f.service.destroy();
  let interrupted = false;
  const failing = createNativeAccountAuthorityFor(f, () => { interrupted = true; throw new Error('simulated crash after intent'); });
  expect(() => failing.removeProfile({ actionId: randomUUID(), ...lease, confirmSignedIn: true })).toThrow('simulated crash');
  expect(interrupted).toBe(true);
  const registry = JSON.parse(readFileSync(join(f.authorityHome, 'registry.json'), 'utf8'));
  expect(registry.profiles).toEqual([]);
  expect(registry.receipts.at(-1)).toMatchObject({ kind: 'remove-profile', state: 'prepared' });
  expect(lstatSync(join(f.authorityHome, 'profiles', p.id)).isDirectory()).toBe(true);
  // Simulate the crashed owner: its lock stays behind, so recovery is the only way forward.
  rmSync(join(f.authorityHome, 'owner.lock'));
  const recovered = f.create(); recovered.prepareProfile({ actionId: randomUUID(), label: 'After crash' });
  expect(() => lstatSync(join(f.authorityHome, 'profiles', p.id))).toThrow();
  expect(recovered.inspect().receipts.find((row: any) => row.kind === 'remove-profile').state).toBe('completed');
  await failing.destroy().catch(() => {});
});
function createNativeAccountAuthorityFor(f: any, afterRemovalIntent: () => void) {
  const service = createNativeAccountAuthority({ authorityHome: f.authorityHome, executable: f.binary,
    executableSha256: createHash('sha256').update(readFileSync(f.binary)).digest('hex'), stopGraceMs: 100,
    testHooks: { platform: 'darwin', probePolicy() {}, afterRemovalIntent } });
  return service;
}

test('profile Rename changes only user metadata, preserves exact active lease/config/login and refuses stale labels', async () => {
  const f = fixture(), prepared = f.prepare();
  f.login(prepared); writeFileSync(join(f.calls[0].config.env.CODEX_HOME, 'auth.json'), '', { mode: 0o600 }); f.children[0].emit('close', 0, null);
  const profile = f.service.inspect().profiles[0];
  const before = new Map(diskFiles(join(f.authorityHome, 'profiles')).map(file => [file, readFileSync(file)]));
  const lease = f.service.acquireProfileOwner({ profileId: profile.id, epoch: profile.epoch, actionId: randomUUID(), kind: 'execution' });
  const action = { actionId: randomUUID(), profileId: profile.id, epoch: profile.epoch, expectedLabel: profile.label, label: ' Renamed account ' };
  expect(f.service.renameProfile(action)).toEqual({ ...profile, label: 'Renamed account' });
  expect(f.service.inspect().activeCount).toBe(1); expect(f.calls).toHaveLength(1);
  for (const [file, bytes] of before) expect(readFileSync(file).equals(bytes)).toBe(true);
  expect(f.service.inspect().receipts.at(-1)).toMatchObject({ actionId: action.actionId, kind: 'rename-profile', state: 'completed' });
  expect(() => f.service.renameProfile({ ...action, actionId: randomUUID() })).toThrow('label changed');
  expect(() => f.service.renameProfile({ ...action, actionId: randomUUID(), expectedLabel: 'Renamed account', label: 'bad\nlabel' })).toThrow('plain Native');
  f.service.releaseProfileOwner(lease);
  await f.service.destroy();
  const restored = f.create(); expect(restored.inspect().profiles[0]).toEqual({ ...profile, label: 'Renamed account' });
});
