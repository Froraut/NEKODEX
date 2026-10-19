import type { OAuthProviderConfig, OAuthProviderStatus, AgentOAuthPanelPort } from '../../src/agent-tools/oauth-types';
export interface OAuthCredentialScope {
  kind: 'mcp-oauth'; accountId: string; providerId: string; epoch: number;
  issuer: string; resource: string; clientId: string;
}
export interface OAuthCredentialRecord {
  phase: 'ready' | 'refresh_pending' | 'revocation_pending';
  accessToken: string; refreshToken?: string; expiresAt: number;
}
export interface OAuthProtectedVault {
  read(scope: OAuthCredentialScope): Promise<{ revision: string; record: OAuthCredentialRecord } | null>;
  compareAndSet(scope: OAuthCredentialScope, expectedRevision: string | null, record: OAuthCredentialRecord): Promise<string>;
  remove(scope: OAuthCredentialScope, expectedRevision: string): Promise<void>;
}
export interface AgentOAuthBroker extends Omit<AgentOAuthPanelPort, 'begin'> {
  status(providerId: string): Promise<OAuthProviderStatus>;
  hasOwner(providerId?: string): boolean;
  registeredRedirect(providerId: string): string | undefined;
  begin(input: { providerId: string; explicitUserAction: true }, redirectUri: string): Promise<{ authorizationUrl: string; status: OAuthProviderStatus }>;
  callback(providerId: string, callbackUrl: string): Promise<OAuthProviderStatus>;
  withAccessToken<T>(providerId: string, resource: string, use: (accessToken: string) => Promise<T>): Promise<T>;
  invalidate(providerId?: string): void;
}
export function createAgentOAuthBroker(options: {
  providers: OAuthProviderConfig[]; vault: OAuthProtectedVault; authority: (config: OAuthProviderConfig) => boolean;
  transport: (endpoint: string, body: URLSearchParams) => Promise<{ status: number; body?: unknown }>;
  now?: () => number;
}): AgentOAuthBroker;
export function validateProvider(config: OAuthProviderConfig): Readonly<OAuthProviderConfig>;
export function scopeOf(config: OAuthProviderConfig): OAuthCredentialScope;

export function validateExactRedirectUri(raw: string): string;
