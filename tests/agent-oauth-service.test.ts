import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentOAuthService } from '../launcher/electron/agent-oauth-service.cjs';
import { createAgentOAuthIpc } from '../launcher/electron/ipc/agent-oauth.cjs';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'neko-oauth-service-'));
  const file = join(home, 'selected-public-registration.json');
  const registration = { version: 1, providerId: 'fixture', label: 'Explicit fixture provider', resource: 'https://resource.example.test/mcp',
    issuer: 'https://auth.example.test', clientId: 'registered-public-fixture-client', scopes: ['files:read'],
    registrationEvidenceUrl: 'https://auth.example.test/client-registration', redirectUriMode: 'loopback-port-variable',
    resourceMetadataUrl: 'https://resource.example.test/.well-known/oauth-protected-resource/mcp',
    authorizationServerMetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server' };
  writeFileSync(file, JSON.stringify(registration));
  let epoch = 'actual-authority-epoch', available = true, vaultReads = 0, opened = 0;
  const requests: string[] = [];
  const options = { coreHome: home, getAuthority: () => ({ accountId: 'native:fixture-profile', epoch }),
    protectedAvailable: () => available,
    openExternal: async () => { opened++; },
    vault: { read: async () => { vaultReads++; return null; }, compareAndSet: async () => { throw new Error('Unexpected credential write'); }, remove: async () => { throw new Error('Unexpected credential deletion'); } },
    approvedFetch: (async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(JSON.stringify(String(url) === registration.resourceMetadataUrl
        ? { resource: registration.resource, authorization_servers: [registration.issuer] }
        : { issuer: registration.issuer, authorization_endpoint: 'https://auth.example.test/authorize',
          token_endpoint: 'https://auth.example.test/token', revocation_endpoint: 'https://auth.example.test/revoke',
          code_challenge_methods_supported: ['S256'], response_types_supported: ['code'],
          token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true }), { status: 200 });
    }) as typeof fetch,
  };
  const service = createAgentOAuthService(options);
  return { home, file, registration, options, service, requests, changeEpoch: () => { epoch = 'new-actual-authority'; },
    unavailable: () => { available = false; }, counters: () => ({ vaultReads, opened }),
    cleanup: () => { service.close(); rmSync(home, { recursive: true, force: true }); } };
}

test('main-owned empty registry reviews live metadata then commits exact public registration without authentication', async () => {
  const f = fixture();
  try {
    expect(f.service.status().oauthRegistry.state).toBe('empty');
    expect(f.service.status().capabilities.oauth).toBe(true);
    expect(await f.service.request({ action: 'oauthList' })).toEqual([]);
    expect(f.counters()).toEqual({ vaultReads: 0, opened: 0 });
    const review = await f.service.reviewProviderFile(f.file);
    expect(f.requests).toEqual([f.registration.resourceMetadataUrl, f.registration.authorizationServerMetadataUrl]);
    expect(review.authorizationStarted).toBe(false);
    expect(review.clientId).toBe(f.registration.clientId);
    expect(JSON.stringify(review)).not.toContain(f.home);
    await expect(f.service.request({ action: 'oauthRegisterProvider', reviewId: review.reviewId,
      reviewDigest: '0'.repeat(64), explicitUserAction: true })).rejects.toThrow();
    const receipt = await f.service.request({ action: 'oauthRegisterProvider', reviewId: review.reviewId,
      reviewDigest: review.reviewDigest, explicitUserAction: true });
    expect((receipt as { state: string }).state).toBe('registered');
    expect(f.service.status().oauthRegistry.providerCount).toBe(1);
    const stored = readFileSync(join(f.home, 'agent-oauth', 'providers.json'), 'utf8');
    expect(stored).not.toMatch(/accessToken|refreshToken|code_verifier/);
    expect(f.counters()).toEqual({ vaultReads: 0, opened: 0 });
    const restored = createAgentOAuthService(f.options);
    expect(restored.status().oauthRegistry.state).toBe('configured');
    const rows = await restored.request({ action: 'oauthList' }) as { state: string }[];
    expect(rows[0]!.state).toBe('disconnected');
    expect(f.requests).toHaveLength(2); expect(f.counters().opened).toBe(0);
    restored.close();
  } finally { f.cleanup(); }
});

test('guarded IPC keeps account epoch and registry review authority exact, without core credential forwarding', async () => {
  const f = fixture();
  try {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const ipc = createAgentOAuthIpc({ service: f.service,
      handle: (name: string, handler: (...args: any[]) => Promise<unknown>) => handlers.set(name, handler),
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [f.file] }) }, getWindow: () => undefined });
    expect(ipc.handles('oauthList')).toBe(true); expect(ipc.handles('approveInvoke')).toBe(false);
    const reviewed = await handlers.get('launcher:agent-tools-pick-oauth-provider')!(null, { explicitUserAction: true }) as { review: { reviewId: string; reviewDigest: string } };
    const firstScope = f.service.status().oauthScope;
    f.changeEpoch();
    expect(f.service.status().oauthScope?.epoch).not.toBe(firstScope?.epoch);
    await expect(ipc.request({ action: 'oauthRegisterProvider', reviewId: reviewed.review.reviewId,
      reviewDigest: reviewed.review.reviewDigest, explicitUserAction: true })).rejects.toThrow();
    await expect(ipc.request({ action: 'oauthList', accessToken: 'injected' })).rejects.toThrow();
    const decorated = ipc.decorateStatus({ capabilities: { stdio: true, oauth: false }, config: { enabled: true } });
    expect(decorated.capabilities).toEqual({ stdio: true, oauth: true, secrets: true });
    expect(decorated.oauthScope?.accountId).toBe('native:fixture-profile');
    f.unavailable(); expect(f.service.status().capabilities.oauth).toBe(false);
    expect(f.counters()).toEqual({ vaultReads: 0, opened: 0 });
  } finally { f.cleanup(); }
});
