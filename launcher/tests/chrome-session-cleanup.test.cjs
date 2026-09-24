const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileFirstLogin } = require('../electron/profile-first-login.cjs');
const { verifyCapturedAccount, isVerifiedCaptureTransfer } = require('../electron/chrome-session-identity.cjs');

const storageState = { cookies: [{ name: 'session', value: 'fixture', domain: '.chatgpt.com', path: '/',
  expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }], origins: [] };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function fixture({ clear, close, fetchError } = {}) {
  const events = [];
  const dialogs = [];
  const controller = new AbortController();
  const capture = { storageState, cleanup: async () => { events.push('capture-cleanup'); } };
  const session = { fromPartition: () => ({
    cookies: { set: async () => { events.push('cookie'); } },
    fetch: async () => {
      assert.deepEqual(events, ['cookie']);
      events.push('fetch');
      if (fetchError) throw fetchError;
      return Response.json({ user: { id: 'fixture-user', email: 'fixture@example.com' } });
    },
    clearStorageData: () => {
      assert.deepEqual(events, ['cookie', 'fetch']);
      events.push('clear');
      return clear?.(controller);
    },
    closeAllConnections: () => {
      assert.deepEqual(events, ['cookie', 'fetch', 'clear']);
      events.push('close');
      return close?.(controller);
    },
  }) };
  const login = createProfileFirstLogin({
    choose: async () => ({ kind: 'existing', profile: { id: 'Default' },
      prepareCapture: async () => ({}),
      rollbackBinding: () => { events.push('rollback'); },
      cleanupCapture: () => { events.push('claim-cleanup'); },
      commitBinding: () => assert.fail('verification must not commit a binding'),
    }),
    runtime: { captureExistingChromeLogin: async () => capture, cancelExistingChromeLogin: async () => {} },
    session, dialog: { showMessageBox: async (_window, options) => {
      dialogs.push(options);
      return { response: 1 };
    } }, window: () => null, language: () => 'en',
  });
  return { events, dialogs, controller, session, capture,
    run: () => login(() => {}, { accountId: 'fixture', signal: controller.signal }) };
}

test('profile-first waits for storage and connections before accepting a verified capture', { timeout: 2000 }, async () => {
  const clearing = deferred();
  const closing = deferred();
  const f = fixture({ clear: () => clearing.promise, close: () => closing.promise });
  let settled = false;
  const pending = f.run().finally(() => { settled = true; });
  try {
    await new Promise(setImmediate);
    assert.deepEqual(f.events, ['cookie', 'fetch', 'clear']);
    assert.equal(settled, false);
    assert.equal(f.dialogs.length, 1);
    clearing.resolve();
    await new Promise(setImmediate);
    assert.deepEqual(f.events, ['cookie', 'fetch', 'clear', 'close']);
    assert.equal(settled, false);
    assert.equal(f.dialogs.length, 1);
    closing.resolve();
    const transfer = await pending;
    assert.equal(isVerifiedCaptureTransfer(transfer), true);
    assert.equal(f.dialogs[1].type, 'question');
    await transfer.cleanup();
  } finally {
    clearing.resolve();
    closing.resolve();
    await pending.catch(() => {});
  }
});

test('cleanup faults reach profile-first as safe actionable failures even after cancellation', { timeout: 2000 }, async () => {
  for (const stage of ['clear', 'close', 'both']) {
    const fault = controller => {
      controller.abort();
      throw Object.assign(new Error('SECRET /private/profile token=value'), { cause: 'SECRET' });
    };
    // Clear exercises a synchronous API throw; close exercises a rejected promise.
    const f = fixture({ clear: stage !== 'close' ? fault : undefined,
      close: stage !== 'clear' ? async controller => fault(controller) : undefined });
    await assert.rejects(f.run(), error => {
      assert.equal(error.code, 'existing_chrome_cleanup_failed');
      assert.equal(error.message, 'Temporary Chrome sign-in cleanup failed');
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(f.controller.signal.aborted, true);
    assert.deepEqual(f.events, ['cookie', 'fetch', 'clear', 'close', 'rollback', 'capture-cleanup', 'claim-cleanup']);
    assert.equal(f.dialogs.at(-1).type, 'error');
    assert.match(f.dialogs.at(-1).detail, /could not be cleaned up/);
    assert.doesNotMatch(JSON.stringify(f.dialogs), /SECRET|token=value/);
  }
});

test('successful teardown preserves the primary verifier failure and its profile-first classification', { timeout: 2000 }, async () => {
  const primary = Object.assign(new Error('Chrome returned an unverified ChatGPT account'), {
    code: 'chrome-account-unverified',
  });
  const direct = fixture({ fetchError: primary });
  await assert.rejects(verifyCapturedAccount(direct.session, direct.capture), error => error === primary);
  assert.deepEqual(direct.events, ['cookie', 'fetch', 'clear', 'close']);
  const consumer = fixture({ fetchError: primary });
  await assert.rejects(consumer.run(), error => error.code === primary.code && error.message === primary.message);
  assert.deepEqual(consumer.events, ['cookie', 'fetch', 'clear', 'close', 'rollback', 'capture-cleanup', 'claim-cleanup']);
});
