export const AGENT_NATIVE_DESCRIPTOR_FILE: 'launcher-agent-native.json';
export interface AgentNativeAdvertisedModel {
  id: string; admissionId: string; label?: string; provider: 'owned-native'; available: true; accepting?: boolean;
  historySource?: import('./agent-native-protocol.cjs').AgentNativeHistorySource;
  imageInput?: boolean;
}
export function createAgentNativeDescriptorPublisher(options: {
  coreHome: string; profile: 'production' | 'development'; control: { endpoint: string; token: string };
}): {
  publish(input?: { models?: AgentNativeAdvertisedModel[]; accepting?: boolean }): {
    instanceId: string; models: AgentNativeAdvertisedModel[]; accepting: boolean;
  };
  readonly path: string; readonly instanceId: string;
  snapshot(): { instanceId: string; accepting: boolean; models: AgentNativeAdvertisedModel[] } | null;
};
