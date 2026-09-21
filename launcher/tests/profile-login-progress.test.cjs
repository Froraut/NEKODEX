const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileFirstLogin } = require('../electron/profile-first-login.cjs');
const { initialPasskeyProgress, publicPasskeyProgress } = require('../electron/passkey-login-progress.cjs');

test('Chrome capture remains active and cancellable through its distinct progress phases', async () => {
  let progress = initialPasskeyProgress();
  const deadlineAt = new Date(Date.now() + 60_000).toISOString();
  const login = createProfileFirstLogin({
    choose: async () => ({ kind: 'existing', profile: { id: 'Profile 5' },
      prepareCapture: async () => ({}), rollbackBinding() {} }),
    runtime: { async captureExistingChromeLogin(publish) {
      for (const phase of ['discovering', 'waiting-for-chrome', 'reading-session', 'complete']) {
        publish({ phase, deadlineAt });
        const visible = publicPasskeyProgress(progress);
        assert.equal(visible.active, true);
        assert.equal(visible.canCancel, true);
        assert.equal(visible.deadlineAt, deadlineAt);
      }
      throw Object.assign(new Error('fixture stopped'), { code: 'profile-login-cancelled' });
    } },
    session: {}, dialog: { showMessageBox: async () => ({ response: 1 }) },
    window: () => null, language: () => 'en',
  });
  await assert.rejects(login(patch => { progress = { ...progress, ...patch }; }, { accountId: 'default' }),
    error => error.code === 'profile-login-cancelled');
});
