export const AGENT_NATIVE_PROTOCOL: "neko-agent-v1";
export const AGENT_NATIVE_OUTPUT_SCHEMA_ID: "neko-agent-result-v1";
/** Deep-frozen, Node-builtins-only authority shared by main and Bun. */
export const AGENT_NATIVE_OUTPUT_SCHEMA: Readonly<Record<string, unknown>>;
export const AGENT_NATIVE_OUTPUT_SCHEMA_HASH: string;
export const AGENT_NATIVE_TEXT_BYTES: number;
export const AGENT_NATIVE_ENVELOPE_BYTES: number;
export interface AgentNativeHistorySource { sourceId: string; profileId: string; backendAccountId: string; authEpoch: string }
export function isAgentNativeHistorySource(value: unknown): value is AgentNativeHistorySource;
