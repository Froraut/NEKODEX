import { canReviewVmSource } from './output';
import { createHash, randomUUID } from 'node:crypto';
import { invocationFingerprint, validateToolScope } from '../agent-tools/journal';
import type {
  StandaloneBuiltinToolsProvider,
  ToolInvocation,
  ToolOutcome,
  ToolScope,
} from '../agent-tools/types';
import type { AdmittedVmRuntime, VmExecutionResult } from './executor';
import { defaultVmAuthorityDirectory } from './storage';
import { isSha256, keys, record, uniqueVmPaths, VM_LIMITS, vmAssert } from './protocol';
import {
  assertVmSnapshotRoot,
  canonicalVmProtectedPath,
  overlapsVmPath,
  pinVmSnapshotRoot,
  snapshotVmInputs,
  type VmSnapshotRoot,
} from './snapshot';
import type {
  VmExecutorPort,
  VmShellBinding,
  VmShellOperation,
  VmShellRunArguments,
  VmShellToolsProvider,
} from './types';
type Outcome = Pick<ToolOutcome, 'state' | 'result' | 'reason'>;
type Request = Omit<ToolInvocation, 'grantId'>;
interface Operation {
  request: Request;
  actionId: string;
  bindingId: string;
  held: boolean;
  settled: boolean;
  promise: Promise<Outcome>;
  value?: VmExecutionResult;
}
export function vmShellActionId(request: Request): string {
  vmAssert(
    typeof request.idempotencyKey === 'string' &&
      request.idempotencyKey.length > 0 &&
      request.idempotencyKey.length <= 240,
    'vm-call-identity',
  );
  const b = createHash('sha256')
    .update(JSON.stringify(['vm-shell-v1', invocationFingerprint(request), request.idempotencyKey]))
    .digest()
    .subarray(0, 16);
  b[6] = (b[6]! & 15) | 64;
  b[8] = (b[8]! & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function args(value: Record<string, unknown>): VmShellRunArguments {
  const a = record(value);
  keys(a, ['bindingId', 'script', 'inputPaths', 'outputPaths', 'timeoutMs']);
  vmAssert(
    typeof a.bindingId === 'string' &&
      a.bindingId.length <= 100 &&
      a.bindingId.length > 0 &&
      typeof a.script === 'string' &&
      a.script.length > 0 &&
      !a.script.includes('\0') &&
      Buffer.byteLength(a.script) <= VM_LIMITS.scriptBytes &&
      Number.isInteger(a.timeoutMs) &&
      Number(a.timeoutMs) >= 1 &&
      Number(a.timeoutMs) <= VM_LIMITS.timeoutMs,
    'vm-call-invalid',
  );
  return {
    bindingId: a.bindingId,
    script: a.script,
    inputPaths: uniqueVmPaths(a.inputPaths, VM_LIMITS.inputFiles),
    outputPaths: uniqueVmPaths(a.outputPaths, VM_LIMITS.outputFiles),
    timeoutMs: Number(a.timeoutMs),
  };
}
const failed: Outcome = {
  state: 'failed',
  reason: 'Exact VM workspace, runtime or approved call is unavailable or changed',
};
/** Existing ToolJournal owns approval/dedup. This builtin snapshots named files and makes no host write/export. */
export function createVmShellToolsProvider(options: {
  isScopeActive(scope: ToolScope): boolean;
  getRuntime(): AdmittedVmRuntime | undefined;
  executor: VmExecutorPort;
  privateOwnerHome: string;
  export?: Pick<StandaloneBuiltinToolsProvider, 'discover' | 'execute' | 'reconcile'>;
}): VmShellToolsProvider {
  let closed = false,
    closing: Promise<void> | undefined;
  const bindings = new Map<
      string,
      {
        public: VmShellBinding;
        root: VmSnapshotRoot;
      }
    >(),
    operations = new Map<string, Operation>();
  const same = (
    scope: ToolScope,
    owner: {
      taskId: string;
      generation: number;
    },
  ) => scope.taskId === owner.taskId && scope.generation === owner.generation;
  const protectedPaths = (runtime: AdmittedVmRuntime) => options.executor.protectedPaths(runtime);
  function active(scope: ToolScope, signal?: AbortSignal) {
    validateToolScope(scope);
    vmAssert(!closed && !signal?.aborted && options.isScopeActive(scope), 'vm-scope-unavailable');
  }
  function runtime() {
    const value = options.getRuntime();
    vmAssert(value && isSha256(value.runtimeDigest), 'vm-runtime-unavailable');
    protectedPaths(value);
    return value;
  }
  function bound(scope: ToolScope, id: string, selected: AdmittedVmRuntime) {
    active(scope);
    const binding = bindings.get(id);
    vmAssert(
      binding && same(scope, binding.public) && binding.public.runtimeDigest === selected.runtimeDigest,
      'vm-binding-changed',
    );
    assertVmSnapshotRoot(binding.root);
    for (const path of [options.privateOwnerHome, defaultVmAuthorityDirectory(), ...protectedPaths(selected)])
      vmAssert(
        !overlapsVmPath(binding.root.path, canonicalVmProtectedPath(path)),
        'vm-workspace-protected-overlap',
      );
    return binding;
  }
  function project(operationId: string, actionId: string, value: VmExecutionResult): Outcome {
    vmAssert(
      value.actionId === actionId &&
        ['stopped', 'never-started', 'unknown'].includes(value.state) &&
        typeof value.ownerHeld === 'boolean',
      'vm-receipt-mismatch',
    );
    vmAssert(value.state !== 'unknown' || value.ownerHeld, 'vm-receipt-mismatch');
    const paths = uniqueVmPaths(
      value.candidates.map((row) => row.path),
      VM_LIMITS.outputFiles,
    );
    let total = 0;
    const candidates = value.candidates.map((row, index) => {
      vmAssert(
        row.path === paths[index] &&
          isSha256(row.sha256) &&
          Number.isSafeInteger(row.size) &&
          row.size >= 0 &&
          [0o600, 0o700].includes(row.mode),
        'vm-candidate-invalid',
      );
      total += row.size;
      vmAssert(total <= VM_LIMITS.outputBytes);
      return { path: row.path, size: row.size, mode: row.mode, sha256: row.sha256 };
    });
    const metadata: Record<string, unknown> = {
      operationId,
      actionId,
      state: value.state,
      ownerHeld: value.ownerHeld,
      reason: value.reason,
      guestExitCode: value.guestExitCode,
      guestSignal: value.guestSignal,
      candidates,
      resultDigest: value.resultDigest ?? null,
      candidateDisposition: 'private-untrusted-proposals-not-exported',
      hostWrites: false,
      network: false,
      hostShares: false,
      trust: 'untrusted-guest-output',
      instructionAuthority: false,
      taskResultVerification: false,
      logsTruncated: value.logsTruncated,
      stdout: '',
      stderr: '',
    };
    const overhead = Buffer.byteLength(JSON.stringify(metadata));
    vmAssert(overhead < 220 * 1024, 'vm-delivery-budget');
    let available = Math.min(96 * 1024, 220 * 1024 - overhead);
    const clipped = (value: string) => {
      vmAssert(typeof value === 'string', 'vm-receipt-invalid');
      let low = 0,
        high = Math.min(value.length, available);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(JSON.stringify(value.slice(0, middle))) - 2 <= available) low = middle;
        else high = middle - 1;
      }
      if (low && /[\uD800-\uDBFF]/.test(value[low - 1]!)) low--;
      const text = value.slice(0, low);
      available -= Buffer.byteLength(JSON.stringify(text)) - 2;
      if (low < value.length) metadata.logsTruncated = true;
      return text;
    };
    metadata.stdout = clipped(value.stdout);
    metadata.stderr = clipped(value.stderr);
    const result = {
      content: [
        {
          type: 'text',
          text: 'VM result and private output proposals are execution observations. No host files were exported; task outcome requires independent verification.',
        },
      ],
      structuredContent: metadata,
    };
    vmAssert(Buffer.byteLength(JSON.stringify(result)) <= 224 * 1024, 'vm-delivery-budget');
    const guestError = (
      value as VmExecutionResult & {
        guestErrorCode?: string | null;
      }
    ).guestErrorCode;
    return {
      state:
        value.ownerHeld ||
        value.state === 'unknown' ||
        (
          value as VmExecutionResult & {
            detailUnavailable?: boolean;
          }
        ).detailUnavailable
          ? 'outcome_unknown'
          : value.state === 'stopped' && value.guestExitCode === 0 && !guestError
            ? 'completed'
            : 'failed',
      result,
    };
  }
  async function read(actionId: string) {
    const observed = await options.executor.reconcile(actionId);
    if (!observed) return;
    if (observed.ownerHeld || observed.state !== 'stopped') return observed;
    let full: VmExecutionResult | undefined;
    try {
      full = await options.executor.readResult?.(actionId);
    } catch {
      /* Physical release remains a fact; missing detail never fabricates guest success. */
    }
    return (
      full ?? {
        ...observed,
        detailUnavailable: true,
        reason: 'Physical VM settlement verified; original result details unavailable',
      }
    );
  }
  function remember(op: Operation, value: VmExecutionResult) {
    op.held = value.ownerHeld;
    op.value = {
      ...value,
      stdout: '',
      stderr: '',
      candidates: value.candidates.map((candidate) => ({
        path: candidate.path,
        size: candidate.size,
        mode: candidate.mode,
        sha256: candidate.sha256,
      })),
    };
  }
  async function drain(operationId: string, op: Operation) {
    if (!op.settled) {
      await options.executor.cancel(op.actionId);
      await op.promise;
    }
    if (op.held) {
      const value = await read(op.actionId);
      if (value) {
        project(operationId, op.actionId, value);
        remember(op, value);
      }
    }
    vmAssert(!op.held, 'vm-exact-owner-still-held');
  }
  function ownsVm(op: Operation) {
    return !op.settled || op.held;
  }
  function operationStatus(operationId: string, op: Operation): VmShellOperation {
    return {
      operationId,
      actionId: op.actionId,
      taskId: op.request.scope.taskId,
      generation: op.request.scope.generation,
      bindingId: op.bindingId,
      ownerHeld: op.held,
      state: op.value?.state ?? (op.settled ? (op.held ? 'unknown' : 'never-started') : 'pending'),
      guestExitCode: op.value?.guestExitCode ?? null,
      candidates: op.value?.candidates.map((row) => ({ ...row })) ?? [],
      reason:
        op.value?.reason ??
        (op.settled && !op.held
          ? 'VM request rejected before ownership admission'
          : 'Exact operation observation pending'),
      ...(op.value?.resultDigest ? { resultDigest: op.value.resultDigest } : {}),
    };
  }
  function activeOperationStatus(operationId: string, op: Operation) {
    return {
      operationId,
      actionId: op.actionId,
      taskId: op.request.scope.taskId,
      generation: op.request.scope.generation,
      bindingId: op.bindingId,
      ownerHeld: op.held,
    };
  }
  return {
    serverId: 'vm-shell',
    get activeCount() {
      return [...operations.values()].filter(ownsVm).length;
    },
    status(scope) {
      if (scope) validateToolScope(scope);
      let available = false,
        runtimeDigest: string | null = null;
      const physical = options.executor.status?.();
      try {
        const value = runtime();
        available = !closed && physical?.available !== false;
        runtimeDigest = value.runtimeDigest;
      } catch {
        /* Passive unavailable; never prepares runtime. */
      }
      return {
        available,
        ...(!available
          ? {
              reason:
                physical?.reason ??
                'The reviewed VM runtime is unavailable; status never prepares or starts a VM',
            }
          : {}),
        runtimeDigest,
        closed,
        bindings: [...bindings.values()]
          .filter((row) => !scope || same(scope, row.public))
          .map((row) => ({ ...row.public })),
        operations: [...operations]
          .filter(([, op]) => !scope || same(scope, op.request.scope))
          .slice(-64)
          .map(([id, op]) => operationStatus(id, op)),
        activeOperations: [...operations]
          .filter(([, op]) => ownsVm(op) && (!scope || same(scope, op.request.scope)))
          .map(([id, op]) => activeOperationStatus(id, op)),
      };
    },
    attach(scope, input, explicitUserAction) {
      active(scope);
      const selected = runtime();
      vmAssert(options.executor.status?.().available !== false, 'vm-global-owner-unavailable');
      vmAssert(
        explicitUserAction === true &&
          input &&
          Object.keys(input).every((k) => ['root', 'label'].includes(k)) &&
          typeof input.root === 'string',
        'vm-explicit-workspace-required',
      );
      const root = pinVmSnapshotRoot(input.root),
        label = input.label?.trim() || 'Selected VM input workspace';
      vmAssert(label.length <= 100 && !/[\u0000-\u001f]/.test(label), 'vm-label-invalid');
      for (const path of [
        options.privateOwnerHome,
        defaultVmAuthorityDirectory(),
        ...protectedPaths(selected),
      ])
        vmAssert(
          !overlapsVmPath(root.path, canonicalVmProtectedPath(path)),
          'vm-workspace-protected-overlap',
        );
      vmAssert(
        bindings.size < 64 && [...operations.values()].every((op) => op.settled && !op.held),
        'vm-prior-owner-held',
      );
      const row = {
        id: randomUUID(),
        taskId: scope.taskId,
        generation: scope.generation,
        label,
        runtimeDigest: selected.runtimeDigest,
      };
      active(scope);
      bindings.set(row.id, { public: row, root });
      return { ...row };
    },
    async revoke(scope, bindingId, explicitUserAction) {
      validateToolScope(scope);
      vmAssert(explicitUserAction === true, 'vm-explicit-revoke-required');
      const binding = bindings.get(bindingId);
      vmAssert(!binding || same(scope, binding.public), 'vm-binding-scope-mismatch');
      bindings.delete(bindingId);
      await Promise.all(
        [...operations]
          .filter(([, op]) => op.bindingId === bindingId && same(scope, op.request.scope))
          .map(([id, op]) => drain(id, op)),
      );
    },
    async cancel(scope, operationId, explicitUserAction) {
      validateToolScope(scope);
      vmAssert(explicitUserAction === true, 'vm-explicit-cancel-required');
      const op = operations.get(operationId);
      vmAssert(op && same(scope, op.request.scope), 'vm-operation-scope-mismatch');
      await drain(operationId, op);
    },
    async reconcileOperation(scope, operationId, explicitUserAction) {
      validateToolScope(scope);
      vmAssert(explicitUserAction === true, 'vm-explicit-reconcile-required');
      const op = operations.get(operationId);
      vmAssert(op && same(scope, op.request.scope), 'vm-operation-scope-mismatch');
      if (!op.settled) return;
      const value = await read(op.actionId);
      if (!value) return;
      const projected = project(operationId, op.actionId, value);
      remember(op, value);
      return projected;
    },
    async readCandidate(scope, operationId, path, expectedSha256) {
      vmAssert(
        typeof scope.taskId === 'string' &&
          Number.isSafeInteger(scope.generation) &&
          scope.generation > 0 &&
          isSha256(expectedSha256),
        'vm-candidate-scope-invalid',
      );
      // A fresh current-generation export review may select this task's retained
      // output. This read never revives its old execution/binding authority.
      const op = operations.get(operationId);
      vmAssert(
        op &&
          canReviewVmSource(scope, op.request.scope) &&
          op.settled &&
          !op.held &&
          op.value?.state === 'stopped',
        'vm-candidate-unavailable',
      );
      const candidate = op.value.candidates.find(
        (candidate) => candidate.path === path && candidate.sha256 === expectedSha256,
      );
      vmAssert(candidate && options.executor.readCandidate, 'vm-candidate-identity-mismatch');
      const bytes = await options.executor.readCandidate(op.actionId, path, expectedSha256);
      vmAssert(
        createHash('sha256').update(bytes).digest('hex') === expectedSha256 &&
          bytes.length === candidate.size &&
          bytes.length <= VM_LIMITS.outputBytes,
        'vm-candidate-changed',
      );
      return bytes;
    },
    async discover(scope, control = {}) {
      try {
        active(scope, control.signal);
      } catch {
        return [];
      }
      const exports = options.export ? await options.export.discover(scope, control).catch(() => []) : [];
      try {
        active(scope, control.signal);
        const selected = runtime(),
          ids = [...bindings.values()]
            .filter((row) => same(scope, row.public) && row.public.runtimeDigest === selected.runtimeDigest)
            .map((row) => bound(scope, row.public.id, selected).public.id);
        if (options.executor.status?.().available === false) return exports;
        if (!ids.length) return exports;
        return [
          ...exports,
          {
            id: 'vm-shell/run',
            serverId: 'vm-shell',
            name: 'run',
            supported: true,
            description:
              'Run this exact separately approved Linux shell script in one disposable offline ARM64 VM. Select an opaque workspace binding and only explicitly named relative input files to snapshot. No NIC or host shares. Returned candidates remain private untrusted proposals; execution does not export host files or verify task completion.',
            inputSchema: {
              type: 'object',
              properties: {
                bindingId: { type: 'string', enum: ids },
                script: { type: 'string', minLength: 1, maxLength: VM_LIMITS.scriptBytes },
                inputPaths: {
                  type: 'array',
                  maxItems: VM_LIMITS.inputFiles,
                  items: { type: 'string', maxLength: 512 },
                },
                outputPaths: {
                  type: 'array',
                  maxItems: VM_LIMITS.outputFiles,
                  items: { type: 'string', maxLength: 512 },
                },
                timeoutMs: { type: 'integer', minimum: 1, maximum: VM_LIMITS.timeoutMs },
              },
              required: ['bindingId', 'script', 'inputPaths', 'outputPaths', 'timeoutMs'],
              additionalProperties: false,
            },
          },
        ];
      } catch {
        try {
          active(scope, control.signal);
          return exports;
        } catch {
          return [];
        }
      }
    },
    async execute(request, control = {}) {
      if (request.tool === 'vm-shell/export' && options.export) {
        try {
          active(request.scope, control.signal);
        } catch {
          return failed;
        }
        return options.export.execute(request, control);
      }
      let actionId: string, call: VmShellRunArguments;
      try {
        active(request.scope, control.signal);
        vmAssert(request.tool === 'vm-shell/run');
        call = args(request.arguments);
        actionId = vmShellActionId(request);
      } catch {
        return failed;
      }
      const operationId = invocationFingerprint(request),
        previous = operations.get(operationId);
      if (previous) {
        vmAssert(previous.actionId === actionId, 'vm-operation-conflict');
        return previous.promise;
      }
      if (options.executor.status?.().available === false) return failed;
      if (operations.size >= 256 || [...operations.values()].some(ownsVm))
        return {
          state: 'failed',
          reason: 'A prior VM owner must physically settle before another operation',
        };
      const op: Operation = {
        request: structuredClone(request),
        actionId,
        bindingId: call.bindingId,
        held: false,
        settled: false,
        promise: undefined as never,
      };
      operations.set(operationId, op);
      op.promise = (async () => {
        let offered = false;
        try {
          const selected = runtime(),
            binding = bound(request.scope, call.bindingId, selected);
          const check = () => {
            active(request.scope, control.signal);
            vmAssert(runtime().runtimeDigest === selected.runtimeDigest, 'vm-runtime-changed');
            vmAssert(bound(request.scope, call.bindingId, selected) === binding, 'vm-binding-changed');
          };
          const snapshot = snapshotVmInputs(binding.root, call.inputPaths, check);
          check();
          let delivery: Promise<VmExecutionResult>;
          try {
            delivery = options.executor.execute({
              actionId,
              scope: { ...request.scope },
              runtime: selected,
              script: call.script,
              files: snapshot.files,
              outputPaths: call.outputPaths,
              timeoutMs: call.timeoutMs,
              assertCurrent: snapshot.assertCurrent,
              signal: control.signal,
            });
          } catch {
            return failed;
          } // Trusted sync guard: no VM owner was admitted.
          offered = true;
          op.held = true;
          const value = await delivery;
          const outcome = project(operationId, actionId, value);
          remember(op, value);
          return outcome;
        } catch {
          return offered
            ? {
                state: 'outcome_unknown' as const,
                reason: 'The exact VM owner has no confirmed released outcome; reconcile without replay',
              }
            : failed;
        }
      })();
      void op.promise.finally(() => {
        op.settled = true;
      });
      return op.promise;
    },
    async reconcile(request) {
      if (request.tool === 'vm-shell/export' && options.export?.reconcile)
        return options.export.reconcile(request);
      if (request.tool !== 'vm-shell/run') return;
      const actionId = vmShellActionId(request),
        value = await read(actionId);
      if (!value) return;
      const operationId = invocationFingerprint(request),
        result = project(operationId, actionId, value);
      let op = operations.get(operationId);
      if (!op) {
        const call = args(request.arguments);
        op = {
          request: structuredClone(request),
          actionId,
          bindingId: call.bindingId,
          held: value.ownerHeld,
          settled: true,
          promise: Promise.resolve(result),
        };
        operations.set(operationId, op);
      }
      remember(op, value);
      return result;
    },
    invalidate(taskId) {
      for (const [id, binding] of bindings)
        if (!taskId || binding.public.taskId === taskId) bindings.delete(id);
      for (const op of operations.values())
        if (!op.settled && (!taskId || op.request.scope.taskId === taskId))
          void Promise.resolve(options.executor.cancel(op.actionId)).catch(() => {});
    },
    close() {
      if (closing) return closing;
      closed = true;
      bindings.clear();
      closing = (async () => {
        await Promise.all([...operations].map(([id, op]) => drain(id, op)));
        await options.executor.close?.();
      })().catch((error) => {
        closing = undefined;
        throw error;
      });
      return closing;
    },
  };
}
