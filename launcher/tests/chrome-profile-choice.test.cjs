const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createChromeProfileChoice, createProfileClaimServer, openProfile, readProfiles, selectMatch } = require('../electron/chrome-profile-choice.cjs');
const { createChromeProfileBindingStore } = require('../electron/chrome-profile-binding.cjs');
const { filterChromeProfiles } = require('../electron/chrome-profile-picker.cjs');
const { createProfileFirstLogin, verifyCapturedAccount } = require('../electron/profile-first-login.cjs');

function profileRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-profiles-'));
  fs.mkdirSync(path.join(root, 'Default'));
  fs.mkdirSync(path.join(root, 'Profile 2'));
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: {
    Default: { name: 'Work', user_name: 'Google-A@EXAMPLE.COM' },
    'Profile 2': { name: 'Personal ChatGPT', user_name: '' },
    '../escape': { name: 'Escape', user_name: 'bad@example.com' },
    'Profile 3': { name: 'Missing', user_name: 'missing@example.com' },
  } } }));
  return root;
}

test('profile metadata is safe and searchable without requiring a Google email', () => {
  const root = profileRoot();
  try {
    const profiles = readProfiles(root);
    assert.deepEqual(profiles, [
      { id: 'Default', name: 'Work', googleEmail: 'google-a@example.com' },
      { id: 'Profile 2', name: 'Personal ChatGPT', googleEmail: null },
    ]);
    assert.equal(filterChromeProfiles(profiles, 'personal')[0].id, 'Profile 2');
    assert.equal(filterChromeProfiles(profiles, 'GOOGLE-A')[0].id, 'Default');
    assert.equal(filterChromeProfiles(profiles, 'profile 2')[0].id, 'Profile 2');
    assert.equal(selectMatch(profiles, 'unrelated account label', { profileId: 'Profile 2' }).id, 'Profile 2');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('existing profile catalog is paired with the same macOS Stable Chrome executable', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const start = source.indexOf('const profileFirstLogin = createProfileFirstLogin');
  const end = source.indexOf('browserHost = new AccountBrowserPool', start);
  const wiring = source.slice(start, end);
  assert.match(wiring, /Application Support", "Google", "Chrome/);
  assert.match(wiring, /Applications\/Google Chrome\.app\/Contents\/MacOS\/Google Chrome/);
  assert.doesNotMatch(wiring, /executable:\s*\(\)\s*=>\s*runtimeHost\.passkeyChromeExecutable/);
});

test('successful bindings are durable, bounded, and never written by selection alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-bindings-'));
  try {
    const store = createChromeProfileBindingStore(root);
    fs.writeFileSync(store.file, '{corrupt');
    assert.equal(store.read('default'), null);
    const transaction = store.begin('default', { id: 'Profile 2', name: 'Personal', googleEmail: null });
    assert.equal(transaction.corruptPreviousFile, true);
    assert.equal(fs.readFileSync(store.file, 'utf8'), '{corrupt');
    const principalFingerprint = createHash('sha256').update('id:chatgpt-user-2').digest('hex');
    transaction.commit({ principalFingerprint, label: 'chatgpt-b@example.com' }, new Date('2026-09-21T12:00:00.000Z'));
    assert.deepEqual(store.read('default'), {
      profileId: 'Profile 2', profileName: 'Personal', googleEmail: null,
      chatgptLabel: 'chatgpt-b@example.com', principalFingerprint, verifiedAt: '2026-09-21T12:00:00.000Z',
    });
    const abandoned = store.begin('default', { id: 'Default', name: 'Work', googleEmail: 'google-a@example.com' });
    abandoned.rollback();
    assert.equal(store.read('default').profileId, 'Profile 2');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('profile choice opens the exact directory and stages a one-use context claim without saving', async () => {
  const root = profileRoot();
  try {
    const launches = [];
    const store = createChromeProfileBindingStore(root);
    const choose = createChromeProfileChoice({ root, coreHome: root, BrowserWindow: function Picker() {},
      window: () => null, executable: () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      language: () => 'en', bindingStore: store,
      picker: async ({ profiles }) => ({ kind: 'existing', profile: profiles[1] }),
      launch: async (...args) => {
        launches.push(args);
        if (args[2].startsWith('http://127.0.0.1:')) assert.equal((await fetch(args[2])).status, 200);
      } });
    const result = await choose({ accountId: 'default' });
    assert.equal(result.profile.id, 'Profile 2');
    assert.deepEqual(launches[0].slice(1), ['Profile 2', 'https://chatgpt.com/?temporary-chat=true']);
    assert.equal(store.read('default'), null);
    const claim = await result.prepareCapture();
    assert.match(claim.url, /^http:\/\/127\.0\.0\.1:[0-9]+\/nekodex-profile-claim-v1\/[A-Za-z0-9_-]{32}$/);
    assert.deepEqual(launches[1].slice(1), ['Profile 2', claim.url]);
    assert.equal(store.read('default'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('profile cancellation and isolated fallback do not launch or change a binding', async () => {
  const root = profileRoot();
  try {
    let launches = 0;
    for (const kind of ['cancel', 'new']) {
      const choose = createChromeProfileChoice({ root, coreHome: root, BrowserWindow: function Picker() {},
        window: () => null, executable: () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        language: () => 'en', picker: async () => ({ kind }), launch: async () => { launches++; } });
      assert.deepEqual(await choose({ accountId: 'default' }), { kind });
    }
    assert.equal(launches, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('profile claim uses an exact one-use loopback GET and releases its listener', async () => {
  const marker = await createProfileClaimServer({ timeoutMs: 1000 });
  try {
    assert.throws(() => openProfile('/unused/chrome', 'Profile 2', `about:blank#nekodex-profile-claim-v1=${marker.claim.nonce}`), /Invalid Chrome profile launch/);
    assert.equal((await fetch(marker.claim.url + '?extra=1')).status, 404);
    assert.equal((await fetch(marker.claim.url.replace(marker.claim.nonce, 'X'.repeat(32)))).status, 404);
    assert.equal((await fetch(marker.claim.url, { method: 'POST' })).status, 404);
    const response = await fetch(marker.claim.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /NEKODEX/);
    await marker.loaded;
    await assert.rejects(fetch(marker.claim.url));
  } finally { marker.cleanup(); }
});

test('unloaded and cancelled profile claims fail promptly and close their servers', async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const marker = await createProfileClaimServer({ signal: controller.signal, timeoutMs: 30 });
    try {
      if (cancel) controller.abort();
      await assert.rejects(marker.loaded, error => cancel ? error.name === 'AbortError' : error.code === 'chrome-profile-claim-missing');
      await assert.rejects(fetch(marker.claim.url));
    } finally { marker.cleanup(); }
  }
});

test('new isolated Chrome capture also verifies a ChatGPT principal before session installation', async () => {
  let cleaned = 0;
  const transfer = { storageState: { cookies: [{ name: 'session', value: 'fixture', domain: '.chatgpt.com', path: '/',
    expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] }, cleanup: async () => { cleaned++; } };
  const isolated = { cookies: { set: async () => {} },
    fetch: async () => new Response(JSON.stringify({ user: { id: 'isolated-chatgpt', email: 'isolated@example.com' } }),
      { headers: { 'content-type': 'application/json' } }), clearStorageData: async () => {}, closeAllConnections() {} };
  const login = createProfileFirstLogin({ choose: async () => ({ kind: 'new' }),
    runtime: { capturePasskeyLogin: async () => transfer }, session: { fromPartition: () => isolated },
    dialog: { showMessageBox: async () => assert.fail('no dialog expected') }, window: () => null, language: () => 'en' });
  const result = await login(() => {}, { accountId: 'default' });
  assert.equal(result.verifiedIdentity.label, 'isolated@example.com');
  assert.equal(cleaned, 0);
  assert.throws(() => result.commit({ authenticated: true, principalFingerprint: '0'.repeat(64) }), /does not match/);
  result.commit({ authenticated: true, principalFingerprint: result.verifiedIdentity.principalFingerprint });
});

test('actual ChatGPT identity is verified separately from Google metadata before handoff', async () => {
  let cleared = 0;
  let configured = 0;
  const transfer = { storageState: { cookies: [{ name: '__Secure-next-auth.session-token', value: 'fixture',
    domain: '.chatgpt.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] }, cleanup: async () => {} };
  const isolated = { cookies: { set: async () => {} },
    fetch: async () => new Response(JSON.stringify({ user: { id: 'actual-chatgpt-id', email: 'chatgpt-b@example.com' } }),
      { headers: { 'content-type': 'application/json' } }),
    clearStorageData: async () => { cleared++; }, closeAllConnections() {} };
  const identity = await verifyCapturedAccount({ fromPartition: () => isolated }, transfer, {
    accountId: 'second', configureSession: async (verificationSession, accountId) => {
      assert.equal(verificationSession, isolated); assert.equal(accountId, 'second'); configured++;
    },
  });
  assert.equal(identity.label, 'chatgpt-b@example.com');
  assert.equal(identity.principalFingerprint, createHash('sha256').update('id:actual-chatgpt-id').digest('hex'));
  assert.equal(cleared, 1);
  assert.equal(configured, 1);
});

test('profile-first login defers binding persistence until the installed-session receipt', async () => {
  let captureOptions;
  let committed = 0;
  let rolledBack = 0;
  let cleaned = 0;
  const transfer = { storageState: { cookies: [{ name: 'session', value: 'fixture', domain: '.chatgpt.com', path: '/',
    expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] }, cleanup: async () => { cleaned++; } };
  const isolated = { cookies: { set: async () => {} },
    fetch: async () => new Response(JSON.stringify({ user: { id: 'chatgpt-b', email: 'chatgpt-b@example.com' } }),
      { headers: { 'content-type': 'application/json' } }), clearStorageData: async () => {}, closeAllConnections() {} };
  const choice = { kind: 'existing', profile: { id: 'Profile 2', name: 'Personal', googleEmail: 'google-a@example.com' },
    previousBinding: null, prepareCapture: async () => ({ version: 1, nonce: 'D'.repeat(32),
      url: `http://127.0.0.1:43210/nekodex-profile-claim-v1/${'D'.repeat(32)}`, openedAt: new Date().toISOString() }),
    commitBinding: () => { committed++; }, rollbackBinding: () => { rolledBack++; } };
  const responses = [1, 1];
  const login = createProfileFirstLogin({ choose: async () => choice,
    runtime: { captureExistingChromeLogin: async (_progress, options) => { captureOptions = options; return transfer; },
      capturePasskeyLogin: async () => assert.fail('isolated login must not start'), cancelExistingChromeLogin: async () => {} },
    session: { fromPartition: () => isolated }, dialog: { showMessageBox: async () => ({ response: responses.shift() }) },
    window: () => null, language: () => 'en' });
  const result = await login(() => {}, { accountId: 'default' });
  assert.equal(captureOptions.profileClaim.nonce, 'D'.repeat(32));
  assert.equal(result.verifiedIdentity.label, 'chatgpt-b@example.com');
  assert.equal(committed, 0);
  assert.equal(rolledBack, 0);
  result.commit({ authenticated: true, principalFingerprint: result.verifiedIdentity.principalFingerprint });
  assert.equal(committed, 1);
  assert.equal(cleaned, 0);
});

test('declining a different actual ChatGPT principal cleans capture and preserves the old binding', async () => {
  let rolledBack = 0;
  let cleaned = 0;
  const transfer = { storageState: { cookies: [{ name: 'session', value: 'fixture', domain: '.chatgpt.com', path: '/',
    expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] }, cleanup: async () => { cleaned++; } };
  const isolated = { cookies: { set: async () => {} },
    fetch: async () => new Response(JSON.stringify({ user: { id: 'new-principal', email: 'new@example.com' } }),
      { headers: { 'content-type': 'application/json' } }), clearStorageData: async () => {}, closeAllConnections() {} };
  const choice = { kind: 'existing', profile: { id: 'Default', name: 'Work', googleEmail: 'google@example.com' },
    previousBinding: { principalFingerprint: createHash('sha256').update('id:old-principal').digest('hex'), chatgptLabel: 'old@example.com' },
    prepareCapture: async () => ({ version: 1, nonce: 'E'.repeat(32),
      url: `http://127.0.0.1:43210/nekodex-profile-claim-v1/${'E'.repeat(32)}`, openedAt: new Date().toISOString() }),
    commitBinding: () => assert.fail('binding must not commit'), rollbackBinding: () => { rolledBack++; } };
  const responses = [1, 0, 0];
  const login = createProfileFirstLogin({ choose: async () => choice,
    runtime: { captureExistingChromeLogin: async () => transfer, cancelExistingChromeLogin: async () => {} },
    session: { fromPartition: () => isolated }, dialog: { showMessageBox: async () => ({ response: responses.shift() }) },
    window: () => null, language: () => 'en' });
  await assert.rejects(login(() => {}, { accountId: 'default' }), error => error.code === 'profile-login-cancelled');
  assert.equal(cleaned, 1);
  assert.equal(rolledBack, 1);
});
