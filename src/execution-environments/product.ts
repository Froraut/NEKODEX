import { VmEnvironmentController } from './environment';
import { VmExecutor, type VmRuntimeSelection } from './executor';
import { createVmShellToolsProvider } from './tools';
import { canReviewVmSource, selectVmOutputCandidates } from './output';
import type { VmExecutorPort, VmShellToolsProvider } from './types';
import { invocationFingerprint, validateToolScope } from '../agent-tools/journal';
import type { StandaloneBuiltinToolsProvider, ToolInvocation, ToolOutcome, ToolScope } from '../agent-tools/types';
import { PythonBuildController, attachPythonBuildEnvironment, type PythonBuildSelection, type LinuxVmPythonEnvironment } from './python-build';
import { uniqueVmPaths } from './protocol';
import { VmNetworkBroker, type VmNetworkGrant, type VmNetworkGrantInput, type VmNetworkLedger, type VmNetworkScope, type VmNetworkTransport } from './network';
import { FileVmNetworkLedger } from './network-ledger';
import { DirectVmNetworkTransport } from './network-transport';
import { join } from 'node:path';
import { z } from 'zod';

type SavedVmCall = Omit<ToolInvocation, 'grantId'>;
interface VmProductOptions {
  home: string; runtimeSelection?: VmRuntimeSelection; executor?: VmExecutorPort;
  export?: Pick<StandaloneBuiltinToolsProvider, 'discover' | 'execute' | 'reconcile'>;
  isScopeActive(scope: ToolScope): boolean;
  assertMutation(explicit: boolean): void;
  assertScope(scope: ToolScope): void;
  savedCalls(scope: Pick<ToolScope, 'taskId' | 'generation'>): readonly SavedVmCall[];
  existingOutcome(request: SavedVmCall): ToolOutcome | undefined;
  networkLedger?: VmNetworkLedger;
  networkTransport?: VmNetworkTransport;
}
const networkArguments = z.object({ grantId: z.string().uuid(), actionId: z.string().min(1).max(200), url: z.string().min(1).max(8192),
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
  headers: z.object({ accept: z.string().max(1024).optional(), 'content-type': z.string().max(1024).optional() }).strict().optional(),
  bodyBase64: z.string().max(87384).optional() }).strict();

/** Product coordination only. The shared tool host retains approval/journal
 * authority; the executor retains physical ownership and immutable results. */
export class VmProductController {
  readonly provider: VmShellToolsProvider;
  readonly networkProvider: StandaloneBuiltinToolsProvider;
  private readonly environment: VmEnvironmentController;
  private readonly restored = new Set<string>();
  private readonly executor: VmExecutorPort;
  private readonly builds: PythonBuildController;
  private readonly buildScopes = new Map<string, ToolScope>();
  private readonly pythonBindings = new Map<string, { actionId: string; scope: ToolScope; environment: LinuxVmPythonEnvironment }>();
  private network?: VmNetworkBroker;
  private readonly networkGrants = new Map<string, { grant: VmNetworkGrant; revoked: boolean }>();
  private networkPending = 0;
  constructor(private readonly options: VmProductOptions) {
    this.environment = new VmEnvironmentController(options.runtimeSelection);
    this.executor = options.executor ?? new VmExecutor();
    this.builds = new PythonBuildController({ getRuntime: () => this.environment.getRuntime(), executor: this.executor });
    const executor: VmExecutorPort = {
      execute: input => {
        const key = JSON.stringify([input.scope.taskId, input.scope.generation]), binding = this.pythonBindings.get(key);
        if (!binding) return this.executor.execute(input);
        const check = () => {
          input.assertCurrent?.(); this.options.assertScope(input.scope);
          if (this.pythonBindings.get(key) !== binding) throw new Error('Explicit Python build attachment changed');
          if (this.environment.getRuntime() !== input.runtime) throw new Error('Explicit Python build runtime changed');
          this.executor.protectedPaths(input.runtime);
        };
        check();
        const files = [...input.files, ...attachPythonBuildEnvironment(binding.environment, input.runtime, this.executor, true)];
        uniqueVmPaths(files.map(file => file.path), 4096);
        return this.executor.execute({ ...input, files, assertCurrent: check });
      },
      reconcile: id => this.executor.reconcile(id), readResult: id => this.executor.readResult?.(id),
      readCandidate: (id, path, digest) => { if (!this.executor.readCandidate) throw new Error('VM candidate reader unavailable'); return this.executor.readCandidate(id, path, digest); },
      protectedPaths: runtime => this.executor.protectedPaths(runtime), cancel: id => this.executor.cancel(id),
      ...(this.executor.status ? { status: () => this.executor.status!() } : {}),
      close: () => this.executor.close?.(),
    };
    this.provider = createVmShellToolsProvider({ privateOwnerHome: options.home,
      getRuntime: () => this.environment.getRuntime(), executor,
      export: options.export, isScopeActive: options.isScopeActive });
    const request = (call: SavedVmCall) => {
      const args = networkArguments.parse(call.arguments), body = args.bodyBase64 === undefined ? undefined : Buffer.from(args.bodyBase64, 'base64');
      if (body && (body.length > 65536 || body.toString('base64') !== args.bodyBase64)) throw new Error('Explicit network body must be canonical bounded base64');
      return { grantId: args.grantId, scope: { taskId: call.scope.taskId, generation: call.scope.generation, actionId: args.actionId },
        requestId: invocationFingerprint(call), url: args.url, method: args.method, headers: args.headers, body };
    };
    this.networkProvider = {
      serverId: 'vm-network',
      discover: async scope => {
        const grants = [...this.networkGrants.values()].filter(row => !row.revoked && row.grant.scope.taskId === scope.taskId && row.grant.scope.generation === scope.generation);
        if (!this.options.isScopeActive(scope) || !grants.length) return [];
        return [{ id: 'vm-network/request', serverId: 'vm-network', name: 'request', supported: true,
          description: 'Perform one separately approved host-broker HTTP request under an explicit pinned public destination grant. This does not give the Linux guest a NIC or general network access. No DNS, cookies, proxy or host credentials.',
          inputSchema: { type: 'object', additionalProperties: false, required: ['grantId', 'actionId', 'url', 'method'], properties: {
            grantId: { type: 'string', enum: grants.map(row => row.grant.id) }, actionId: { type: 'string', enum: [...new Set(grants.map(row => row.grant.scope.actionId))] }, url: { type: 'string', maxLength: 8192 }, method: { type: 'string', enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] },
            headers: { type: 'object', additionalProperties: false, properties: { accept: { type: 'string' }, 'content-type': { type: 'string' } } }, bodyBase64: { type: 'string', maxLength: 87384 } } } }];
      },
      execute: async (call, options) => {
        this.options.assertScope(call.scope);
        if (call.tool !== 'vm-network/request' || !this.network) return { state: 'failed', reason: 'Explicit network grant is unavailable' };
        const input = request(call); this.networkPending++;
        try {
          const result = await this.network.request(input, options);
          const response = result.response ? { statusCode: result.response.statusCode, bodyBase64: Buffer.from(result.response.body.subarray(0, 65536)).toString('base64'), truncated: result.response.body.length > 65536 } : undefined;
          return { state: result.receipt.state === 'completed' ? 'completed' : result.receipt.state === 'never-sent' ? 'failed' : 'outcome_unknown', result: { receipt: result.receipt, ...(response ? { response } : {}) }, reason: result.receipt.reason };
        } finally { this.networkPending--; }
      },
      reconcile: async call => {
        if (call.tool !== 'vm-network/request' || !this.network) return;
        const input = request(call), receipt = this.network.receipt(input.scope, input.requestId);
        return receipt ? { state: receipt.state === 'completed' ? 'completed' : receipt.state === 'never-sent' ? 'failed' : 'outcome_unknown', result: { receipt }, reason: receipt.reason } : undefined;
      },
      invalidate: taskId => { for (const row of this.networkGrants.values()) if (!taskId || row.grant.scope.taskId === taskId) { row.revoked = true; void this.network?.cancelScope(row.grant.scope).catch(() => undefined); } },
    };
  }
  private networkOwnerScope(scope: VmNetworkScope): ToolScope { return { taskId: scope.taskId, generation: scope.generation, toolCallId: scope.actionId }; }
  networkStatus(scope?: ToolScope) {
    return { available: true, mode: 'separately-approved-host-broker', guestNic: false, activeCount: this.networkPending,
      grants: [...this.networkGrants.values()].filter(row => !scope || row.grant.scope.taskId === scope.taskId && row.grant.scope.generation === scope.generation).map(row => structuredClone(row)) };
  }
  grantNetwork(input: VmNetworkGrantInput, explicit: boolean) {
    this.options.assertMutation(explicit); this.options.assertScope(this.networkOwnerScope(input.scope));
    this.network ??= new VmNetworkBroker(this.options.networkLedger ?? new FileVmNetworkLedger(join(this.options.home, 'vm-network-receipts')),
      this.options.networkTransport ?? new DirectVmNetworkTransport(), {
        assertCurrent: scope => this.options.assertScope(this.networkOwnerScope(scope)),
        stop: async scope => {
          for (const operation of this.provider.status().activeOperations) if (operation.taskId === scope.taskId && operation.generation === scope.generation && operation.actionId === scope.actionId) await this.provider.cancel(this.networkOwnerScope(scope), operation.operationId, true);
          const action = this.builds.inspect(scope.actionId), saved = this.buildScopes.get(scope.actionId);
          if (action?.ownerHeld && saved?.taskId === scope.taskId && saved.generation === scope.generation) await this.builds.cancel(scope.actionId, true);
        },
      });
    const grant = this.network.grant(input, true); this.networkGrants.set(grant.id, { grant, revoked: false }); return grant;
  }
  async revokeNetwork(scope: VmNetworkScope, grantId: string, explicit: boolean) {
    this.options.assertMutation(explicit);
    if (!this.network) throw new Error('Explicit network grant is unavailable');
    await this.network.revoke(scope, grantId, explicit); const row = this.networkGrants.get(grantId); if (row) row.revoked = true;
    return this.networkStatus(this.networkOwnerScope(scope));
  }
  async closeNetwork() { await this.network?.close(); }
  /** Trusted composition ports only; neither object is accepted from HTTP. */
  getRuntime() { return this.environment.getRuntime(); }
  getExecutor() { return this.executor; }
  get buildActiveCount() { return this.builds.actions().filter(action => action.ownerHeld).length; }
  pythonBuildStatus(scope?: ToolScope) {
    const matches = (s: ToolScope) => !scope || s.taskId === scope.taskId && s.generation === scope.generation;
    const runtime = this.environment.getRuntime(), supported = runtime?.kind === 'development-linux-vm';
    return { supported, reason: supported ? undefined : runtime ? 'Python builds require the separately reviewed development toolchain' : 'Prepare the reviewed VM runtime first',
      actions: this.builds.actions().filter(action => { const s = this.buildScopes.get(action.review.actionId); return s && matches(s); }),
      bindings: [...this.pythonBindings.values()].filter(binding => matches(binding.scope)).map(binding => ({ actionId: binding.actionId, taskId: binding.scope.taskId, generation: binding.scope.generation, closureDigest: binding.environment.closureDigest, packages: binding.environment.packages })),
      processLocalReviews: true, importRoot: 'python-environment', network: false };
  }
  reviewPythonBuild(actionId: string, selection: PythonBuildSelection, scope: ToolScope, explicit: boolean) {
    this.options.assertMutation(explicit); this.options.assertScope(scope);
    const review = this.builds.review(actionId, selection, true); this.buildScopes.set(actionId, { ...scope }); return review;
  }
  private buildScope(actionId: string, scope?: ToolScope) {
    const saved = this.buildScopes.get(actionId);
    if (!saved || scope && (saved.taskId !== scope.taskId || saved.generation !== scope.generation)) throw new Error('No exact Python build task scope');
    return saved;
  }
  preparePythonBuild(actionId: string, digest: string, scope: ToolScope, explicit: boolean) {
    this.options.assertMutation(explicit); this.options.assertScope(scope); this.buildScope(actionId, scope);
    return this.builds.prepare(actionId, digest, scope, true, undefined, () => this.options.assertScope(scope));
  }
  attachPythonBuild(actionId: string, scope: ToolScope, explicit: boolean) {
    this.options.assertMutation(explicit); this.options.assertScope(scope); this.buildScope(actionId, scope);
    const action = this.builds.inspect(actionId), runtime = this.environment.getRuntime();
    if (!runtime || action?.state !== 'ready' || !action.environment) throw new Error('No exact ready Python build environment');
    attachPythonBuildEnvironment(action.environment, runtime, this.executor, true);
    this.pythonBindings.set(JSON.stringify([scope.taskId, scope.generation]), { actionId, scope: { ...scope }, environment: action.environment });
    return this.pythonBuildStatus(scope);
  }
  async revokePythonBuild(scope: ToolScope, explicit: boolean) {
    if (!explicit) throw new Error('Explicit Python build attachment revocation required'); validateToolScope(scope);
    this.pythonBindings.delete(JSON.stringify([scope.taskId, scope.generation]));
    for (const operation of this.provider.status(scope).activeOperations) if (operation.taskId === scope.taskId && operation.generation === scope.generation) await this.provider.cancel(scope, operation.operationId, true);
    return this.pythonBuildStatus(scope);
  }
  cancelPythonBuild(actionId: string, explicit: boolean) { this.buildScope(actionId); return this.builds.cancel(actionId, explicit); }
  reconcilePythonBuild(actionId: string, explicit: boolean) { this.buildScope(actionId); return this.builds.reconcile(actionId, explicit); }
  async closeBuilds() { for (const action of this.builds.actions()) if (action.ownerHeld) await this.builds.cancel(action.review.actionId, true); this.pythonBindings.clear(); }
  async invalidateBuilds(taskId: string) {
    for (const [key, binding] of this.pythonBindings) if (binding.scope.taskId === taskId) this.pythonBindings.delete(key);
    const pending = this.builds.actions().filter(action => action.ownerHeld && this.buildScopes.get(action.review.actionId)?.taskId === taskId);
    await Promise.allSettled(pending.map(action => this.builds.cancel(action.review.actionId, true)));
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
    if (this.provider.activeCount || this.buildActiveCount) throw new Error('Wait for owned VM operations before preparing an environment');
    return this.environment.prepare(actionId, reviewDigest, true);
  }
  attach(scope: ToolScope, root: string, acknowledged: boolean, explicit: boolean) {
    this.options.assertMutation(explicit); this.options.assertScope(scope);
    if (!acknowledged) throw new Error('Explicit VM snapshot isolation acknowledgement required');
    return this.provider.attach(scope, { root }, true);
  }
}
