export const AGENT_VM_EXPORT_DESCRIPTOR_FILE: 'launcher-agent-vm-export.json';
export function createAgentVmExportDescriptorPublisher(options: {
  coreHome: string; profile: 'production' | 'development'; control: { endpoint: string; token: string };
}): {
  publish(): { instanceId: string };
  readonly path: string;
  readonly instanceId: string;
  snapshot(): { instanceId: string } | null;
};
