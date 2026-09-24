const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileFirstLogin } = require('../electron/profile-first-login.cjs');

function fixture(overrides = {}) {
  return createProfileFirstLogin({
    choose: async () => ({ kind: 'new' }), runtime: {}, session: {},
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    window: () => null, language: () => 'en', ...overrides,
  });
}

const privateError = () => Object.assign(new Error('SECRET /private/profile token=value'), {
  previousSessionRestored: true, cause: new Error('SECRET nested'),
});

// The browser-host caller trusts previousSessionRestored and publishes the thrown
// message inside withManualOperation before its own final error normalization.
test('selection and isolated-capture failures cannot forge installer rollback evidence or leak diagnostics', async () => {
  for (const stage of ['selection', 'capture', 'verification']) {
    let cleaned = 0;
    const login = fixture({
      choose: async () => { if (stage === 'selection') throw privateError(); return { kind: 'new' }; },
      runtime: { capturePasskeyLogin: async () => {
        if (stage === 'capture') throw privateError();
        return { storageState: {}, cleanup: async () => { cleaned++; } };
      } },
      session: { fromPartition: () => { throw privateError(); } },
    });
    await assert.rejects(login(() => {}, { accountId: 'default' }), error => {
      assert.equal(error.code, 'import-failed');
      assert.equal(error.previousSessionRestored, undefined);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.message, /SECRET|private|token=value/);
      return true;
    });
    assert.equal(cleaned, stage === 'verification' ? 1 : 0);
  }
});

test('isolated capture returned after cancellation is cleaned without verification; cleanup failure remains actionable', async () => {
  for (const cleanupFails of [false, true]) {
    const controller = new AbortController();
    let cleaned = 0;
    const login = fixture({
      runtime: { capturePasskeyLogin: async () => {
        controller.abort();
        return { storageState: {}, cleanup: async () => {
          cleaned++;
          if (cleanupFails) throw privateError();
        } };
      } },
      session: { fromPartition: () => assert.fail('cancelled capture must not start verification') },
    });
    await assert.rejects(login(() => {}, { accountId: 'default', signal: controller.signal }), error => {
      if (cleanupFails) {
        assert.equal(error.code, 'existing_chrome_cleanup_failed');
        assert.match(error.message, /cleanup/i); // browser-host cancellation classifier
      }
      assert.equal(error.previousSessionRestored, undefined);
      assert.doesNotMatch(error.message, /SECRET|private|token=value/);
      return true;
    });
    assert.equal(cleaned, 1);
  }
});

test('cancellation at the prepared-profile handoff never starts a new helper and releases its claim', async () => {
  const controller = new AbortController();
  const events = [];
  const login = fixture({
    choose: async () => ({ kind: 'existing', profile: { id: 'Default' },
      prepareCapture: async () => { controller.abort(); return {}; },
      rollbackBinding: () => events.push('rollback'), cleanupCapture: () => events.push('claim-cleanup') }),
    runtime: { cancelExistingChromeLogin: async () => events.push('cancel'),
      captureExistingChromeLogin: async () => assert.fail('cancelled operation must not acquire helper ownership') },
  });
  await assert.rejects(login(() => {}, { accountId: 'default', signal: controller.signal }));
  assert.deepEqual(events, ['cancel', 'rollback', 'claim-cleanup']);
});

test('isolated runtime legacy lifecycle failures retain fixed actionable timeout and cleanup diagnostics', async () => {
  for (const [message, code, pattern] of [
    ['Chrome timed out SECRET', 'profile-login-timeout', /timed out/i],
    ['Chrome did not exit SECRET', 'existing_chrome_cleanup_failed', /cleanup/i],
  ]) {
    const login = fixture({ runtime: { capturePasskeyLogin: async () => { throw new Error(message); } } });
    await assert.rejects(login(() => {}, { accountId: 'default' }), error => {
      assert.equal(error.code, code);
      assert.match(error.message, pattern);
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    });
  }
});
