import type { LocalGitReviewService } from './local-git-review.cjs';
export interface ManagedWorktree {
  id: string; workspaceId: string; sourcePath: string; sourceIdentity: string;
  path: string; branch: string; headOid: string; identity?: string;
  state: "creating" | "ready" | "archiving" | "archived" | "needs-inspection";
  createdAt: string; currentHeadOid?: string; dirty?: boolean; reused?: boolean;
  recoveryRef?: string; recoverySnapshotId?: string | null; archivedHeadOid?: string;
  archivedAt?: string; archivePath?: string;
}
export interface WorkspaceSourceSnapshot {
  id: string; workspaceId: string; label: string; kind: "manual" | "restore-recovery" | "worktree-recovery";
  createdAt: string; paths: string[]; bytes: number;
}
export interface WorkspaceArchivePreview {
  previewId: string; worktreeId: string; branch: string; headOid: string;
  dirty: boolean; paths: string[]; recoveryRequired: boolean;
}
export interface WorkspaceRestorePreview {
  previewId: string; snapshotId: string;
  files: Array<{ path: string; expectedRevision: string | null; currentHash: string | null;
    targetHash: string | null; currentText: string | null; targetText: string | null;
    targetMissing: boolean; changed: boolean }>;
}
export interface WorkspaceRestoreReceipt {
  id: string; workspaceId: string; snapshotId: string; recoverySnapshotId: string;
  state: "restoring" | "complete" | "needs-inspection"; restoredPaths: string[]; createdAt: string;
}
export interface WorkspaceGitService {
  reviewBases: LocalGitReviewService['bases'];
  reviewCapture: LocalGitReviewService['capture'];
  reviewDiff: LocalGitReviewService['diff'];
  reviewPrepare: LocalGitReviewService['prepare'];
  reviewApply: LocalGitReviewService['apply'];
  reviewInspectAction: LocalGitReviewService['inspectAction'];
  reviewListActions: LocalGitReviewService['listActions'];
  reviewPruneActions: LocalGitReviewService['pruneActions'];
  /** Exact active Git/create/archive owners for the application's Quit/Restart guard. */
  currentOperation(): string | null;
  /** Main-only derived grant port: source grant and ready/archived owned checkout are revalidated; accepts no path. */
  resolveManagedRoot(sourceRootId: string, worktreeId: string): Promise<{ id: string; path: string }>;
  /** Close admission and join existing owners through durable terminal receipts; never force-kills Git. */
  destroy(): Promise<void>;
  /** Main-process retention guard; no renderer path authority. */
  hasRetainedState(workspaceId: string): boolean;
  listWorktrees(workspaceId: string): Promise<ManagedWorktree[]>;
  createWorktree(workspaceId: string, input: { name: string; expectedHeadOid: string }): Promise<ManagedWorktree>;
  previewArchive(workspaceId: string, worktreeId: string): Promise<WorkspaceArchivePreview>;
  archiveWorktree(workspaceId: string, input: { previewId: string }): Promise<ManagedWorktree>;
  createSnapshot(workspaceId: string, input: { paths: string[]; label?: string }): WorkspaceSourceSnapshot;
  listSnapshots(workspaceId: string): WorkspaceSourceSnapshot[];
  deleteSnapshot(workspaceId: string, snapshotId: string): boolean;
  previewRestore(workspaceId: string, input: { snapshotId: string; paths: string[] }): WorkspaceRestorePreview;
  restoreSnapshot(workspaceId: string, input: { previewId: string }): WorkspaceRestoreReceipt;
}
/** Only the main-process composition root supplies the picker-backed grant resolver and private storage. */
export function createWorkspaceGitService(options: {
  resolveWorkspace: (workspaceId: string) => { id: string; path: string }; storagePath: string;
  /** Trusted saved editor drafts block Git preparation/application without discarding bytes. */
  getDraftPaths?: (workspaceId: string) => string[];
  /** Trusted composition policy: false while a derived root grant still owns this checkout. */
  canArchiveWorktree?: (sourceRootId: string, worktreeId: string) => boolean;
}): WorkspaceGitService;
export const LIMITS: Readonly<{ files: number; fileBytes: number; snapshotBytes: number; snapshots: number;
  worktrees: number; gitBytes: number; previews: number; storageBytes: number; restores: number }>;
