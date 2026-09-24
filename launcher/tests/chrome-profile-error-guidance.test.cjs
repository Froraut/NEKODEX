const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileFirstLogin } = require('../electron/profile-first-login.cjs');
const { chromeProfileErrorGuidance } = require('../electron/chrome-profile-error-guidance.cjs');

function fixture(language, code, { captured = false, cleanupFails = false, cancel = false } = {}) {
  const dialogs = [], events = [], controller = new AbortController();
  const secret = Object.assign(new Error('SECRET https://private.test/token'), { code, previousSessionRestored: true });
  const claim = { version: 1, nonce: 'fixture-profile-claim' };
  const fail = () => { if (cancel) controller.abort(); throw secret; };
  const capture = { storageState: { cookies: [{ name: 'session', value: 'fixture', domain: '.chatgpt.com', path: '/',
    expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] },
    cleanup: async () => { events.push('capture-cleanup'); if (cleanupFails) throw new Error('SECRET cleanup path'); } };
  const login = createProfileFirstLogin({
    choose: async () => ({ kind: 'existing', profile: { id: 'Default', name: 'Work' }, previousBinding: null,
      prepareCapture: async () => claim, commitBinding: () => assert.fail('failed login must not commit'),
      rollbackBinding: () => events.push('binding-rollback'), cleanupCapture: () => events.push('claim-cleanup') }),
    runtime: { captureExistingChromeLogin: async (_progress, options) => {
      assert.equal(options.profileClaim, claim);
      return captured ? capture : fail();
    }, cancelExistingChromeLogin: async () => events.push('cancel') },
    session: { fromPartition: () => ({ cookies: { set: async () => {} }, fetch: async () => fail(),
      clearStorageData: async () => events.push('verification-cleanup'), closeAllConnections() {} }) },
    dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return { response: 1 }; } },
    window: () => null, language: () => language,
  });
  return { login: () => login(() => {}, { accountId: 'default', signal: controller.signal }), dialogs, events };
}

test('profile-first errors give distinct localized actions and never expose raw helper diagnostics', async () => {
  for (const language of ['en', 'ru']) {
    const details = [];
    for (const code of ['chrome-too-old', 'chrome-profile-access-denied', 'launcher-authorization-failed', 'unknown-private-code', '__proto__']) {
      const f = fixture(language, code);
      await assert.rejects(f.login(), error => {
        assert.equal(error.code, ['unknown-private-code', '__proto__'].includes(code) ? 'import-failed' : code);
        assert.equal(error.previousSessionRestored, undefined);
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(error.message, /SECRET|private.test/);
        return true;
      });
      assert.deepEqual(f.events, ['binding-rollback', 'claim-cleanup']);
      assert.equal(f.dialogs.length, 2);
      assert.equal(f.dialogs[1].type, 'error');
      assert.doesNotMatch(JSON.stringify(f.dialogs), /SECRET|private.test|unknown-private-code|__proto__/);
      details.push(f.dialogs[1].detail);
    }
    assert.match(details[0], /144/);
    assert.match(details[1], language === 'ru' ? /файлам.*системных настройках/ : /file-access.*system settings/);
    assert.match(details[2], language === 'ru' ? /Перезапустите NEKODEX/ : /Restart NEKODEX/);
    assert.equal(new Set(details.slice(0, 4)).size, 4);
    assert.equal(details[3], details[4]);
  }
});

test('profile-first guidance covers permission, endpoint and missing-session recovery in both languages', () => {
  for (const language of ['en', 'ru']) {
    const expected = language === 'ru' ? [ /разрешите/, /время ожидания/, /chrome:\/\/inspect/, /chrome:\/\/inspect/, /Войдите.*ChatGPT/ ]
      : [ /approve/, /timed out/, /chrome:\/\/inspect/, /chrome:\/\/inspect/, /Sign in.*ChatGPT/ ];
    ['chrome-permission-denied', 'chrome-permission-timeout', 'chrome-unavailable', 'invalid-endpoint', 'session-missing']
      .forEach((code, i) => assert.match(chromeProfileErrorGuidance(code, language), expected[i]));
  }
});

test('profile-first verification failure cleans captured data and preserves cleanup failure on cancellation', async () => {
  for (const options of [{ captured: true }, { captured: true, cleanupFails: true, cancel: true }]) {
    const f = fixture('en', 'unknown-private-code', options);
    await assert.rejects(f.login(), error => {
      assert.equal(error.code, options.cleanupFails ? 'existing_chrome_cleanup_failed' : 'import-failed');
      assert.doesNotMatch(error.message, /SECRET|private.test/);
      return true;
    });
    assert.equal(f.events.filter(e => e === 'binding-rollback').length, 1);
    assert.equal(f.events.filter(e => e === 'capture-cleanup').length, 1);
    assert.equal(f.events.filter(e => e === 'claim-cleanup').length, 1);
    assert.ok(f.events.includes('verification-cleanup'));
    assert.equal(f.dialogs.length, 2);
    assert.doesNotMatch(JSON.stringify(f.dialogs), /SECRET|private.test/);
    if (options.cleanupFails) assert.match(f.dialogs[1].detail, /cleaned up/);
  }
});
