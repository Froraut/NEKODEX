/** Renderer-safe DTOs. Candidate bytes, private paths and filesystem identity
 * proofs stay in their owning process and are never part of this contract. */
export interface VmExportTaskScope { taskId: string; generation: number }
export interface VmExportScope extends VmExportTaskScope { familyId: string }
export interface VmExportRequest {
  scope: VmExportTaskScope & { toolCallId: string }; tool: 'vm-shell/export';
  arguments: { reviewId: string; reviewDigest: string }; idempotencyKey: string;
}
export interface VmExportReview {
  reviewId: string; reviewDigest: string; scope: VmExportScope; workspaceId: string; destinationPath: string;
  operationId: string; candidatePath: string; candidateSha256: string; bytes: number;
  expectedRevision: string | null; currentSha256: string | null; currentBytes: number;
}
export interface VmExportOutcome {
  state: 'completed' | 'failed' | 'outcome_unknown'; reason?: string;
  result: { receiptId?: string | null; reviewId?: string | null; reviewDigest?: string; workspaceId?: string;
    path?: string; revision?: string; sha256?: string; bytes?: number; ownerHeld?: boolean; reconciled?: boolean };
}
export interface VmExportStatus { reviews: VmExportReview[]; receipts: Array<VmExportOutcome & { request: VmExportRequest }> }
