const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { BrowserHost } = require('../electron/browser-host.cjs');

test('setup reports a failed session fetch as unavailable rather than requiring login', async () => {
  const url = 'https://chatgpt.com/?temporary-chat=true';
  const fixture = {
    state: { authenticated: false },
    logger: { info() {} },
    view: { webContents: {
      getURL: () => url,
      isDestroyed: () => false,
      executeJavaScript: script => vm.runInNewContext(script, {
        URL, AbortController, setTimeout, clearTimeout,
        location: { href: url },
        document: { readyState: 'complete', querySelectorAll: () => [] },
        fetch: async () => { throw new Error('simulated network failure'); },
      }),
    } },
    setState(patch) { Object.assign(this.state, patch); },
    snapshot() { return this.state; },
  };
  await assert.rejects(
    BrowserHost.prototype.probeAuthentication.call(fixture, { forSetup: true }),
    /session verification is unavailable: session request failed/,
  );
  assert.equal(fixture.state.status, 'error');
  assert.equal(fixture.state.authenticated, false);
  assert.doesNotMatch(fixture.state.message, /Sign in/);
});
