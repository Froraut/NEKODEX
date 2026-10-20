import { expect, test } from 'bun:test';
import { createOAuthProtectedVault } from '../launcher/electron/agent-oauth-vault.cjs';
import { createAgentOAuthBroker } from '../launcher/electron/agent-oauth.cjs';
import type { OAuthCredentialRecord, OAuthCredentialScope } from '../launcher/electron/agent-oauth.cjs';
const scope: OAuthCredentialScope = { kind: 'mcp-oauth', accountId: 'a', providerId: 'p', epoch: 1,
  issuer: 'https://auth.example.test', resource: 'https://mcp.example.test', clientId: 'fixture' };
const ready: OAuthCredentialRecord = { phase: 'ready', accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: 1e12 };
function fixture() {
  const entries = new Map<string, any>(); let writes = 0, unknownAfterCommit = false;
  const backend = { request(raw: unknown) {
    const request = raw as any, stored = entries.get(request.scopeHash);
    if (request.operation === 'read') return stored ? { version: 1, status: 'ok', entry: structuredClone(stored) } : { version: 1, status: 'not-found' };
    if ((stored?.revision ?? null) !== request.expectedRevision) return { version: 1, status: 'conflict' };
    if (request.operation === 'remove') { entries.delete(request.scopeHash); return { version: 1, status: 'ok', removed: true }; }
    writes++; entries.set(request.scopeHash, structuredClone(request.entry));
    if (unknownAfterCommit) throw new Error('secret must never escape backend failure');
    return { version: 1, status: 'ok', revision: request.entry.revision };
  } };
  const open = (coreHome = '/tmp/nekodex-oauth-fixture') => createOAuthProtectedVault({ coreHome, backend });
  return { open, writes: () => writes, unknown: () => { unknownAfterCommit = true; } };
}
test('protected scope separates home/account/epoch/resource and CAS preserves winner', async () => {
  const f = fixture(), vault = f.open();
  const first = await vault.compareAndSet(scope, null, ready);
  expect(await f.open().read(scope)).toEqual({ revision: first, record: ready });
  for (const changed of [{ accountId: 'b' }, { epoch: 2 }, { providerId: 'q' }, { resource: 'https://other.example.test' }, { clientId: 'other' }]) {
    expect(await vault.read({ ...scope, ...changed })).toBeNull();
  }
  expect(await f.open('/tmp/nekodex-oauth-other').read(scope)).toBeNull();
  const outcomes = await Promise.allSettled([
    vault.compareAndSet(scope, first, { ...ready, phase: 'refresh_pending' }),
    f.open().compareAndSet(scope, first, { ...ready, phase: 'revocation_pending' }),
  ]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const persisted = await f.open().read(scope);
  expect(persisted!.record.phase).toBe('refresh_pending');
  await expect(vault.remove(scope, first)).rejects.toMatchObject({ code: 'conflict' });
  expect(await vault.read(scope)).toEqual(persisted);
  await vault.remove(scope, persisted!.revision); expect(await vault.read(scope)).toBeNull();
});
test('uncertain committed pending phase survives reopen and broker refuses replay or token use', async () => {
  const f = fixture(), vault = f.open(); const revision = await vault.compareAndSet(scope, null, ready);
  f.unknown();
  await expect(vault.compareAndSet(scope, revision, { ...ready, phase: 'refresh_pending' })).rejects.toThrow('Protected OAuth vault unavailable');
  expect(f.writes()).toBe(2); expect((await f.open().read(scope))!.record.phase).toBe('refresh_pending');
  let sends = 0;
  const broker = createAgentOAuthBroker({ providers: [{ ...scope, label: 'Fixture', authorizationEndpoint: `${scope.issuer}/authorize`,
    tokenEndpoint: `${scope.issuer}/token`, revocationEndpoint: `${scope.issuer}/revoke`, scopes: [], codeChallengeMethodsSupported: ['S256'] }],
    vault: f.open(), authority: () => true, transport: async () => { sends++; return { status: 200 }; } });
  expect((await broker.status('p')).state).toBe('refresh_pending');
  await expect(broker.refresh({ providerId: 'p', explicitUserAction: true })).rejects.toThrow('refresh_unavailable');
  await expect(broker.revoke({ providerId: 'p', explicitUserAction: true })).rejects.toThrow('operation_outcome_unknown');
  await expect(broker.withAccessToken('p', scope.resource, async () => true)).rejects.toThrow('authorization_required');
  expect(sends).toBe(0);
});
test('unavailable native helper fails closed and malformed protected record is rejected', async () => {
  const vault = createOAuthProtectedVault({ coreHome: '/tmp/nekodex-oauth-fixture', helperPath: '/nonexistent/nekodex-oauth-vault-helper' });
  await expect(vault.read(scope)).rejects.toMatchObject({ code: 'unavailable' });
  const corrupt = createOAuthProtectedVault({ coreHome: '/tmp/nekodex-oauth-fixture', backend: {
    request() { return { version: 1, status: 'ok', entry: { scopeHash: 'wrong', revision: 'wrong', record: ready } }; },
  } });
  await expect(corrupt.read(scope)).rejects.toMatchObject({ code: 'corrupt' });
  await expect(corrupt.read({ ...scope, accountId: undefined } as any)).rejects.toMatchObject({ code: 'invalid-input' });
  await expect(corrupt.compareAndSet(scope, null, { ...ready, extra: 'rejected' } as any)).rejects.toMatchObject({ code: 'invalid-input' });
});
