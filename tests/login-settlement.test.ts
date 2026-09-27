import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { createChromeProfileBindingStore } = require("../launcher/electron/chrome-profile-binding.cjs");
const { publicPasskeyProgress, passkeyLoginFailure } = require("../launcher/electron/passkey-login-progress.cjs");
const { readProfilesWithPermission } = require("../launcher/electron/chrome-profile-choice.cjs");
const { captureProfileSession } = require("../launcher/electron/profile-first-login.cjs");

test("successful sign-in returns the settled pool receipt instead of a stale locked host snapshot", async () => {
  let held = false, published = false;
  const pool: any = { registry: { snapshot: () => ({ selectedId: 'default' }) },
    getHost: () => ({ openPasskeyLogin: async () => ({ navigationLocked: true }) }),
    acquireAccountOperation: () => { held = true; return () => { held = false; }; },
    publish: () => { published = !held && pool.passkeyImportLease === null; },
    snapshot: () => ({ navigationLocked: held, accountId: 'default', authenticated: true }) };
  expect(await AccountBrowserPool.prototype.openPasskeyLogin.call(pool)).toEqual({ navigationLocked: false, accountId: 'default', authenticated: true });
  expect(published).toBe(true);
});

test("verified Chrome compatibility metadata persists and permission failures retain actionable codes", () => {
  const directory = mkdtempSync(join(tmpdir(), 'nekodex-binding-'));
  const userAgent = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36';
  try {
    const store = createChromeProfileBindingStore(directory);
    store.begin('default', { id: 'Profile 5', name: 'Fixture' }).commit({ principalFingerprint: 'a'.repeat(64), browserUserAgent: userAgent });
    expect(createChromeProfileBindingStore(directory).read('default').browserUserAgent).toBe(userAgent);
    const failure = passkeyLoginFailure(Object.assign(new Error('timed out with private detail'), { code: 'chrome-permission-timeout' }),
      { aborted: false, progressPhase: 'importing' });
    const progress = publicPasskeyProgress({ phase: failure.phase, error: failure.errorCode, chromePhase: 'reading-session' });
    expect(progress.error).toBe('chrome-permission-timeout');
    expect(progress.active).toBe(false);
    expect(progress.chromePhase).toBeNull();
    expect(JSON.stringify(progress)).not.toContain('private detail');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("protected Chrome profile metadata uses the exact system-selected file and respects cancellation", async () => {
  const root = '/fixture/Chrome'; let reads = 0;
  const profiles = [{ id: 'Profile 5', name: 'Fixture' }];
  const read = () => { if (++reads === 1) throw Object.assign(new Error('Protected'), { code: 'EPERM' }); return profiles; };
  const options = { root, platform: 'darwin', read, language: 'en',
    dialog: { showOpenDialog: async (_parent: unknown, options: any) => {
      expect(options.defaultPath).toBe('/fixture/Chrome/Local State');
      expect(options.properties).toEqual(['openFile', 'noResolveAliases']);
      return { canceled: false, filePaths: ['/fixture/Chrome/Local State'] };
    } } };
  expect(await readProfilesWithPermission(options)).toEqual(profiles);
  expect(reads).toBe(2);
  reads = 0;
  await expect(readProfilesWithPermission({ ...options, dialog: { showOpenDialog: async () => ({ canceled: true }) } }))
    .rejects.toThrow('Sign-in cancelled');
  expect(reads).toBe(1);
  reads = 0;
  await expect(readProfilesWithPermission({ ...options, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/fixture/Chrome/Cookies'] }) } }))
    .rejects.toThrow('Select the Chrome Local State file');
  expect(reads).toBe(1);
});

test("protected Chrome discovery retries only the granted file and preserves the selected profile and cancellation", async () => {
  const controller = new AbortController();
  const context = { signal: controller.signal, accountId: 'fixture' };
  const claim = { nonce: 'fixture-claim' };
  const capture = { storageState: { cookies: [] } };
  const attempts: any[] = [];
  let grants = 0;
  const denied = Object.assign(new Error('Protected'), { code: 'chrome-profile-access-denied' });
  const options = { context, profileClaim: claim, onProgress() {},
    runtime: { platform: 'darwin', captureExistingChromeLogin: async (_progress: unknown, args: any) => {
      attempts.push(args);
      if (!Object.hasOwn(args, 'selectedDiscoveryContents')) throw denied;
      return capture;
    } },
    selectConnectionFile: async (received: unknown) => { grants++; expect(received).toBe(context); return 'private discovery'; },
  };
  expect(await captureProfileSession(options)).toBe(capture);
  expect(attempts).toEqual([{ profileClaim: claim }, { profileClaim: claim, selectedDiscoveryContents: 'private discovery' }]);
  expect(grants).toBe(1);
  attempts.length = 0;
  await expect(captureProfileSession({ ...options, selectConnectionFile: async () => null })).rejects.toThrow('Sign-in cancelled');
  expect(attempts).toHaveLength(1);
  attempts.length = 0;
  await expect(captureProfileSession({ ...options, selectConnectionFile: async () => {
    controller.abort(new Error('Account changed')); return 'private discovery';
  } })).rejects.toThrow('Account changed');
  expect(attempts).toHaveLength(1);
  const unavailable = Object.assign(new Error('Unavailable'), { code: 'chrome-unavailable' });
  await expect(captureProfileSession({ ...options, context: { signal: new AbortController().signal },
    runtime: { platform: 'darwin', captureExistingChromeLogin: async () => { throw unavailable; } } })).rejects.toBe(unavailable);
  expect(grants).toBe(1);
});
