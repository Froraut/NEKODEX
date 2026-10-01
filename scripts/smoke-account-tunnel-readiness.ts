import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'account-tunnel-readiness-'));
const previous = process.env.CODEX_CHATGPT_WEB_HOME;
process.env.CODEX_CHATGPT_WEB_HOME = root;
const { defaultConfig } = await import('../src/config');
const { startServer } = await import('../src/server');
const { TurnBroker } = await import('../src/adapters/chatgpt-web/turn-broker');
const config = { ...defaultConfig('full'), browserHost: 'launcher' as const,
  accountTunnelMode: true, accountTunnels: [], port: 0, brokerSocketPath: join(root, 'broker.sock') };
const server = startServer(config, { fetchUpstream: async () => new Response('{}', { status: 200 }) });
const base = `http://127.0.0.1:${server.port}`;
const send = (body: unknown) => fetch(`${base}/admin/tunnel-status`, { method: 'POST',
  headers: { authorization: `Bearer ${config.controlToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const a = { account_id: 'default', interaction_mode: 'automatic', tunnel_id: `tunnel_${'a'.repeat(32)}`, ready: true };
const b = { account_id: '00000000-0000-4000-8000-000000000002', interaction_mode: 'automatic', tunnel_id: `tunnel_${'b'.repeat(32)}`, ready: false };
try {
  assert.equal((await send({ ready: true, revision: 1 })).status, 400);
  assert.equal((await send({ ready: true, revision: 1, account_tunnels: [a, { ...a }] })).status, 400);
  assert.equal((await send({ ready: false, revision: 1, account_tunnels: [a, b] })).status, 400);
  assert.equal((await send({ ready: true, revision: 1, account_tunnels: [a, b] })).status, 200);
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.native_accepting_turns, true);
  assert.equal(health.tunnel_ready, true);
  assert.deepEqual(health.account_tunnels, [a, b]);
  assert.equal((await send({ ready: false, revision: 2, account_tunnels: [{ ...a, ready: false }, b] })).status, 200);
  const degraded = await (await fetch(`${base}/healthz`)).json();
  assert.equal(degraded.native_accepting_turns, true); assert.equal(degraded.tunnel_ready, false);
  assert.equal(degraded.web_accepting_turns, false);
  console.log('ACCOUNT_TUNNEL_READINESS_OK accurate-aggregate distinct-owners Native-independent');
} finally {
  server.disposeSignalHandlers(); server.stop(true);
  await TurnBroker.forSocket(config.brokerSocketPath).close();
  if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = previous;
  rmSync(root, { recursive: true, force: true });
}
