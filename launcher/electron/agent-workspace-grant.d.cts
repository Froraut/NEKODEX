export interface AgentWorkspaceGrant {
  version: 1; id: string; scope: "pre-turn-snapshot-only"; workspaceId: string;
  taskId: string; familyId: string; generation: number; rootPath: string;
  ancestry: { path: string; dev: string; ino: string }[];
  paths: string[]; createdAt: string; signature: string;
}
export interface AgentWorkspaceGrantSummary {
  id: string; workspaceId: string; taskId: string; familyId: string; generation: number;
  paths: string[]; state: "active" | "revoked";
}
export function createAgentWorkspaceGrantAuthority(input: { keyPath: string }): {
  prepare(root: { id: string; path: string }, paths: string[], binding: { taskId: string; familyId: string; generation: number }): AgentWorkspaceGrant;
  list(workspaceId?: string): AgentWorkspaceGrantSummary[];
  revoke(grantId: string): { grantId: string; state: "revoked" };
};
export function verifyAgentWorkspaceGrant(input: {
  keyPath: string; grant: unknown; taskId: string; familyId: string; generation: number;
}): AgentWorkspaceGrant;
export function assertGrantRoot(grant: AgentWorkspaceGrant): void;
