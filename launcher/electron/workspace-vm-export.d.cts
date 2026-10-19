import type { LocalWorkspaceService } from "./local-workspace.cjs";
import type { VmExportTaskScope, VmExportScope, VmExportRequest, VmExportReview, VmExportOutcome, VmExportStatus } from '../../src/execution-environments/export-contract';
export type { VmExportTaskScope, VmExportScope, VmExportRequest, VmExportReview, VmExportOutcome } from '../../src/execution-environments/export-contract';
export interface WorkspaceVmExportService {
  prepare(input: { scope: VmExportTaskScope; workspaceId: string; destinationPath: string; operationId: string; candidatePath: string; candidateSha256: string; explicitUserAction: true }): Promise<VmExportReview>;
  execute(request: VmExportRequest): Promise<VmExportOutcome>;
  inspect(request: VmExportRequest): VmExportOutcome | null;
  reconcile(request: VmExportRequest): Promise<VmExportOutcome | null>;
  list(scope: VmExportTaskScope): VmExportStatus;
  /** Accepted/unknown actions retain only their original workspace grant. Corrupt identity fails closed. */
  hasRetainedState(workspaceId: string): boolean;
  readonly activeCount: number; currentOperation(): string | null; destroy(): Promise<void>; close(): Promise<void>;
}
export function createWorkspaceVmExportService(options: {
  home: string; workspaceService: LocalWorkspaceService; protectedRoots?: string[];
  readCandidate(input: { scope: VmExportScope; operationId: string; path: string; sha256: string }): Promise<Uint8Array>;
  validateScope(scope: VmExportTaskScope): Promise<{ id: string; familyId: string; generation: number }>;
  validateIntent(request: VmExportRequest): Promise<void>;
}): WorkspaceVmExportService;
export const MAX_VM_EXPORT_BYTES: number;
