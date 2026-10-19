import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentOAuthBroker, validateExactRedirectUri } from '../launcher/electron/agent-oauth.cjs';
import { createAgentOAuthLauncher } from '../launcher/electron/agent-oauth-launcher.cjs';
import { createAgentOAuthService, validateRegistrationFile } from '../launcher/electron/agent-oauth-service.cjs';
import type { OAuthProviderConfig } from '../src/agent-tools/oauth-types';
const PATH = '/oauth/callback/0123456789abcdef0123456789abcdef';
const input = { providerId: 'exact-fixture', explicitUserAction: true as const };
async function portOwner() {
  const server = createServer((_request, response) => { response.writeHead(503); response.end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as any).port as number, server, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}
function brokerFixture(uri: string) {
  const config: OAuthProviderConfig = { providerId: input.providerId, label: 'Exact redirect fixture', accountId: 'fixture-account', epoch: 1,
    resource: 'https://mcp.example.com/mcp/readonly', issuer: 'https://mcp.example.com', authorizationEndpoint: 'https://mcp.example.com/authorize',
    tokenEndpoint: 'https://mcp.example.com/token', clientId: 'already-registered-public-client', scopes: ['read'], codeChallengeMethodsSupported: ['S256'],
    authorizationResponseIssParameterSupported: true, redirectUriMode: 'loopback-exact', redirectUri: uri };
  let entry: any = null; const sends: URLSearchParams[] = [], opened: string[] = [];
  const broker = createAgentOAuthBroker({ providers: [config], authority: () => true,
    vault: { read: async () => entry, compareAndSet: async (_scope, _expected, record) => { entry = { revision: '1', record }; return '1'; }, remove: async () => { entry = null; } },
    transport: async (_endpoint, body) => { sends.push(body); return { status: 200, body: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600, scope: 'read' } }; } });
  const launcher = createAgentOAuthLauncher({ broker, openExternal: async value => { opened.push(value); } });
  return { broker, launcher, sends, opened, entry: () => entry };
}

test('exact registered loopback callback uses its bound port/path, refuses other path/port and exchanges the exact redirect once', async () => {
  const reservation = await portOwner(), uri = `http://127.0.0.1:${reservation.port}${PATH}`; await reservation.close();
  const f = brokerFixture(uri);
  try {
    await expect(f.broker.begin(input, uri.replace(PATH, '/oauth/callback/' + 'f'.repeat(32)))).rejects.toThrow('registered_redirect_mismatch');
    const otherPort = reservation.port === 65535 ? 65534 : reservation.port + 1;
    await expect(f.broker.begin(input, uri.replace(':' + reservation.port + '/', ':' + otherPort + '/'))).rejects.toThrow('registered_redirect_mismatch');
    expect(f.opened).toHaveLength(0); expect(f.sends).toHaveLength(0);
    await f.launcher.begin(input); expect(f.opened).toHaveLength(1);
    const authorization = new URL(f.opened[0]!); expect(authorization.searchParams.get('redirect_uri')).toBe(uri);
    expect(authorization.searchParams.get('scope')).toBe('read'); expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const query = new URLSearchParams({ code: 'synthetic-code', state: authorization.searchParams.get('state')!, iss: 'https://mcp.example.com' });
    expect((await fetch(uri.replace(PATH, PATH + '-other') + '?' + query)).status).toBe(400); expect(f.sends).toHaveLength(0);
    await expect(f.broker.callback(input.providerId, uri.replace(':' + reservation.port + '/', ':' + otherPort + '/') + '?' + query)).rejects.toThrow('invalid_callback');
    expect((await fetch(uri + '?' + query)).status).toBe(200); expect(f.sends).toHaveLength(1);
    expect(f.sends[0]!.get('redirect_uri')).toBe(uri); expect(f.entry().record.phase).toBe('ready');
    expect((await f.launcher.list())[0]!.state).toBe('connected');
  } finally { f.launcher.close(); }
}, 5000);

test('busy exact registered port fails closed before browser/token action, and never selects a fallback listener', async () => {
  const occupied = await portOwner(), uri = `http://127.0.0.1:${occupied.port}${PATH}`, f = brokerFixture(uri);
  try {
    await expect(f.launcher.begin(input)).rejects.toThrow('callback listener unavailable');
    expect(f.opened).toHaveLength(0); expect(f.sends).toHaveLength(0); expect(occupied.server.listening).toBe(true);
    expect(f.broker.hasOwner()).toBe(false);
  } finally { f.launcher.close(); await occupied.close(); }
}, 5000);

test('native registration review and saved registry preserve exact URI; malformed exact redirects and implicit legacy URI are refused', async () => {
  const reservation = await portOwner(), uri = `http://127.0.0.1:${reservation.port}${PATH}`; await reservation.close();
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-oauth-exact-'))), file = join(home, 'registration.json');
  const registration = { version: 1, providerId: input.providerId, label: 'Exact public fixture', resource: 'https://mcp.example.com/mcp/readonly', issuer: 'https://mcp.example.com', clientId: 'registered-fixture-client', scopes: ['read'],
    registrationEvidenceUrl: 'https://mcp.example.com/register', redirectUriMode: 'loopback-exact', redirectUri: uri,
    resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp/readonly', authorizationServerMetadataUrl: 'https://mcp.example.com/.well-known/oauth-authorization-server' };
  writeFileSync(file, JSON.stringify(registration)); let opened = 0;
  const options = { coreHome: home, getAuthority: () => ({ accountId: 'fixture-account', epoch: 1 }), protectedAvailable: () => true,
    openExternal: async () => { opened++; }, vault: { read: async () => null, compareAndSet: async () => { throw new Error('No token callback in this registration fixture'); }, remove: async () => {} },
    approvedFetch: (async (url: string | URL | Request) => new Response(JSON.stringify(String(url) === registration.resourceMetadataUrl
      ? { resource: registration.resource, authorization_servers: [registration.issuer], scopes_supported: ['read'] }
      : { issuer: registration.issuer, authorization_endpoint: 'https://mcp.example.com/authorize', token_endpoint: 'https://mcp.example.com/token',
          response_types_supported: ['code'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true }), { status: 200 })) as typeof fetch };
  const service = createAgentOAuthService(options); let restored: ReturnType<typeof createAgentOAuthService> | undefined;
  try {
    for (const bad of [uri.replace('127.0.0.1', 'localhost'), uri.replace('http:', 'https:'), uri + '?extra=1', uri + '#fragment', uri.replace(PATH, '/callback'), uri.replace(':' + reservation.port + '/', ':0/')]) {
      expect(() => validateExactRedirectUri(bad)).toThrow(); expect(() => validateRegistrationFile({ ...registration, redirectUri: bad })).toThrow();
    }
    expect(() => validateRegistrationFile({ ...registration, redirectUriMode: 'loopback-port-variable' })).toThrow();
    const { redirectUri: _redirectUri, ...legacy } = { ...registration, redirectUriMode: 'loopback-port-variable' };
    expect((validateRegistrationFile(legacy) as any).redirectUriMode).toBe('loopback-port-variable');
    const review = await service.reviewProviderFile(file); expect(review.redirectUriMode).toBe('loopback-exact'); expect(review.redirectUri).toBe(uri); expect(opened).toBe(0);
    await service.request({ action: 'oauthRegisterProvider', reviewId: review.reviewId, reviewDigest: review.reviewDigest, explicitUserAction: true });
    const saved = JSON.parse(readFileSync(join(home, 'agent-oauth', 'providers.json'), 'utf8')); expect(saved.providers[0].config.redirectUri).toBe(uri);
    expect(saved.providers[0].config.redirectUriMode).toBe('loopback-exact');
    restored = createAgentOAuthService(options); expect(restored.status().oauthRegistry.state).toBe('configured');
    await restored.request({ action: 'oauthBegin', providerId: input.providerId, explicitUserAction: true }); expect(opened).toBe(1);
    await restored.request({ action: 'oauthCancel', providerId: input.providerId, explicitUserAction: true });
  } finally { restored?.close(); service.close(); rmSync(home, { recursive: true, force: true }); }
}, 5000);
