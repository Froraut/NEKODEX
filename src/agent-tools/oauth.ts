import type { AgentOAuthPanelPort, OAuthProviderStatus } from './oauth-types';

export type AgentOAuthRequest = { action: 'oauthList' } | {
  action: 'oauthBegin' | 'oauthCancel' | 'oauthRefresh' | 'oauthRevoke';
  providerId: string;
  explicitUserAction: true;
};
/** Main/server integration helper. Configuration, URLs, callbacks and tokens are never accepted here. */
export function validateAgentOAuthRequest(value: unknown): AgentOAuthRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid OAuth action');
  const input = value as Record<string, unknown>;
  if (input.action === 'oauthList' && Object.keys(input).length === 1) return { action: 'oauthList' };
  if (!['oauthBegin', 'oauthCancel', 'oauthRefresh', 'oauthRevoke'].includes(input.action as string)
    || Object.keys(input).length !== 3 || input.explicitUserAction !== true
    || typeof input.providerId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(input.providerId)) throw new Error('Invalid explicit OAuth action');
  return { action: input.action as Exclude<AgentOAuthRequest['action'], 'oauthList'>,
    providerId: input.providerId, explicitUserAction: true };
}
/** Trusted transport delegation only. Connection status never creates a ToolJournal grant. */
export async function handleAgentOAuthRequest(port: AgentOAuthPanelPort, value: unknown): Promise<OAuthProviderStatus[] | OAuthProviderStatus> {
  const input = validateAgentOAuthRequest(value);
  if (input.action === 'oauthList') return port.list();
  const request = { providerId: input.providerId, explicitUserAction: true as const };
  if (input.action === 'oauthBegin') return port.begin(request);
  if (input.action === 'oauthCancel') return port.cancel(request);
  if (input.action === 'oauthRefresh') return port.refresh(request);
  return port.revoke(request);
}
