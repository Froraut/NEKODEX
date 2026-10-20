export const AGENT_OAUTH_MCP_DESCRIPTOR_FILE: 'launcher-agent-oauth-mcp.json';
export function createAgentOAuthMcpDescriptorPublisher(options: { coreHome: string; profile: 'production' | 'development'; control: { endpoint: string; token: string } }): { publish(): { instanceId: string }; instanceId: string; path: string; snapshot(): { instanceId: string } | null };
