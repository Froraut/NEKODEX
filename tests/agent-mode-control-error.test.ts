import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { RuntimeSupervisor } = require('../launcher/electron/runtime-supervisor.cjs');
const { registerAgentMode } = require('../launcher/electron/ipc/agent-mode.cjs');

test('Agent control preserves a fixed stale-file reason while bounding and sanitizing error receipts', async () => {
  const stale = 'The workspace file changed after observation. Inspect its current revision and observe it again before verification.';
  const config = { host: '127.0.0.1', port: 17841, controlToken: 'inert-fixture' };
  const originalFetch = globalThis.fetch;
  let body: unknown = { ok: false, error: 'agent_action_conflict', message: stale };
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 409 })) as typeof fetch;
  const control = (...args: unknown[]) => RuntimeSupervisor.prototype.control.apply({}, args);
  try {
    let handler: (_event: unknown, body: unknown) => Promise<unknown>;
    registerAgentMode({
      handle: (_channel: string, callback: typeof handler) => { handler = callback; },
      runtimeHost: { supervisor: { readConfig: () => config, ownedAgentRuntimeReady: async () => true, control } },
    });
    // Exact backend fixed reason survives control -> registrar -> renderer error.
    await expect(handler!(undefined, { action: 'verify', taskId: 'task', actionId: 'action', reviewId: 'review' })).rejects.toThrow(stale);
    body = { ok: false, error: 'agent_action_conflict', message: 'private credential and file path', privateField: 'never exposed' };
    const sanitized = await control(config, 'agent-mode', { returnErrorReceipt: true });
    expect(sanitized).toEqual({ ok: false, error: 'agent_action_conflict', message: 'The Agent action could not be completed; inspect its current durable state before retrying.' });
    await expect(control(config, 'agent-mode', {})).rejects.toThrow('HTTP 409');
    await expect(control(config, 'resume', { returnErrorReceipt: true })).rejects.toThrow('HTTP 409');
    body = { ok: false, error: 'agent_action_conflict', message: 'x'.repeat(8193) };
    await expect(control(config, 'agent-mode', { returnErrorReceipt: true })).rejects.toThrow('HTTP 409');
  } finally { globalThis.fetch = originalFetch; }
});
