import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { semanticAttemptTerminal } from '../launcher/src/AgentModeSurface';
import { stripIpcErrorPrefix } from '../launcher/src/ipc-error';
import { browserCompanionRequest } from '../src/browser-companion/http';
import { createBrowserCompanionRuntime } from '../src/browser-companion/runtime';
const require = createRequire(import.meta.url);
const { RuntimeSupervisor, AGENT_CONFLICT_PASSTHROUGH, BROWSER_COMPANION_REFUSALS } = require('../launcher/electron/runtime-supervisor.cjs') as {
  RuntimeSupervisor: { prototype: { control: (...args: unknown[]) => Promise<unknown> } }; AGENT_CONFLICT_PASSTHROUGH: readonly string[]; BROWSER_COMPANION_REFUSALS: readonly string[];
};
const { registerAgentMode } = require('../launcher/electron/ipc/agent-mode.cjs');
const { registerBrowserCompanion } = require('../launcher/electron/ipc/browser-companion.cjs');

const config = { host: '127.0.0.1', port: 17841, controlToken: 'inert-fixture' };
const control = (...args: unknown[]) => RuntimeSupervisor.prototype.control.apply({}, args);
const generic = 'The Agent action could not be completed; inspect its current durable state before retrying.';
/** Every passed-through refusal must stay a literal the daemon owner actually throws. */
function sourceLiterals(...paths: string[]): string {
  const root = join(import.meta.dir, '..');
  return paths.flatMap(path => path.endsWith('.ts') ? [path] : readdirSync(join(root, path)).filter(name => name.endsWith('.ts')).map(name => join(path, name)))
    .map(path => readFileSync(join(root, path), 'utf8')).join('\n');
}

test('Agent control preserves a fixed stale-file reason while bounding and sanitizing error receipts', async () => {
  const stale = 'The workspace file changed after observation. Inspect its current revision and observe it again before verification.';
  const originalFetch = globalThis.fetch;
  let body: unknown = { ok: false, error: 'agent_action_conflict', message: stale };
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 409 })) as unknown as typeof fetch;
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
    expect(sanitized).toEqual({ ok: false, error: 'agent_action_conflict', message: generic });
    await expect(control(config, 'agent-mode', {})).rejects.toThrow('HTTP 409');
    await expect(control(config, 'resume', { returnErrorReceipt: true })).rejects.toThrow('HTTP 409');
    body = { ok: false, error: 'agent_action_conflict', message: 'x'.repeat(8193) };
    await expect(control(config, 'agent-mode', { returnErrorReceipt: true })).rejects.toThrow('HTTP 409');
  } finally { globalThis.fetch = originalFetch; }
});

test('Agent control passes the exact semantic-review and Verify refusals, so the renderer can start a new explicit review', async () => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 409 })) as unknown as typeof fetch;
  try {
    let handler: (_event: unknown, body: unknown) => Promise<unknown>;
    registerAgentMode({
      handle: (_channel: string, callback: typeof handler) => { handler = callback; },
      runtimeHost: { supervisor: { readConfig: () => config, ownedAgentRuntimeReady: async () => true, control } },
    });
    const daemon = sourceLiterals('src/agent-mode', 'src/server.ts');
    for (const message of AGENT_CONFLICT_PASSTHROUGH) {
      expect(daemon).toContain(JSON.stringify(message));
      body = { ok: false, error: 'agent_action_conflict', message };
      expect(await control(config, 'agent-mode', { returnErrorReceipt: true })).toEqual({ ok: false, error: 'agent_action_conflict', message });
    }
    // The durable attempt terminals reach the renderer's retry rule through the registrar.
    const terminals = AGENT_CONFLICT_PASSTHROUGH.filter(message => semanticAttemptTerminal.test(message));
    expect(terminals).toEqual([
      'Task semantic review attempt already exists for this action; inspect its receipt and start a new explicit review',
      'Task semantic reviewer returned no valid verdict; inspect its attempt receipt before an explicit new review',
      'Task semantic review outcome is unknown; inspect its attempt receipt before an explicit new review',
      'Stale task semantic review: the task ledger changed during review; its result receipt is retained',
      'Stale task semantic review scope',
    ]);
    for (const message of terminals) {
      body = { ok: false, error: 'agent_action_conflict', message };
      const failure = await handler!(undefined, { action: 'semantic-review', taskId: 'task', actionId: 'action', scope: { familyId: 'task', generation: 1, revision: 1 },
        reviewer: { provider: 'local-responses', model: 'reviewer' }, explicitUserAction: true }).catch((error: Error) => error);
      expect(semanticAttemptTerminal.test(stripIpcErrorPrefix(`Error invoking remote method 'launcher:agent-mode': ${failure}`))).toBe(true);
    }
    // Near misses, dynamic content and other codes keep their fixed generic text.
    for (const message of ['Task semantic reviewer returned no valid verdict; see /Users/fixture/private.json', 'Task semantic review', 'Requirement outcome is not verified.', 42]) {
      body = { ok: false, error: 'agent_action_conflict', message };
      expect(await control(config, 'agent-mode', { returnErrorReceipt: true })).toEqual({ ok: false, error: 'agent_action_conflict', message: generic });
    }
    body = { ok: false, error: 'invalid_request', message: AGENT_CONFLICT_PASSTHROUGH[1] };
    expect(await control(config, 'agent-mode', { returnErrorReceipt: true })).toEqual({ ok: false, error: 'invalid_request', message: 'The Agent action does not match its bounded schema.' });
  } finally { globalThis.fetch = originalFetch; }
});

test('browser-companion refusals reach the renderer with their exact fixed reason; other text and shapes keep the HTTP status', async () => {
  const runtime = createBrowserCompanionRuntime({ startListener: () => ({ stop() {} }) });
  const originalFetch = globalThis.fetch;
  let crafted: { status: number; body: string } | undefined;
  // The real owner route answers unless a crafted response is armed.
  globalThis.fetch = (async (url: string, init: RequestInit) => crafted ? new Response(crafted.body, { status: crafted.status })
    : browserCompanionRequest(new Request(url, init), () => runtime)) as unknown as typeof fetch;
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  registerBrowserCompanion({ handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn),
    runtimeHost: { supervisor: { readConfig: () => config, ownedRuntimeReady: async () => true, control } } });
  const ipc = (body: object) => handlers.get('launcher:browser-companion')!(null, body).then(() => 'accepted', (error: Error) => error.message);
  const bind = { action: 'bind-chatgpt', chatgpt: { modelId: 'gpt-5.6-sol', reasoning: 'high' } };
  try {
    const owner = sourceLiterals('src/browser-companion');
    for (const message of BROWSER_COMPANION_REFUSALS) expect(owner).toContain(JSON.stringify(message));
    expect(await ipc(bind)).toBe('Enable the local companion listener first');
    await runtime.enable('c'.repeat(32));
    expect(await ipc(bind)).toBe('Pair the companion and select the ChatGPT tab first');
    expect(await ipc({ action: 'release-chatgpt-held', operationId: 'chatgpt_send:none' })).toBe('No held ChatGPT companion outcome has that operation ID');
    expect(await ipc({ action: 'create-pairing' })).toBe('accepted');
    for (const [status, body] of [[400, { ok: false, error: 'The page asked you to open https://example.invalid/login' }],
      [400, { ok: false, error: BROWSER_COMPANION_REFUSALS[0], detail: 'extra field' }], [400, { ok: false, error: `${BROWSER_COMPANION_REFUSALS[0]} ${'x'.repeat(5000)}` }],
      [401, { ok: false, error: BROWSER_COMPANION_REFUSALS[0] }]] as const) {
      crafted = { status, body: JSON.stringify(body) };
      expect(await ipc({ action: 'status' })).toBe(`HTTP ${status}`);
    }
    crafted = { status: 400, body: 'not json' };
    expect(await ipc({ action: 'status' })).toBe('HTTP 400');
  } finally { globalThis.fetch = originalFetch; await runtime.close(); }
});
