import type { AgentOAuthPanelPort } from '../../src/agent-tools/oauth-types';
import type { AgentOAuthBroker } from './agent-oauth.cjs';
export function createOAuthTransport(approvedFetch: typeof fetch): (endpoint: string, body: URLSearchParams) => Promise<{ status: number; body?: unknown }>;
export function createAgentOAuthLauncher(options: {
  broker: AgentOAuthBroker; openExternal: (url: string) => Promise<unknown>;
}): AgentOAuthPanelPort & { invalidate(providerId?: string): void; close(): void };
