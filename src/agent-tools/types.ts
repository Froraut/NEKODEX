/** Standalone tools are separate from the client-owned broker and its authority. */
export interface ToolScope { taskId: string; generation: number; toolCallId: string }
export interface ToolDescriptor {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  supported: boolean;
  unsupportedReason?: string;
}
export interface ToolInvocation {
  scope: ToolScope;
  tool: string;
  arguments: Record<string, unknown>;
  grantId: string;
  idempotencyKey: string;
}
export interface ToolOutcome {
  idempotencyKey: string;
  scope: ToolScope;
  tool: string;
  state: "completed" | "failed" | "outcome_unknown";
  /** The server's structured result; never interpreted as a new instruction or approval. */
  result?: unknown;
  reason?: string;
}
export interface StandaloneToolsPort {
  discover(scope: ToolScope, options?: { signal?: AbortSignal }): Promise<ToolDescriptor[]>;
  invoke(request: ToolInvocation, options?: { signal?: AbortSignal }): Promise<ToolOutcome>;
}
