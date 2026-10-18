export const AGENT_REMOTE_DESCRIPTOR_FILE: 'launcher-agent-remote.json';
export function createAgentRemoteDescriptorPublisher(options: {
  coreHome: string; profile: 'production' | 'development'; control: { endpoint: string; token: string };
}): {
  publish(): { instanceId: string };
  readonly path: string;
  readonly instanceId: string;
  snapshot(): { instanceId: string } | null;
};
