import type { AgentWorkspaceGrant, AgentWorkspaceGrantSummary } from "./agent-workspace-grant.cjs";

export interface LocalWorkspaceRoot { id: string; name: string; path: string; selectedAt: string }
export interface WorkspaceEntry { name: string; path: string; kind: "directory" | "file" | "blocked-link" | "unsupported" }
export interface WorkspaceListing { path: string; entries: WorkspaceEntry[]; truncated: boolean }
export interface WorkspacePreview {
  path: string; state: "text" | "missing" | "binary" | "truncated";
  revision: string | null; text: string | null; size: number; truncated?: boolean;
}
export interface WorkspaceDraft {
  id: string; workspaceId: string; path: string; text: string;
  expectedRevision: string | null; updatedAt: string;
}
export type WorkspaceSaveResult =
  | { state: "saved"; path: string; revision: string; draftId: string; draftRetained: boolean }
  | { state: "conflict"; draftId: string; currentRevision: string | null; currentState: WorkspacePreview["state"] }
  | { state: "blocked"; draftId: string; code: string; message: string };
export interface WorkspaceGitBaseChoice {
  baseId: string; ref: string | null; oid: string; kind: "head" | "local" | "remote";
}
export type WorkspaceGitBases =
  | { state: "ready"; headOid: string; headRef: string | null; choices: WorkspaceGitBaseChoice[]; truncated: boolean }
  | { state: "unavailable"; reason: string };
export type WorkspaceGitStatus =
  | { state: "ready"; snapshotId: string; headOid: string; headRef: string | null; baseOid: string; baseRef: string | null; status: string[];
      statusTruncated: boolean; truncated: boolean; binary: boolean }
  | { state: "unavailable"; reason: string };
export interface WorkspaceGitDiff {
  state: "current" | "stale" | "unavailable"; snapshotId: string; headOid: string; headRef: string | null; baseOid: string; baseRef: string | null;
  text: string; truncated: boolean; binary: boolean; reason?: string;
}
export interface LocalWorkspaceService {
  /** Main-only freshly validated grant; do not expose over IPC. */
  resolveGrant(workspaceId: string): Readonly<{ id: string; path: string }>;
  prepareAgentWorkspaceGrant(workspaceId: string, paths: string[], binding: { taskId: string; familyId: string; generation: number }): AgentWorkspaceGrant;
  listAgentWorkspaceGrants(workspaceId?: string): AgentWorkspaceGrantSummary[];
  revokeAgentWorkspaceGrant(grantId: string): { grantId: string; state: "revoked" };
  pickRoot(): Promise<LocalWorkspaceRoot | null>;
  /** Calls only the trusted resolver; incoming absolute paths are never accepted. */
  openManagedRoot(sourceRootId: string, worktreeId: string): Promise<LocalWorkspaceRoot>;
  /** Main-only archive guard; pending opens and registered unavailable roots retain their grant. */
  hasManagedRootGrant(sourceRootId: string, worktreeId: string): boolean;
  listRoots(): LocalWorkspaceRoot[];
  forgetRoot(workspaceId: string): boolean;
  list(workspaceId: string, path?: string): WorkspaceListing;
  tree(workspaceId: string, path?: string, depth?: number): WorkspaceListing;
  preview(workspaceId: string, path: string): WorkspacePreview;
  save(workspaceId: string, input: { path: string; expectedRevision: string | null; text: string; draftId?: string }): WorkspaceSaveResult;
  retainDraft(workspaceId: string, input: { path: string; expectedRevision: string | null; text: string; draftId?: string }): WorkspaceDraft;
  listDrafts(workspaceId: string): WorkspaceDraft[];
  discardDraft(workspaceId: string, draftId: string): boolean;
  gitBases(workspaceId: string): Promise<WorkspaceGitBases>;
  gitStatus(workspaceId: string, options?: { baseOid?: string; baseId?: string }): Promise<WorkspaceGitStatus>;
  gitDiff(workspaceId: string, snapshotId: string): Promise<WorkspaceGitDiff>;
}
/** The picker and registry path are trusted main-process dependencies, never IPC payloads. */
export function createLocalWorkspaceService(options: {
  pickDirectory: () => Promise<string | null | undefined>; registryPath?: string | null;
  agentWorkspaceGrantKeyPath?: string | null;
  resolveManagedWorktree?: ((sourceRootId: string, worktreeId: string) => Promise<{ id: string; path: string }>) | null;
}): LocalWorkspaceService;
export const LIMITS: Readonly<{ roots: number; entries: number; treeEntries: number; depth: number;
  previewBytes: number; gitBytes: number; drafts: number; snapshots: number; baseRefs: number; bases: number }>;
