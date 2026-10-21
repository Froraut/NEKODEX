import type { OAuthProtectedVault } from './agent-oauth.cjs';
import type { OAuthProviderRegistrationReview, OAuthProviderStatus } from '../../src/agent-tools/oauth-types';
export interface AgentOAuthService {
  handles(action: string): boolean;
  status(): { oauthScope?: { accountId: string; epoch: string }; capabilities: { oauth: boolean; secrets: boolean };
    oauthRegistry: { state: 'empty' | 'configured' | 'unavailable'; providerCount: number; reason?: string;
      /** No current Native account authority: its execution is not ready (for example after a restart). */
      reasonCode?: 'account_authority_offline' } };
  subscribeMcpInvalidation(listener: (providerId?: string) => void): () => void;
  reviewedMcpProviders(): { providerId: string; label: string; resource: string; issuer: string; clientId: string; metadataDigest: string; accountId: string; epoch: string }[];
  reviewProviderFile(file: string): Promise<OAuthProviderRegistrationReview>;
  request(body: unknown): Promise<OAuthProviderStatus[] | OAuthProviderStatus | OAuthProviderRegistrationReview>;
  withAccessToken<T>(scope: { providerId: string; resource: string; accountId: string; epoch: string }, use: (token: string) => Promise<T>): Promise<T>;
  invalidate(): void; currentOperation(): string | null; close(): void;
}
export function createAgentOAuthService(options: {
  coreHome: string; getAuthority: () => { accountId: string; epoch: string | number } | null;
  openExternal: (url: string) => Promise<unknown>; approvedFetch?: typeof fetch;
  vault?: OAuthProtectedVault; protectedAvailable?: () => boolean;
}): AgentOAuthService;
export function createPublicOAuthFetch(): typeof fetch;
export function validateRegistrationFile(value: unknown): unknown;
