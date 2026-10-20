import { describe, expect, test } from 'bun:test';
import { createAgentOAuthBroker } from '../launcher/electron/agent-oauth.cjs';
import type { OAuthCredentialRecord, OAuthCredentialScope } from '../launcher/electron/agent-oauth.cjs';
import type { OAuthProviderConfig } from '../src/agent-tools/oauth-types';
import { validateAgentOAuthRequest } from '../src/agent-tools/oauth';

const config: OAuthProviderConfig = { providerId: 'fixture', label: 'Fixture MCP', accountId: 'account-a', epoch: 1,
  resource: 'https://mcp.example.test/api', issuer: 'https://auth.example.test', authorizationEndpoint: 'https://auth.example.test/authorize',
  tokenEndpoint: 'https://auth.example.test/token', revocationEndpoint: 'https://auth.example.test/revoke', clientId: 'explicit-fixture-client',
  scopes: ['files:read'], codeChallengeMethodsSupported: ['S256'], authorizationResponseIssParameterSupported: true };
const redirect = 'http://127.0.0.1:49152/oauth/callback/0123456789abcdef0123456789abcdef';
const input = { providerId: 'fixture', explicitUserAction: true as const };
function fixture() {
  let entry: { revision: string; record: OAuthCredentialRecord } | null = null, revision = 0, epoch = 1;
  const sends: { endpoint: string; body: URLSearchParams }[] = [];
  let handler = async (_endpoint: string, _body: URLSearchParams): Promise<{ status: number; body?: unknown }> => ({ status: 200,
    body: { token_type: 'Bearer', access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'files:read' } });
  const vault = {
    async read(_scope: OAuthCredentialScope) { return entry ? structuredClone(entry) : null; },
    async compareAndSet(scope: OAuthCredentialScope, expected: string | null, record: OAuthCredentialRecord) {
      expect(scope).toEqual({ kind: 'mcp-oauth', accountId: 'account-a', providerId: 'fixture', epoch: 1,
        issuer: config.issuer, resource: config.resource, clientId: config.clientId });
      if ((entry?.revision ?? null) !== expected) throw new Error('CAS conflict');
      entry = { revision: String(++revision), record: structuredClone(record) }; return entry.revision;
    },
    async remove(_scope: OAuthCredentialScope, expected: string) { if (entry?.revision !== expected) throw new Error('CAS conflict'); entry = null; },
  };
  const broker = createAgentOAuthBroker({ providers: [config], vault, authority: provider => provider.epoch === epoch,
    transport: async (endpoint, body) => { sends.push({ endpoint, body }); return handler(endpoint, body); }, now: () => 1000 });
  const callback = (url: string, overrides: Record<string, string> = {}) => {
    const authorization = new URL(url), response = new URL(redirect);
    response.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, iss: config.issuer, code: 'fixture-code', ...overrides }).toString();
    return response.href;
  };
  return { broker, sends, callback, entry: () => entry, setEpoch: (value: number) => { epoch = value; },
    handle: (value: typeof handler) => { handler = value; } };
}

describe('MCP OAuth protected handoff', () => {
  test('rejects wrong state/issuer/redirect, exchanges once with PKCE and binds exact resource', async () => {
    const f = fixture(), started = await f.broker.begin(input, redirect), url = new URL(started.authorizationUrl);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe(config.resource);
    await expect(f.broker.callback('fixture', f.callback(url.href, { state: 'wrong' }))).rejects.toThrow('invalid_callback');
    await expect(f.broker.callback('fixture', f.callback(url.href, { iss: 'https://wrong.example.test' }))).rejects.toThrow('issuer_mismatch');
    await expect(f.broker.callback('fixture', f.callback(url.href).replace(':49152/', ':49153/'))).rejects.toThrow('invalid_callback');
    expect(f.sends).toHaveLength(0);
    expect((await f.broker.callback('fixture', f.callback(url.href))).state).toBe('connected');
    expect(f.sends).toHaveLength(1); expect(f.sends[0]!.body.get('resource')).toBe(config.resource);
    expect(f.sends[0]!.body.get('code_verifier')!.length).toBeGreaterThanOrEqual(43);
    await expect(f.broker.callback('fixture', f.callback(url.href))).rejects.toThrow('callback_not_owned');
    await expect(f.broker.withAccessToken('fixture', 'https://other.example.test', async () => null)).rejects.toThrow();
    expect(await f.broker.withAccessToken('fixture', config.resource, async token => token === 'fixture-access')).toBe(true);
    expect(JSON.stringify(await f.broker.list())).not.toContain('fixture-access');
  });
  test('late code response cannot save credentials after account epoch changes', async () => {
    const f = fixture(), started = await f.broker.begin(input, redirect);
    let release!: (value: { status: number; body: unknown }) => void;
    f.handle(() => new Promise(resolve => { release = resolve; }));
    const callback = f.broker.callback('fixture', f.callback(started.authorizationUrl));
    await Promise.resolve(); await Promise.resolve();
    f.setEpoch(2); release({ status: 200, body: { token_type: 'Bearer', access_token: 'late-access', expires_in: 3600 } });
    await expect(callback).rejects.toThrow('stale_authority'); expect(f.entry()).toBeNull();
    expect((await f.broker.list())[0]!.state).toBe('unavailable');
  });
  test('unknown refresh/revocation retain protected pending phase and block replay/use', async () => {
    const f = fixture(), started = await f.broker.begin(input, redirect);
    await f.broker.callback('fixture', f.callback(started.authorizationUrl));
    f.handle(async () => { throw new Error('opaque network failure'); });
    await expect(f.broker.refresh(input)).rejects.toThrow('network_outcome_unknown');
    expect(f.entry()!.record.phase).toBe('refresh_pending');
    await expect(f.broker.refresh(input)).rejects.toThrow('refresh_unavailable');
    await expect(f.broker.withAccessToken('fixture', config.resource, async () => null)).rejects.toThrow('authorization_required');
    expect(f.sends).toHaveLength(2);
    const g = fixture(), authorization = await g.broker.begin(input, redirect);
    await g.broker.callback('fixture', g.callback(authorization.authorizationUrl));
    g.handle(async () => { expect(g.entry()!.record.phase).toBe('revocation_pending'); return { status: 200 }; });
    expect((await g.broker.revoke(input)).state).toBe('revoked'); expect(g.entry()).toBeNull();
    expect(g.sends.slice(1).map(send => send.body.get('token_type_hint'))).toEqual(['refresh_token', 'access_token']);
  });
  test('rotates refresh credentials, persists unknown revocation and rejects secret-bearing public actions', async () => {
    const f = fixture(), started = await f.broker.begin(input, redirect);
    await f.broker.callback('fixture', f.callback(started.authorizationUrl));
    f.handle(async (_endpoint, body) => {
      expect(body.get('refresh_token')).toBe('fixture-refresh');
      expect(f.entry()!.record.phase).toBe('refresh_pending');
      return { status: 200, body: { token_type: 'Bearer', access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 1800 } };
    });
    expect((await f.broker.refresh(input)).state).toBe('connected');
    expect(await f.broker.withAccessToken('fixture', config.resource, async token => token === 'rotated-access')).toBe(true);
    f.handle(async () => { throw new Error('revocation response lost'); });
    await expect(f.broker.revoke(input)).rejects.toThrow('network_outcome_unknown');
    expect(f.entry()!.record.phase).toBe('revocation_pending');
    await expect(f.broker.revoke(input)).rejects.toThrow('operation_outcome_unknown');
    expect(f.sends).toHaveLength(3);
    expect(() => validateAgentOAuthRequest({ action: 'oauthBegin', providerId: 'fixture', explicitUserAction: true, token: 'secret' })).toThrow();
    expect(() => validateAgentOAuthRequest({ action: 'oauthBegin', providerId: 'fixture' })).toThrow();
    expect(() => validateAgentOAuthRequest({ action: 'oauthCallback', callbackUrl: 'https://untrusted.test' })).toThrow();
    expect(validateAgentOAuthRequest({ action: 'oauthList' })).toEqual({ action: 'oauthList' });
    f.broker.invalidate('fixture');
    expect((await f.broker.list())[0]!.state).toBe('unavailable');
  });
});
