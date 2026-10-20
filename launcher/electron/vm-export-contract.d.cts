import type { VmExportRequest, VmExportTaskScope } from '../../src/execution-environments/export-contract';
export const VM_EXPORT_LIMITS: Readonly<{ toolCallId: 200; idempotencyKey: 240; requestBytes: 65536; outputBytes: 16777216; rows: 64 }>;
export function parseVmExportRequest(value: unknown): VmExportRequest;
export function parseVmExportTaskScope(value: unknown): VmExportTaskScope;
