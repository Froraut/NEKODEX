import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createOAuthMcpProvider, createOAuthMcpFetch } = require('../launcher/electron/oauth-mcp-transport.cjs');
const { oauthMcpPinDigest, oauthMcpInvocationHash, validateOAuthMcpPin, publicAddress } = require('../launcher/electron/oauth-mcp-contract.cjs');
const pin = { providerId: 'fixture', resource: 'https://mcp.example.com/mcp', endpoint: 'https://mcp.example.com/mcp',
  issuer: 'https://auth.example.com/', clientId: 'reviewed-public-client', metadataDigest: '1'.repeat(64), accountId: 'native:fixture', epoch: '2'.repeat(64), serverId: 'oauth_mcp_fixture' };
const scope = { taskId: 'fixture-task', generation: 1, toolCallId: 'fixture-call' };
const TOKEN = 'fixture-protected-token-DO-NOT-PUBLISH';
type Mode = 'json' | 'sse' | 'lost-ack' | '401' | 'cancel' | 'stale' | 'redirect';
function fixture(mode: Mode = 'json') {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'neko-oauth-mcp-'));
  let current: any = pin, available = true, tokenUses = 0, privateDns = false;
  const network: { method: string; message?: any; options: any }[] = [];
  let sawCall!: () => void; const callSeen = new Promise<void>(resolve => { sawCall = resolve; });
  const options = { pin, getReviewedPin: () => current, journalDirectory: join(home, 'journal'), requestTimeoutMs: 500,
    isScopeActive: () => available,
    oauthService: { async withAccessToken(received: any, use: (token: string) => Promise<any>) {
      expect(received).toEqual({ providerId: pin.providerId, resource: pin.resource, accountId: pin.accountId, epoch: pin.epoch });
      tokenUses++; return use(TOKEN);
    } },
    dnsLookup(_host: string, _options: any, done: any) { done(null, [{ address: privateDns ? '127.0.0.1' : '93.184.216.34', family: 4 }]); },
    httpsRequest(url: URL, input: any, response: any) {
      expect(url.href).toBe(pin.endpoint); expect(input.rejectUnauthorized).toBe(true); expect(input.minVersion).toBe('TLSv1.2');
      expect(input.agent).toBe(false); expect(input.headers.authorization).toBe('Bearer ' + TOKEN);
      const req: any = new EventEmitter(); let body = '', dead = false;
      req.setTimeout = () => req; req.write = (chunk: string) => { body += chunk; };
      req.destroy = () => { if (!dead) { dead = true; queueMicrotask(() => req.emit('error', new Error('synthetic transport loss ' + TOKEN))); } };
      input.signal.addEventListener('abort', () => req.destroy(), { once: true });
      req.end = () => queueMicrotask(() => input.lookup(url.hostname, { family: 4 }, (error: any) => {
        if (error) { req.destroy(); return; } if (dead) return;
        const message = body ? JSON.parse(body) : undefined;
        network.push({ method: input.method, message, options: input });
        if (message?.method === 'tools/call') {
          sawCall();
          if (mode === 'lost-ack') { req.destroy(); return; }
          if (mode === 'cancel') return;
          if (mode === 'stale') current = { ...pin, epoch: '3'.repeat(64) };
        }
        const stream: any = new PassThrough(); let result: any;
        stream.statusCode = input.method === 'DELETE' ? 204 : message?.method === 'notifications/initialized' || message?.method === 'notifications/cancelled' ? 202 : 200;
        if (message?.method === 'tools/call' && mode === '401') stream.statusCode = 401;
        if (mode === 'redirect') stream.statusCode = 302;
        stream.headers = { 'content-type': mode === 'sse' && message?.method === 'tools/call' ? 'text/event-stream' : 'application/json',
          ...(message?.method === 'initialize' ? { 'mcp-session-id': 'fixture-session' } : {}), location: 'https://evil.example.com/' };
        if (message?.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'controlled-fixture', version: '1' } };
        if (message?.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'untrusted ' + TOKEN, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };
        if (message?.method === 'tools/call') result = { content: [{ type: 'text', text: 'Bearer ' + TOKEN }], structuredContent: { echo: TOKEN } };
        response(stream);
        let encoded = result ? JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) : '';
        // Encode the entire echoed token as JSON unicode escapes, defeating literal byte replacement.
        encoded = encoded.split(TOKEN).join([...TOKEN].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join(''));
        stream.end(mode === 'sse' && message?.method === 'tools/call' ? 'event: message\ndata: ' + encoded + '\n\n' : encoded);
      }));
      return req;
    },
  };
  const provider = createOAuthMcpProvider(options);
  const request = (id = 'immutable-invocation') => {
    const input: any = { scope, tool: pin.serverId + '/echo', arguments: { binding: oauthMcpPinDigest(pin), input: { text: 'approved exact payload' } }, idempotencyKey: id };
    input.invocationHash = oauthMcpInvocationHash(pin, input); return input;
  };
  return { home, provider, options, request, network, callSeen, tokenUses: () => tokenUses, privateDns: () => { privateDns = true; },
    stale: () => { current = null; }, inactive: () => { available = false; },
    cleanup: async () => { await provider.close(); rmSync(home, { recursive: true, force: true }); } };
}
for (const mode of ['json', 'sse'] as const) test(`controlled ${mode} SDK handshake, discovered pin, exact one approved call and token echo suppression`, async () => {
  const f = fixture(mode);
  try {
    const tools = await f.provider.discover(scope);
    expect(tools).toHaveLength(1); expect(tools[0].inputSchema.properties.binding.const).toBe(oauthMcpPinDigest(pin));
    expect(JSON.stringify(tools)).not.toContain(TOKEN);
    const request = f.request(); const result = await f.provider.execute(request);
    expect(result.state).toBe('completed'); expect(result.result.structuredContent.echo).toBe('[protected]');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(await f.provider.execute(request)).toEqual(result);
    expect(f.network.filter(row => row.message?.method === 'tools/call')).toHaveLength(1);
    expect(f.network.some(row => row.method === 'GET')).toBe(false);
    const call = f.network.find(row => row.message?.method === 'tools/call')!;
    expect(call.options.headers['mcp-session-id']).toBe('fixture-session'); expect(call.options.headers['mcp-protocol-version']).toBe('2025-11-25');
    const disk = readFileSync(join(f.home, 'journal/receipts.json'), 'utf8'); expect(disk).not.toContain(TOKEN); expect(disk).not.toContain('approved exact payload');
    await expect(f.provider.execute({ ...request, arguments: { ...request.arguments, input: { text: 'changed' } } })).rejects.toThrow();
  } finally { await f.cleanup(); }
}, 3000);
for (const mode of ['lost-ack', '401', 'stale'] as const) test(`${mode} preserves unknown remote effect and refuses replay across a provider reconstruction`, async () => {
  const f = fixture(mode);
  try {
    await f.provider.discover(scope); const request = f.request();
    const result = await f.provider.execute(request); expect(result.state).toBe('outcome_unknown');
    expect(f.provider.status().heldUnknownCount).toBe(1);
    expect(await f.provider.execute(request)).toEqual(result);
    await f.provider.close(); const restored = createOAuthMcpProvider(f.options);
    try { expect(await restored.execute(request)).toEqual(result); expect(restored.reconcile(request)).toEqual(result); }
    finally { await restored.close(); }
    expect(f.network.filter(row => row.message?.method === 'tools/call')).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  } finally { await f.cleanup(); }
}, 3000);
test('scope cancellation stops only local ownership and retains unknown remote effect', async () => {
  const f = fixture('cancel');
  try {
    await f.provider.discover(scope); const request = f.request();
    const pending = f.provider.execute(request); await f.callSeen; f.provider.invalidate(scope.taskId);
    expect((await pending).state).toBe('outcome_unknown'); expect(f.provider.status().activeCount).toBe(0);
    expect(f.provider.reconcile(request).state).toBe('outcome_unknown');
    expect(f.network.filter(row => row.message?.method === 'tools/call')).toHaveLength(1);
  } finally { await f.cleanup(); }
}, 3000);
test('DNS rejects mixed/private socket answers, redirects do not follow, exact pin/hash are mandatory', async () => {
  const f = fixture();
  try {
    f.privateDns(); await expect(f.provider.discover(scope)).rejects.toThrow(); expect(f.network).toHaveLength(0);
    expect(publicAddress('127.0.0.1')).toBe(false); expect(publicAddress('::ffff:93.184.216.34')).toBe(false);
    expect(publicAddress('192.0.2.1')).toBe(false); expect(publicAddress('2001:db8::1')).toBe(false);
    expect(() => validateOAuthMcpPin({ ...pin, endpoint: 'http://mcp.example.com/mcp' })).toThrow();
    expect(() => validateOAuthMcpPin({ ...pin, clientId: 'different', resource: 'https://mcp.example.com/' })).toThrow();
  } finally { await f.cleanup(); }
  const redir = fixture('redirect');
  try { await expect(redir.provider.discover(scope)).rejects.toThrow(); expect(redir.network).toHaveLength(1); }
  finally { await redir.cleanup(); }
}, 3000);
test('independent fetch fence consumes tools/call once, without SDK retry dependence', async () => {
  let dispatched = 0;
  const fetch = createOAuthMcpFetch({ endpoint: pin.endpoint, token: TOKEN, signal: new AbortController().signal, assertCurrent() {},
    onToolDispatch() { dispatched++; }, expectedCall: { name: 'echo', arguments: {} },
    httpsRequest() { throw new Error('synthetic first send failure'); } });
  const input = { method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } }) };
  await expect(fetch(pin.endpoint, input)).rejects.toThrow(); await expect(fetch(pin.endpoint, input)).rejects.toThrow(); expect(dispatched).toBe(1);
}, 1000);
