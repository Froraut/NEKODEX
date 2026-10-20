export interface RemoteAgentScope { taskId: string; generation: number }
export interface RemoteAgentTaskScope extends RemoteAgentScope { familyId: string; revision: number }
/** Main-derived connection authority. fingerprint hashes saved configuration, not the SSH host key. */
export interface RemoteAgentBinding extends RemoteAgentScope {
  mainInstanceId: string; attachmentId: string; familyId: string; hostId: string;
  fingerprint: string; root: string; connectionId: string;
  hostname: string; username: string; port: number; label: string;
}
export interface RemoteAgentToolScope extends RemoteAgentScope { toolCallId: string }
export type RemoteAgentInvocation = {
  scope: RemoteAgentToolScope; tool: 'remote/list' | 'remote/read' | 'remote/command';
  arguments: { binding: RemoteAgentBinding; path?: string; command?: string; timeoutSeconds?: number };
  idempotencyKey: string;
};
export interface RemoteAgentOutcome {
  scope: RemoteAgentToolScope; tool: RemoteAgentInvocation['tool']; idempotencyKey: string;
  state: 'completed' | 'failed' | 'outcome_unknown'; result?: unknown; reason?: string;
}
export interface RemoteAgentStatus {
  mainInstanceId: string;
  hosts: import('./remote-workspace.cjs').RemoteHost[];
  bindings: RemoteAgentBinding[];
  activeCount: number;
}
