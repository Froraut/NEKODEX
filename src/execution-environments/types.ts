import type { AdmittedVmRuntime, VmExecutionInput, VmExecutionResult } from './executor';
import type { StandaloneBuiltinToolsProvider, ToolScope } from '../agent-tools/types';
export interface VmShellBinding { id: string; taskId: string; generation: number; label: string; runtimeDigest: string }
export interface VmShellToolsStatus {
  available: boolean; reason?: string; runtimeDigest: string | null; closed: boolean; bindings: VmShellBinding[];
  activeOperations: { operationId: string; actionId: string; taskId: string; generation: number; bindingId: string; ownerHeld: boolean }[];
  operations: VmShellOperation[];
}
export interface VmShellOperation { operationId: string; actionId: string; taskId: string; generation: number; bindingId: string; ownerHeld: boolean;
  state: 'pending' | VmExecutionResult['state']; guestExitCode: number | null; candidates: VmExecutionResult['candidates']; reason: string; resultDigest?: string }
/** Trusted owner port, never an HTTP/model-provided runtime or helper selector. */
export interface VmExecutorPort {
  /** A synchronous throw MUST precede all ownership/admission. Once a Promise
   * is returned, rejection is uncertain and requires exact reconciliation. */
  execute(input: VmExecutionInput): Promise<VmExecutionResult>;
  reconcile(actionId: string): VmExecutionResult | undefined | Promise<VmExecutionResult | undefined>;
  readResult?(actionId: string): VmExecutionResult | undefined | Promise<VmExecutionResult | undefined>;
  readCandidate?(actionId: string, path: string, sha256: string): Uint8Array | Promise<Uint8Array>;
  /** Passive admitted runtime validation; never prepares a helper or VM. */
  protectedPaths(runtime: AdmittedVmRuntime): readonly string[];
  status?(): { available: boolean; ownerHeld: boolean; actionId?: string; reason?: string };
  cancel(actionId: string): void | Promise<void>;
  close?(): void | Promise<void>;
}
export interface VmShellRunArguments { bindingId: string; script: string; inputPaths: string[]; outputPaths: string[]; timeoutMs: number }
export interface VmShellToolsProvider extends StandaloneBuiltinToolsProvider {
  status(scope?: ToolScope): VmShellToolsStatus;
  attach(scope: ToolScope, input: { root: string; label?: string }, explicitUserAction: boolean): VmShellBinding;
  revoke(scope: ToolScope, bindingId: string, explicitUserAction: boolean): Promise<void>;
  cancel(scope: ToolScope, operationId: string, explicitUserAction: boolean): Promise<void>;
  reconcileOperation(scope: ToolScope, operationId: string, explicitUserAction: boolean): Promise<Pick<import('../agent-tools/types').ToolOutcome, 'state' | 'result' | 'reason'> | undefined>;
  readCandidate(scope: Pick<ToolScope, 'taskId' | 'generation'>, operationId: string, path: string, sha256: string): Promise<Uint8Array>;
  close(): Promise<void>;
  readonly activeCount: number;
}
