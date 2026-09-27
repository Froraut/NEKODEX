import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require("../launcher/electron/account-pool.cjs");
const { createChromeProfileBindingStore } = require("../launcher/electron/chrome-profile-binding.cjs");
const { publicPasskeyProgress, passkeyLoginFailure } = require("../launcher/electron/passkey-login-progress.cjs");

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
