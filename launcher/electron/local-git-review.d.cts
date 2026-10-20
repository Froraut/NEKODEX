import type { RemoteGitReviewRepository, RemoteGitReviewSummary, RemoteGitReviewOperation, RemoteGitReviewState,
  RemoteGitReviewEntry, RemoteGitReviewDiff, RemoteGitReviewDiffInput, RemoteGitReviewPrepareInput } from './remote-git-review.cjs';
export type LocalGitReviewOperation = RemoteGitReviewOperation;
export type LocalGitReviewPrepareInput = RemoteGitReviewPrepareInput;
export type LocalGitReviewDiffInput = RemoteGitReviewDiffInput;
export type LocalGitReviewDiff = RemoteGitReviewDiff;
export interface LocalGitReviewTarget { path: string; identity: string }
export interface LocalGitReviewBases {
  state: 'ready'; workspaceId: string; target: LocalGitReviewTarget; repository: RemoteGitReviewRepository;
  choices: Array<{ baseId: string; kind: 'head' | 'local' | 'remote'; ref: string | null; oid: string | null }>; truncated: boolean;
}
export interface LocalGitReviewCapture {
  captureId: string; workspaceId: string; target: LocalGitReviewTarget; repository: RemoteGitReviewRepository;
  baseOid: string | null; baseRef: string | null; entries: RemoteGitReviewEntry[];
  fingerprint: string; truncated: boolean; limitations: string[]; createdAt: string;
}
export interface LocalGitReviewAction {
  actionId: string; workspaceId: string; target: LocalGitReviewTarget; operation: LocalGitReviewOperation;
  reviewDigest: string; state: RemoteGitReviewState; ownerHeld: boolean; terminal: boolean;
  review: RemoteGitReviewSummary; createdAt: string; updatedAt: string; receiptId?: string; reason?: string;
  result?: { indexDigest?: string | null; treeOid?: string; commitOid?: string; headOid?: string | null; headRef?: string | null; reconciled?: boolean };
}
export interface LocalGitReviewService {
  bases(workspaceId: string): Promise<LocalGitReviewBases>;
  capture(workspaceId: string, input?: { baseId?: string }): Promise<LocalGitReviewCapture>;
  diff(workspaceId: string, input: LocalGitReviewDiffInput): Promise<LocalGitReviewDiff>;
  prepare(workspaceId: string, input: LocalGitReviewPrepareInput): Promise<LocalGitReviewAction>;
  apply(workspaceId: string, input: { actionId: string; reviewDigest: string }): Promise<LocalGitReviewAction>;
  inspectAction(workspaceId: string, actionId: string): Promise<LocalGitReviewAction | null>;
  listActions(workspaceId: string): LocalGitReviewAction[];
  pruneActions(workspaceId: string, actionIds: string[]): { removed: number };
  hasRetainedState(workspaceId: string): boolean;
  currentOperation(): string | null;
  destroy(): Promise<void>;
}
export interface LocalGitReviewApi {
  workspaceGitReviewBases(workspaceId: string): Promise<LocalGitReviewBases>;
  workspaceGitReviewCapture(workspaceId: string, input?: { baseId?: string }): Promise<LocalGitReviewCapture>;
  workspaceGitReviewDiff(workspaceId: string, input: LocalGitReviewDiffInput): Promise<LocalGitReviewDiff>;
  workspaceGitReviewPrepare(workspaceId: string, input: LocalGitReviewPrepareInput): Promise<LocalGitReviewAction>;
  workspaceGitReviewApply(workspaceId: string, input: { actionId: string; reviewDigest: string }): Promise<LocalGitReviewAction>;
  workspaceGitReviewInspectAction(workspaceId: string, actionId: string): Promise<LocalGitReviewAction | null>;
  workspaceGitReviewListActions(workspaceId: string): Promise<LocalGitReviewAction[]>;
  workspaceGitReviewPruneActions(workspaceId: string, actionIds: string[]): Promise<{ removed: number }>;
}
export function runLocalGitReviewHelper(scope: Record<string, unknown>, action: string, payload: Record<string, unknown>): Promise<unknown>;
/** Internal main-process composition; renderer APIs accept no root or subprocess argument. */
export function createLocalGitReviewService(options: {
  storagePath: string; rootFor(id: string): any; recheck(root: any): void;
  own<T>(id: string, kind: string, label: string, action: () => Promise<T>): Promise<T>;
  exclusive<T>(id: string, label: string, action: () => Promise<T>): Promise<T>;
  getDraftPaths?(id: string): string[];
  executeHelper?: typeof runLocalGitReviewHelper;
}): LocalGitReviewService;
