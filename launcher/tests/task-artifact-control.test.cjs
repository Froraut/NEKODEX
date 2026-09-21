'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BrowserControlServer } = require('../electron/control-server.cjs');

test('artifact control routes preserve exact trace helper surface ownership and host paths', async () => {
  const surfaceId = 'S'.repeat(32);
  const leaseId = 'artifact_' + 'a'.repeat(32);
  const calls = [];
  const host = {
    browserInteractionMode: () => 'automatic',
    registerArtifactDownload(...args) {
      calls.push(['register', ...args]);
      return { leaseId };
    },
    async waitArtifactDownload(...args) {
      calls.push(['wait', ...args]);
      return {
        leaseId,
        traceId: args[0],
        helperPid: args[1],
        surfaceId: args[2],
        assistantTurnId: 'assistant-turn-1',
        filename: 'result.csv',
        partialPath: '/owned/core/artifacts/trace_123/.network.partial',
        receivedBytes: 42,
        downloadAuthority: 'chatgpt.com',
      };
    },
    cancelArtifactDownload(...args) {
      calls.push(['cancel', ...args]);
      return { cancelled: true };
    },
  };
  const logger = { info() {}, debug() {}, warn() {}, error() {} };
  const server = await new BrowserControlServer({
    logger,
    getBrowserHost: () => host,
    getPreferences: () => ({}),
  }).start();
  const descriptor = server.descriptor();
  const post = async (action, body) => {
    const response = await fetch(`${descriptor.endpoint}/v1/turn/artifact-${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  };
  const owner = { traceId: 'trace_123', helperPid: 1234, surfaceId };
  try {
    const registrationBody = {
      ...owner,
      mutationId: '11111111-1111-4111-8111-111111111111',
      assistantTurnId: 'assistant-turn-1',
      expectedFilename: 'result.csv',
      maxBytes: 50_000_000,
      deadlineMs: 60_000,
    };
    const registered = await post('register', registrationBody);
    assert.equal(registered.response.status, 200);
    assert.equal(registered.body.leaseId, leaseId);
    const replayedRegistration = await post('register', registrationBody);
    assert.equal(replayedRegistration.body.leaseId, leaseId);

    const waited = await post('wait', { ...owner, leaseId });
    assert.equal(waited.response.status, 200);
    assert.equal(waited.body.partialPath, '/owned/core/artifacts/trace_123/.network.partial');
    assert.equal(waited.body.receivedBytes, 42);

    const cancelled = await post('cancel', { ...owner, leaseId, reason: 'test cleanup' });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.cancelled, true);
    assert.deepEqual(calls.map(call => call[0]), ['register', 'wait', 'cancel']);

    const wrongSurface = await post('wait', { ...owner, surfaceId: 'short', leaseId });
    assert.equal(wrongSurface.response.status, 400);
    assert.match(wrongSurface.body.error, /surface/i);
  } finally {
    await server.close();
  }
});
