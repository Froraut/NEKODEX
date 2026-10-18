import type { RemoteReceipt } from './remote-workspace.cjs';
export interface RemoteGitSnapshot {
  captureId: string; hostId: string; fingerprint: string; connectionId: string; root: string;
  hostname: string; username: string; port: number; headOid: string; worktreeDigest: string;
  sourceIdentity: string; commonDir: string; commonIdentity: string; parent: string; parentIdentity: string;
}
export interface RemoteManagedWorktree {
  id: string; hostId: string; hostFingerprint: string; sourceRoot: string; sourceIdentity: string;
  commonDir: string; commonIdentity: string; parent: string; parentIdentity: string; path: string; marker: string;
  branch: string; headOid: string; currentHeadOid?: string; createdAt: string; inspectedAt?: string; archivedAt?: string;
  state: 'creating' | 'ready' | 'failed' | 'needs-inspection' | 'archiving' | 'archived';
  dirty?: boolean; statusDigest?: string; identity?: string; checkoutRetained?: boolean; archiveRef?: string; archivedHeadOid?: string; message?: string;
}
export interface RemoteWorktreePlan {
  token: string; hostId: string; fingerprint: string; connectionId: string; root: string;
  hostname: string; username: string; port: number; record: RemoteManagedWorktree;
  snapshot: Omit<RemoteGitSnapshot, 'captureId' | 'hostId' | 'fingerprint' | 'connectionId' | 'root' | 'hostname' | 'username' | 'port'>;
}
export interface RemoteWorktreeArchivePlan {
  token: string; hostId: string; fingerprint: string; connectionId: string; root: string;
  hostname: string; username: string; port: number; record: RemoteManagedWorktree;
  expected: { headOid: string; dirty: boolean; statusDigest: string; identity: string };
}
export interface RemoteWorktreeResult { worktree: RemoteManagedWorktree; receipt: RemoteReceipt }
export interface RemoteWorktreeApi {
  remoteWorktreeInspect(id: string): Promise<RemoteGitSnapshot>;
  remoteWorktreePrepare(id: string, input: { name: string; captureId: string }): Promise<RemoteWorktreePlan>;
  remoteWorktreeCreate(id: string, token: string): Promise<RemoteWorktreeResult>;
  remoteWorktreeList(id: string): Promise<RemoteManagedWorktree[]>;
  remoteWorktreeInspectOwned(id: string, worktreeId: string): Promise<RemoteManagedWorktree>;
  remoteWorktreePrepareArchive(id: string, worktreeId: string): Promise<RemoteWorktreeArchivePlan>;
  remoteWorktreeArchive(id: string, token: string): Promise<RemoteWorktreeResult>;
}
export interface RemoteWorktreeService {
  worktreeInspect(id: string): Promise<RemoteGitSnapshot>;
  worktreePrepare(id: string, input: { name: string; captureId: string }): Promise<RemoteWorktreePlan>;
  worktreeCreate(id: string, token: string): Promise<RemoteWorktreeResult>;
  worktreeList(id: string): Promise<RemoteManagedWorktree[]>;
  worktreeInspectOwned(id: string, worktreeId: string): Promise<RemoteManagedWorktree>;
  worktreePrepareArchive(id: string, worktreeId: string): Promise<RemoteWorktreeArchivePlan>;
  worktreeArchive(id: string, token: string): Promise<RemoteWorktreeResult>;
}
