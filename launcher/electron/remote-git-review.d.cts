export type RemoteGitReviewOperation = 'stage' | 'unstage' | 'commit';
export type RemoteGitReviewState = 'reviewed' | 'prepared' | 'completed' | 'failed' | 'unknown';
export interface RemoteGitReviewTarget {
  hostId: string; fingerprint: string; connectionId: string; root: string;
  hostname: string; username: string; port: number;
}
export interface RemoteGitReviewRepository {
  rootIdentity: string; gitDir: string; gitIdentity: string; commonDir: string; commonIdentity: string;
  headOid: string | null; headRef: string | null; indexDigest: string | null;
  mergeHeads: string[]; mergeStateDigest: string; objectFormat: string;
}
export interface RemoteGitReviewEntry {
  path: string; originalPath?: string; indexStatus: string; worktreeStatus: string;
  kind: 'tracked' | 'untracked' | 'conflict';
  stages?: Array<{ stage: number; mode: string; oid: string }>;
  binary?: boolean; bytes?: number;
}
export interface RemoteGitReviewBases {
  state: 'ready'; target: RemoteGitReviewTarget; repository: RemoteGitReviewRepository;
  choices: Array<{ baseId: string; kind: 'head' | 'local' | 'remote'; ref: string | null; oid: string | null }>;
  truncated: boolean;
}
export interface RemoteGitReviewCapture {
  captureId: string; target: RemoteGitReviewTarget; repository: RemoteGitReviewRepository;
  baseOid: string | null; baseRef: string | null; entries: RemoteGitReviewEntry[];
  fingerprint: string; truncated: boolean; limitations: string[]; createdAt: string;
}
export interface RemoteGitReviewDiffInput {
  captureId: string; kind: 'worktree' | 'staged' | 'base' | 'conflict'; path?: string; stage?: 1 | 2 | 3;
}
export interface RemoteGitReviewDiff {
  captureId: string; kind: RemoteGitReviewDiffInput['kind']; path?: string; stage?: 1 | 2 | 3;
  state: 'current' | 'stale' | 'unavailable'; text: string; binary: boolean; truncated: boolean; reason?: string;
  headOid: string | null; baseOid: string | null;
}
export interface RemoteGitReviewAuthor { name: string; email: string }
export interface RemoteGitReviewPrepareInput {
  actionId: string; captureId: string; operation: RemoteGitReviewOperation;
  paths?: string[]; message?: string; author?: RemoteGitReviewAuthor;
}
export interface RemoteGitReviewSummary {
  headOid: string | null; headRef: string | null; indexDigest: string | null;
  paths: string[]; parents: string[]; message?: string; author?: RemoteGitReviewAuthor;
  files: Array<{ path: string; mode: string | null; revision: string | null; sourceSha256?: string; bytes: number; remove: boolean }>;
  stagedEntries?: Array<{ path: string; mode: string; oid: string; stage: number }>;
  limitations: string[];
}
export interface RemoteGitReviewAction {
  actionId: string; hostId: string; target: RemoteGitReviewTarget; operation: RemoteGitReviewOperation;
  reviewDigest: string; state: RemoteGitReviewState; ownerHeld: boolean; terminal: boolean;
  review: RemoteGitReviewSummary; createdAt: string; updatedAt: string; receiptId?: string; reason?: string;
  result?: { indexDigest?: string | null; treeOid?: string; commitOid?: string; headOid?: string | null; headRef?: string | null; reconciled?: boolean };
}
/** Main-only signed persistence. The private immutable plan must never cross IPC. */
export interface RemoteGitReviewRecord {
  version: 1; actionId: string; hostId: string; target: RemoteGitReviewTarget; repoKey: string;
  operation: RemoteGitReviewOperation; requestDigest: string; reviewDigest: string; prepareDigest: string;
  state: RemoteGitReviewState; ownerHeld: boolean; createdAt: string; updatedAt: string;
  plan: Record<string, unknown>; receiptId?: string; result?: RemoteGitReviewAction['result']; reason?: string;
}
export interface RemoteGitReviewService {
  bases(hostId: string): Promise<RemoteGitReviewBases>;
  capture(hostId: string, input?: { baseId?: string }): Promise<RemoteGitReviewCapture>;
  diff(hostId: string, input: RemoteGitReviewDiffInput): Promise<RemoteGitReviewDiff>;
  prepare(hostId: string, input: RemoteGitReviewPrepareInput): Promise<RemoteGitReviewAction>;
  apply(hostId: string, input: { actionId: string; reviewDigest: string }): Promise<RemoteGitReviewAction>;
  inspectAction(hostId: string, actionId: string): Promise<RemoteGitReviewAction | null>;
  listActions(hostId: string): RemoteGitReviewAction[];
  pruneActions(hostId: string, actionIds: string[]): { removed: number };
  currentOperation(): string | null;
  destroy(): Promise<void>;
}
export interface RemoteGitReviewApi {
  remoteGitBases(hostId: string): Promise<RemoteGitReviewBases>;
  remoteGitCapture(hostId: string, input?: { baseId?: string }): Promise<RemoteGitReviewCapture>;
  remoteGitDiff(hostId: string, input: RemoteGitReviewDiffInput): Promise<RemoteGitReviewDiff>;
  remoteGitPrepare(hostId: string, input: RemoteGitReviewPrepareInput): Promise<RemoteGitReviewAction>;
  remoteGitApply(hostId: string, input: { actionId: string; reviewDigest: string }): Promise<RemoteGitReviewAction>;
  remoteGitInspectAction(hostId: string, actionId: string): Promise<RemoteGitReviewAction | null>;
  remoteGitListActions(hostId: string): Promise<RemoteGitReviewAction[]>;
  remoteGitPruneActions(hostId: string, actionIds: string[]): Promise<{ removed: number }>;
}
export function createRemoteGitReviewController(options: {
  withHost<T>(hostId: string, action: (scope: RemoteGitReviewTarget, run: (action: string, payload: Record<string, unknown>) => Promise<unknown>) => Promise<T>, kind: string, mutation?: boolean): Promise<T>;
  getRecords(): RemoteGitReviewRecord[]; storeRecords(records: RemoteGitReviewRecord[]): void;
  begin(hostId: string, kind: string, detail: Record<string, unknown>): { id: string };
  finish(receiptId: string, detail: Record<string, unknown>): unknown;
  /** Atomic prepared Git row + newly allocated signed started receipt. */
  storePrepared?(record: RemoteGitReviewRecord): RemoteGitReviewRecord;
  /** Optional atomic Git row + matching signed receipt publication. */
  storeTerminal?(record: RemoteGitReviewRecord, receiptDetail: Record<string, unknown>): void;
}): RemoteGitReviewService;
export function validateRemoteGitReviewRecords(records: unknown): asserts records is RemoteGitReviewRecord[];
export const REMOTE_GIT_REVIEW_LIMITS: Readonly<{ paths: number; fileBytes: number; selectedBytes: number; actions: number; retainedBytes: number; captures: number }>;
