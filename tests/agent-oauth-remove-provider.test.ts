import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentOAuthService } from '../launcher/electron/agent-oauth-service.cjs';

const ready = { phase: 'ready', accessToken: 'fixture-access-token', refreshToken: 'fixture-refresh-token', expiresAt: Date.now() + 3_600_000 };

function fixture({ credential = false, revokeStatus = 200 } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'neko-oauth-remove-'));
  const file = join(home, 'selected-public-registration.json');
  const registration = { version: 1, providerId: 'fixture', label: 'Removable fixture provider', resource: 'https://resource.example.test/mcp',
    issuer: 'https://auth.example.test', clientId: 'registered-public-fixture-client', scopes: ['files:read'],
    registrationEvidenceUrl: 'https://auth.example.test/client-registration', redirectUriMode: 'loopback-port-variable',
    resourceMetadataUrl: 'https://resource.example.test/.well-known/oauth-protected-resource/mcp',
    authorizationServerMetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server' };
  writeFileSync(file, JSON.stringify(registration));
  // Stateful in-memory vault: one optional ready credential for the fixture provider scope.
  let entry: { revision: number; record: any } | null = credential ? { revision: 1, record: { ...ready } } : null;
  const posts: string[] = [];
  const vault = {
    read: async () => entry && structuredClone(entry),
    compareAndSet: async (_scope: unknown, revision: number, record: any) => {
      if (entry?.revision !== revision) throw new Error('revision conflict');
      entry = { revision: revision + 1, record }; return entry.revision;
    },
    remove: async (_scope: unknown, revision: number) => { if (entry?.revision !== revision) throw new Error('revision conflict'); entry = null; },
  };
  const service = createAgentOAuthService({ coreHome: home, getAuthority: () => ({ accountId: 'native:fixture-profile', epoch: 'epoch' }),
    protectedAvailable: () => true, openExternal: async () => {}, vault,
    approvedFetch: (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') { posts.push(String(url)); return new Response(null, { status: revokeStatus }); }
      return new Response(JSON.stringify(String(url) === registration.resourceMetadataUrl
        ? { resource: registration.resource, authorization_servers: [registration.issuer] }
        : { issuer: registration.issuer, authorization_endpoint: 'https://auth.example.test/authorize',
          token_endpoint: 'https://auth.example.test/token', revocation_endpoint: 'https://auth.example.test/revoke',
          code_challenge_methods_supported: ['S256'], response_types_supported: ['code'],
          token_endpoint_auth_methods_supported: ['none'] }), { status: 200 });
    }) as typeof fetch });
  const invalidations: (string | undefined)[] = [];
  let failInvalidation = false;
  service.subscribeMcpInvalidation((providerId: string | undefined) => {
    invalidations.push(providerId);
    if (failInvalidation) throw new Error('binding write not durable');
  });
  const registry = () => JSON.parse(readFileSync(join(home, 'agent-oauth', 'providers.json'), 'utf8'));
  const register = async () => {
    const review = await service.reviewProviderFile(file);
    await service.request({ action: 'oauthRegisterProvider', reviewId: review.reviewId, reviewDigest: review.reviewDigest, explicitUserAction: true });
  };
  return { service, posts, invalidations, registry, register, credential: () => entry, failBindings: () => { failInvalidation = true; },
    cleanup: () => { service.close(); rmSync(home, { recursive: true, force: true }); } };
}
const remove = { action: 'oauthRemoveProvider', providerId: 'fixture', explicitUserAction: true };

test('removal revokes a held credential, invalidates MCP bindings, then removes the row with a new registry revision', async () => {
  const f = fixture({ credential: true });
  try {
    await f.register();
    expect(f.registry()).toMatchObject({ revision: 1, providers: [{ config: { providerId: 'fixture' } }] });
    expect((await f.service.request({ action: 'oauthList' }) as { state: string }[])[0]!.state).toBe('connected');
    await expect(f.service.request({ ...remove, explicitUserAction: false })).rejects.toThrow();
    await expect(f.service.request({ ...remove, extra: true })).rejects.toThrow();
    const result = await f.service.request(remove) as { state: string; status: any };
    expect(result.state).toBe('removed');
    expect(f.posts).toEqual(['https://auth.example.test/revoke', 'https://auth.example.test/revoke']);
    expect(f.credential()).toBeNull();
    // Deny-first before revocation, then a strict acknowledgement before the registry write.
    expect(f.invalidations).toEqual(['fixture', 'fixture']);
    expect(f.registry()).toEqual({ version: 1, revision: 2, providers: [] });
    expect(result.status.oauthRegistry.state).toBe('empty');
    expect(await f.service.request({ action: 'oauthList' })).toEqual([]);
    await expect(f.service.request(remove)).rejects.toThrow();
  } finally { f.cleanup(); }
});

test('a disconnected or already revoked provider is removed without a network revocation', async () => {
  const f = fixture();
  try {
    await f.register();
    await f.service.request(remove);
    expect(f.posts).toEqual([]);
    expect(f.registry()).toEqual({ version: 1, revision: 2, providers: [] });
  } finally { f.cleanup(); }
});

test('a failed revocation or binding invalidation keeps the reviewed registration row', async () => {
  const failed = fixture({ credential: true, revokeStatus: 500 });
  try {
    await failed.register();
    await expect(failed.service.request(remove)).rejects.toThrow('removal not acknowledged');
    expect(failed.registry().revision).toBe(1); expect(failed.registry().providers).toHaveLength(1);
    expect(failed.credential()).not.toBeNull();
  } finally { failed.cleanup(); }
  const bindings = fixture();
  try {
    await bindings.register(); bindings.failBindings();
    await expect(bindings.service.request(remove)).rejects.toThrow('removal not acknowledged');
    expect(bindings.registry().revision).toBe(1); expect(bindings.registry().providers).toHaveLength(1);
  } finally { bindings.cleanup(); }
});
