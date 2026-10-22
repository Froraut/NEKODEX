/** Standalone tools are separate from the client-owned broker and its authority. */
export interface ToolScope { taskId: string; generation: number; toolCallId: string }
export interface ToolDescriptor {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  supported: boolean;
  /** Validator support is separate from the current task's attachment/readiness. */
  schemaSupported?: boolean;
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
/** A trusted built-in implementation. The tool host remains the approval/journal owner. */
export interface StandaloneBuiltinToolsProvider {
  serverId: string;
  /** Trusted built-in only: an already approved human handoff has no observation deadline. */
  waitsForUser?(request: Omit<ToolInvocation, "grantId">): boolean;
  discover(scope: ToolScope, options?: { signal?: AbortSignal }): Promise<ToolDescriptor[]>;
  execute(request: Omit<ToolInvocation, "grantId">, options?: { signal?: AbortSignal }): Promise<Pick<ToolOutcome, "state" | "result" | "reason">>;
  /** Reads an exact owned late receipt. It must never dispatch/observe/input during reconciliation. */
  reconcile?(request: Omit<ToolInvocation, "grantId">, options?: { signal?: AbortSignal }): Promise<Pick<ToolOutcome, "state" | "result" | "reason"> | undefined>;
  /** Trusted task-owner generation change; revoke only retained observations/owned pending work. */
  invalidate?(taskId?: string): void;
}
