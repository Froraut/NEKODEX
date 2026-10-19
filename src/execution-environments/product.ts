import { VmEnvironmentController } from './environment';
import { VmExecutor, type VmRuntimeSelection } from './executor';
import { createVmShellToolsProvider } from './tools';
import { canReviewVmSource, selectVmOutputCandidates } from './output';
import type { VmExecutorPort, VmShellToolsProvider } from './types';
import { invocationFingerprint, validateToolScope } from '../agent-tools/journal';
import type { StandaloneBuiltinToolsProvider, ToolInvocation, ToolOutcome, ToolScope } from '../agent-tools/types';

type SavedVmCall = Omit<ToolInvocation, 'grantId'>;
interface VmProductOptions {
  home: string; runtimeSelection?: VmRuntimeSelection; executor?: VmExecutorPort;
  export?: Pick<StandaloneBuiltinToolsProvider, 'discover' | 'execute' | 'reconcile'>;
  isScopeActive(scope: ToolScope): boolean;
  assertMutation(explicit: boolean): void;
  assertScope(scope: ToolScope): void;
  savedCalls(scope: Pick<ToolScope, 'taskId' | 'generation'>): readonly SavedVmCall[];
  existingOutcome(request: SavedVmCall): ToolOutcome | undefined;
}

/** Product coordination only. The shared tool host retains approval/journal
 * authority; the executor retains physical ownership and immutable results. */
export class VmProductController {
  readonly provider: VmShellToolsProvider;
  private readonly environment: VmEnvironmentController;
  private readonly restored = new Set<string>();
  constructor(private readonly options: VmProductOptions) {
    this.environment = new VmEnvironmentController(options.runtimeSelection);
    this.provider = createVmShellToolsProvider({ privateOwnerHome: options.home,
      getRuntime: () => this.environment.getRuntime(), executor: options.executor ?? new VmExecutor(),
      export: options.export, isScopeActive: options.isScopeActive });
  }
  available(currentScopes: readonly ToolScope[]): boolean {
    const status = this.provider.status();
    return status.available && status.bindings.some(row => this.options.isScopeActive({ ...row, toolCallId: 'vm-discovery' }))
      || status.operations.some(row => [row, ...currentScopes].some(current =>
        selectVmOutputCandidates([row], current).length > 0 && this.options.isScopeActive({ ...current, toolCallId: 'vm-export-discovery' })));
  }
  projection() { return { vmEnvironment: this.environment.status(), vmTools: this.provider.status() }; }
  async status(current?: ToolScope) {
    if (current) {
      validateToolScope(current);
      for (const request of this.options.savedCalls(current).slice(-64)) {
        if (request.tool !== 'vm-shell/run' || !canReviewVmSource(current, request.scope)) continue;
        const fingerprint = invocationFingerprint(request);
        if (this.restored.has(fingerprint) || !this.options.existingOutcome(request)) continue;
        // Original request + journal identity, then the real retained executor
        // receipt. No runtime preparation, snapshot, grant or execution replay.
        // Status stays passive: a busy or locked owner (a live run, another
        // profile) is retried on the next status instead of failing it.
        const observed = await this.provider.reconcile?.(request).catch(() => undefined);
        if (observed && observed.state !== 'outcome_unknown') this.restored.add(fingerprint);
      }
    }
    return this.projection(); // Global held owners remain reachable for cancellation.
  }
  /** A fresh core restores the exact retained run first, so an export review
   * prepared before a restart can still read its candidate. */
  async readCandidate(scope: Pick<ToolScope, 'taskId' | 'generation'>, operationId: string, path: string, sha256: string) {
    await this.status({ ...scope, toolCallId: 'vm-export-candidate' });
    return this.provider.readCandidate(scope, operationId, path, sha256);
  }
  review(actionId: string, explicit: boolean) {
    this.options.assertMutation(explicit); return this.environment.review(actionId, true).review!;
  }
  prepare(actionId: string, reviewDigest: string, explicit: boolean) {
    this.options.assertMutation(explicit);
    if (this.provider.activeCount) throw new Error('Wait for owned VM operations before preparing an environment');
    return this.environment.prepare(actionId, reviewDigest, true);
  }
  attach(scope: ToolScope, root: string, acknowledged: boolean, explicit: boolean) {
    this.options.assertMutation(explicit); this.options.assertScope(scope);
    if (!acknowledged) throw new Error('Explicit VM snapshot isolation acknowledgement required');
    return this.provider.attach(scope, { root }, true);
  }
}
