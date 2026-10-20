import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentToolsComposition, type AgentToolsComposition } from '../src/agent-tools/composition';
import { createAgentOAuthMcpToolsProvider } from '../src/agent-tools/oauth-mcp-provider';
import { createLauncherOAuthMcpBridge } from '../src/agent-tools/oauth-mcp-bridge';
import { createAgentOAuthMcpControlRoutes } from '../src/agent-tools/oauth-mcp-control';
const { createAgentOAuthMcpController } = require('../launcher/electron/oauth-mcp-controller.cjs');
const { createAgentOAuthMcpDescriptorPublisher } = require('../launcher/electron/agent-oauth-mcp-descriptor.cjs');
const { BrowserControlServer } = require('../launcher/electron/control-server.cjs');
const TOKEN = 'controlled-protected-token-never-leave-main';
const scope = { taskId: 'controlled-task', generation: 1, toolCallId: 'exact-tool-call' };
const publicProvider = { providerId: 'controlled', label: 'Controlled fixture', resource: 'https://mcp.example.com/mcp', issuer: 'https://auth.example.com/', clientId: 'reviewed-public-client', metadataDigest: '1'.repeat(64), accountId: 'native:controlled', epoch: '2'.repeat(64) };
async function fixture(lostAck = false) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'neko-oauth-mcp-feature-'));
  let epoch = publicProvider.epoch, active = true, calls = 0, tokenUses = 0, pending: any, composition: AgentToolsComposition;
  const invalidationListeners = new Set<(providerId?: string) => void>();
  const oauthService = { subscribeMcpInvalidation(listener: (providerId?: string) => void) { invalidationListeners.add(listener); return () => invalidationListeners.delete(listener); }, reviewedMcpProviders: () => [{ ...publicProvider, epoch }], async withAccessToken(input: any, use: any) {
    expect(input).toEqual({ providerId: publicProvider.providerId, resource: publicProvider.resource, accountId: publicProvider.accountId, epoch }); tokenUses++; return use(TOKEN);
  } };
  const routes = createAgentOAuthMcpControlRoutes({ runtime: () => ({ runner: { ownerId: 'fixture-owner' }, store: { getTask: () => ({ id: scope.taskId, generation: scope.generation, ownerMode: 'agent', ownerId: 'fixture-owner', status: active ? 'awaiting_input' : 'paused' }) } }) as any,
    tools: () => composition, authorize: () => true, canStart: () => active });
  let validationGate: { entered: () => void; wait: Promise<void>; action?: string } | undefined;
  async function validate(action: string, body: any) { const response = await routes(new Request('http://127.0.0.1/admin/agent-oauth-mcp', { method: 'POST', body: JSON.stringify({ action, ...body }) })); if (!response.ok) throw new Error('Actual core authority refused');
    if (validationGate && (!validationGate.action || validationGate.action === action)) { const gate = validationGate; validationGate = undefined; gate.entered(); await gate.wait; } }
  const providerOptions = { requestTimeoutMs: 400,
    dnsLookup(_host: any, _opts: any, done: any) { done(null, [{ address: '93.184.216.34', family: 4 }]); },
    httpsRequest(url: URL, input: any, response: any) {
      expect(url.href).toBe(publicProvider.resource); expect(input.headers.authorization).toBe('Bearer ' + TOKEN);
      const req: any = new EventEmitter(); let body = '', dead = false;
      req.setTimeout = () => req; req.write = (chunk: string) => { body += chunk; };
      req.destroy = () => { if (!dead) { dead = true; queueMicrotask(() => req.emit('error', new Error('Controlled loss ' + TOKEN))); } };
      input.signal.addEventListener('abort', () => req.destroy(), { once: true });
      req.end = () => queueMicrotask(() => input.lookup(url.hostname, { family: 4 }, (error: any) => {
        if (error || dead) { req.destroy(); return; }
        const message = body ? JSON.parse(body) : undefined;
        if (message?.method === 'tools/call') { calls++; if (lostAck) { req.destroy(); return; } }
        const stream: any = new PassThrough();
        stream.statusCode = input.method === 'DELETE' ? 204 : message?.method.startsWith('notifications/') ? 202 : 200;
        stream.headers = { 'content-type': 'application/json' };
        let result;
        if (message?.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'controlled', version: '1' } };
        if (message?.method === 'tools/list') result = { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };
        if (message?.method === 'tools/call') { expect(message.params).toEqual({ name: 'echo', arguments: { text: 'exact approved input' } }); result = { content: [{ type: 'text', text: TOKEN }], structuredContent: { echo: TOKEN } }; }
        response(stream); stream.end(result ? JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) : '');
      })); return req;
    },
  };
  const controllerOptions = { coreHome: home, oauthService, validateTask: (scope: any) => validate('validate-task', { scope }), validateIntent: (request: any) => validate('validate-intent', { request }), providerOptions };
  let controller = createAgentOAuthMcpController(controllerOptions);
  const server = await new BrowserControlServer({ logger: { info() {}, error() {} }, getAgentOAuthMcpController: () => controller, getAgentOAuthMcpInstance: () => publisher.instanceId }).start();
  const publisher = createAgentOAuthMcpDescriptorPublisher({ coreHome: home, profile: 'development', control: server.descriptor() }); publisher.publish();
  const bridge = createLauncherOAuthMcpBridge({ descriptorPath: publisher.path, expectedProfile: 'development', requestWaitMs: 2000 });
  composition = createAgentToolsComposition({ home, authorize: () => true, isScopeActive: () => active,
    oauthMcpTools: createAgentOAuthMcpToolsProvider({ bridge, isScopeActive: () => active }), resolveToolCall: () => pending });
  const attach = async () => { const review = await controller.request({ action: 'oauthMcpReview', providerId: publicProvider.providerId, scope, explicitUserAction: true }); await controller.request({ action: 'oauthMcpAttach', reviewId: review.reviewId, reviewDigest: review.reviewDigest, explicitUserAction: true }); return review; };
  return { home, bridge, composition, get controller() { return controller; }, attach, calls: () => calls, tokenUses: () => tokenUses,
    setCall(tool: any) { pending = { tool: tool.id, arguments: { binding: tool.inputSchema.properties.binding.const, input: { text: 'exact approved input' } }, idempotencyKey: 'exact-once' }; return { scope, ...pending }; },
    holdValidation(action?: string) { let enter!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; }); validationGate = { entered: enter, wait, action }; return { entered, release }; },
    revokeProvider() { for (const listener of invalidationListeners) listener(publicProvider.providerId); },
    stale() { epoch = '3'.repeat(64); }, inactive() { active = false; },
    async reopen() { await controller.close(); controller = createAgentOAuthMcpController(controllerOptions); },
    async close() { await composition.close(); await controller.close(); await server.close(); rmSync(home, { recursive: true, force: true }); },
  };
}
test('private real bridge + core journal + main protected SDK: attachment and discovery grant no effect; exact approval sends once', async () => {
  const f = await fixture();
  try {
    expect(await f.composition.toolsPort.discover(scope)).toHaveLength(0); expect(f.tokenUses()).toBe(0);
    await f.attach(); const [tool] = await f.composition.toolsPort.discover(scope); expect(tool!.serverId).toBe('oauth_mcp_tools');
    const request = f.setCall(tool);
    await expect(f.controller.dispatch('execute', request)).rejects.toThrow('authority refused'); expect(f.calls()).toBe(0);
    const result = await f.composition.approveInvoke(scope, true); expect(result.state).toBe('completed'); expect(f.calls()).toBe(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(await f.composition.approveInvoke(scope, true)).toEqual(result); expect(f.calls()).toBe(1);
    const status = f.controller.status(); expect(status.receipts[0].receiptCount).toBe(1); expect(status.receipts[0].receipts[0].state).toBe('completed');
    expect(JSON.stringify(status)).not.toContain(TOKEN); expect(readFileSync(join(f.home, 'agent-oauth-mcp', 'bindings.json'), 'utf8')).not.toContain(TOKEN);
    await f.reopen(); expect(f.controller.status().bindings).toHaveLength(0);
    expect(await f.bridge.receipt(request)).toMatchObject({ state: 'completed' }); expect(f.calls()).toBe(1);
  } finally { await f.close(); }
}, 8000);
test('lost acknowledgement remains unknown after main reopen; receipt and attempted repeat never redispatch', async () => {
  const f = await fixture(true);
  try {
    await f.attach(); const [tool] = await f.composition.toolsPort.discover(scope); const request = f.setCall(tool);
    expect((await f.composition.approveInvoke(scope, true)).state).toBe('outcome_unknown'); expect(f.calls()).toBe(1);
    await f.reopen(); expect(await f.bridge.receipt(request)).toMatchObject({ state: 'outcome_unknown' });
    expect((await f.controller.dispatch('execute', request)).state).toBe('outcome_unknown'); expect(f.calls()).toBe(1);
    expect(f.controller.status().receipts[0].heldUnknownCount).toBe(1);
  } finally { await f.close(); }
}, 8000);
test('task and account epoch are rechecked before attach/discovery; arbitrary pins do not reach protected service', async () => {
  const f = await fixture();
  try {
    const review = await f.controller.request({ action: 'oauthMcpReview', providerId: publicProvider.providerId, scope, explicitUserAction: true });
    f.stale(); await expect(f.controller.request({ action: 'oauthMcpAttach', reviewId: review.reviewId, reviewDigest: review.reviewDigest, explicitUserAction: true })).rejects.toThrow();
    await expect(f.controller.request({ action: 'oauthMcpReview', providerId: 'missing', scope, pin: review.pin, explicitUserAction: true })).rejects.toThrow();
    f.inactive(); await expect(f.attach()).rejects.toThrow('authority refused'); expect(f.tokenUses()).toBe(0);
  } finally { await f.close(); }
}, 8000);

test('provider revocation and task invalidation deny discovery; later explicit exact reattachment can discover again', async () => {
  const f = await fixture();
  try {
    await f.attach(); expect(await f.composition.toolsPort.discover(scope)).toHaveLength(1);
    const used = f.tokenUses(); f.revokeProvider();
    expect(f.controller.status().bindings).toHaveLength(0); expect(await f.composition.toolsPort.discover(scope)).toHaveLength(0); expect(f.tokenUses()).toBe(used);
    await f.attach(); expect(await f.composition.toolsPort.discover(scope)).toHaveLength(1);
    f.controller.invalidate(scope.taskId); expect(f.controller.status().bindings).toHaveLength(0);
    expect(await f.composition.toolsPort.discover(scope)).toHaveLength(0); expect(f.calls()).toBe(0);
  } finally { await f.close(); }
}, 8000);

test('invalidation during awaited core validation cannot restore a cleared review or attachment', async () => {
  const f = await fixture();
  try {
    let gate = f.holdValidation();
    const reviewing = f.controller.request({ action: 'oauthMcpReview', providerId: publicProvider.providerId, scope, explicitUserAction: true });
    await gate.entered; f.controller.invalidate(scope.taskId); gate.release(); await expect(reviewing).rejects.toThrow();
    const review = await f.controller.request({ action: 'oauthMcpReview', providerId: publicProvider.providerId, scope, explicitUserAction: true });
    gate = f.holdValidation();
    const attaching = f.controller.request({ action: 'oauthMcpAttach', reviewId: review.reviewId, reviewDigest: review.reviewDigest, explicitUserAction: true });
    await gate.entered; f.controller.invalidate(scope.taskId); gate.release(); await expect(attaching).rejects.toThrow();
    expect(f.controller.status().bindings).toHaveLength(0); expect(f.tokenUses()).toBe(0);
  } finally { await f.close(); }
}, 8000);

test('disconnect and explicit reattachment cannot revive an execute waiting on the old core admission', async () => {
  const f = await fixture();
  try {
    await f.attach(); const [tool] = await f.composition.toolsPort.discover(scope); f.setCall(tool);
    const gate = f.holdValidation('validate-intent');
    const invocation = f.composition.approveInvoke(scope, true); await gate.entered;
    await f.controller.request({ action: 'oauthMcpDisconnect', scope, explicitUserAction: true });
    expect(f.controller.status().bindings).toHaveLength(0); await f.attach();
    expect(await f.composition.toolsPort.discover(scope)).toHaveLength(1);
    gate.release(); expect((await invocation).state).toBe('outcome_unknown'); expect(f.calls()).toBe(0);
  } finally { await f.close(); }
}, 8000);
