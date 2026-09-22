import { createHash } from "node:crypto";
import { opaqueId, brokerResponseLineChars, MAX_BROKER_LINE_CHARS,
  type BrokerToolResult, type BrokerOwnedOperationSnapshot, type BrokerOwnedOperationStatus,
  type OwnedOperationState } from "./turn-broker-protocol";

interface PollWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

type InvocationIdentity = Parameters<typeof ownedInvocationFingerprint>[0];
interface OwnedToolOperation {
  id: string;
  token: string;
  bindingId: string;
  callId: string;
  requestFingerprint: string;
  state: OwnedOperationState;
  createdAt: number;
  updatedAt: number;
  result?: BrokerToolResult;
  error?: string;
  cancellationScope?: "queued" | "observation_only";
  deliveryId?: string;
  retainedBytes: number;
  waiters: Set<PollWaiter>;
}

interface AcknowledgedOwnedOperation {
  token: string;
  bindingId: string;
  requestFingerprint: string;
  deliveryId: string;
  updatedAt: number;
}

const MAX_DISCOVERABLE_OWNED_TOOL_OPERATIONS = 64;
// Acknowledged identities are compact replay guards rather than active work. Keep them until turn
// retirement, but fail new unique starts at a clear bound instead of evicting a guard and allowing
// an already-consumed side effect to execute again.
const MAX_OWNED_TOOL_OPERATION_GUARDS_PER_TURN = 4_096;
const OWNED_TOOL_OPERATION_TTL_MS = 30 * 60_000;
const MAX_OWNED_TOOL_OPERATION_BYTES_PER_TURN = 128 * 1024 * 1024;

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => [key, canonicalJsonValue(entry)]));
}

function ownedInvocationFingerprint(request: {
  bindingId: string;
  wireName: string;
  freeform: boolean;
  input?: string;
  arguments?: Record<string, unknown>;
}): string {
  return createHash("sha256").update(JSON.stringify({
    bindingId: request.bindingId,
    wireName: request.wireName,
    freeform: request.freeform,
    ...(request.freeform
      ? { input: request.input ?? "" }
      : { arguments: canonicalJsonValue(request.arguments ?? {}) }),
  })).digest("hex");
}

/** Retains results and replay identities; never authorizes or dispatches tools. */
export class OwnedToolOperationStore {
  private readonly ownedOperations = new Map<string, OwnedToolOperation>();
  private readonly acknowledgedOperations = new Map<string, AcknowledgedOwnedOperation>();
  constructor(private readonly onChange: (token: string) => void, private readonly now: () => number = () => Date.now()) {}

  lookup(token: string, operationId: string, request: InvocationIdentity): BrokerOwnedOperationSnapshot | undefined {
    const bindingId = request.bindingId;
    const requestFingerprint = ownedInvocationFingerprint(request);
    const existing = this.ownedOperations.get(operationId);
    if (existing) {
      if (existing.token !== token || existing.bindingId !== bindingId
        || existing.requestFingerprint !== requestFingerprint) {
        throw new Error("owned Codex tool operation key was reused with a different invocation");
      }
      return this.ownedOperationSnapshot(existing);
    }
    const acknowledged = this.acknowledgedOperations.get(operationId);
    if (acknowledged) {
      if (acknowledged.token !== token || acknowledged.bindingId !== bindingId
        || acknowledged.requestFingerprint !== requestFingerprint) {
        throw new Error("owned Codex tool operation key was reused with a different invocation");
      }
      return { operationId, state: "acknowledged" };
    }
  }

  assertCapacity(token: string): void {
    const liveOperationCount = [...this.ownedOperations.values()]
      .filter(operation => operation.token === token).length;
    const acknowledgedGuardCount = [...this.acknowledgedOperations.values()]
      .filter(operation => operation.token === token).length;
    if (liveOperationCount >= MAX_DISCOVERABLE_OWNED_TOOL_OPERATIONS) {
      throw new Error(`Codex turn owns ${MAX_DISCOVERABLE_OWNED_TOOL_OPERATIONS} live or unacknowledged async operations`);
    }
    if (liveOperationCount + acknowledgedGuardCount >= MAX_OWNED_TOOL_OPERATION_GUARDS_PER_TURN) {
      throw new Error(
        `Codex turn reached its ${MAX_OWNED_TOOL_OPERATION_GUARDS_PER_TURN} unique async operation guard limit;`
        + " retire the turn instead of reusing or evicting an acknowledged operation key",
      );
    }
  }

  start(token: string, id: string, callId: string, request: InvocationIdentity,
    invocation: Promise<BrokerToolResult>): BrokerOwnedOperationSnapshot {
    const operation: OwnedToolOperation = {
      id, token, bindingId: request.bindingId, callId,
      requestFingerprint: ownedInvocationFingerprint(request), state: "running",
      createdAt: this.now(), updatedAt: this.now(), retainedBytes: 0, waiters: new Set(),
    };
    this.ownedOperations.set(id, operation);
    this.onChange(token);
    void invocation.then(
      result => this.finishOwnedOperation(operation, "completed", result),
      error => this.finishOwnedOperation(operation, "failed", undefined,
        error instanceof Error ? error.message : String(error)),
    );
    return this.ownedOperationSnapshot(operation);
  }

  status(token: string): BrokerOwnedOperationStatus {
    // dispatch() prunes expiry before this synchronous projection.
    // Do not expose delivery IDs: discovery must not supply an ack without its result.
    // Project an explicit allowlist; never serialize stored requests, results or errors.
    const liveOperations: BrokerOwnedOperationStatus["operations"] = [];
    for (const operation of this.ownedOperations.values()) {
      if (operation.token !== token) continue;
      liveOperations.push({
        operation_id: operation.id,
        state: operation.state,
        acknowledgement_required: operation.state !== "running",
        ...(operation.cancellationScope ? { cancellation_scope: operation.cancellationScope } : {}),
      });
    }
    liveOperations.sort((a, b) => a.operation_id < b.operation_id ? -1 : a.operation_id > b.operation_id ? 1 : 0);
    const acknowledged = [...this.acknowledgedOperations]
      .filter(([, operation]) => operation.token === token)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt);
    const acknowledgedSlots = Math.max(0, MAX_DISCOVERABLE_OWNED_TOOL_OPERATIONS - liveOperations.length);
    const visibleAcknowledged = acknowledged.slice(0, acknowledgedSlots)
      .map(([id]) => ({ operation_id: id, state: "acknowledged" as const, acknowledgement_required: false }));
    const operations = [...liveOperations, ...visibleAcknowledged];
    const omitted = Math.max(0, liveOperations.length + acknowledged.length - operations.length);
    return {
      operations,
      limit: MAX_DISCOVERABLE_OWNED_TOOL_OPERATIONS,
      truncated: omitted > 0,
      ...(omitted > 0 ? { omitted } : {}),
    } satisfies BrokerOwnedOperationStatus;
  }

  private requireOperation(token: string, id: string): OwnedToolOperation | undefined {
    this.pruneOwnedOperations();
    const operation = this.ownedOperations.get(id);
    if (operation?.token === token) return operation;
    if (!operation && this.acknowledgedOperations.get(id)?.token === token) return undefined;
    throw new Error("owned Codex tool operation is invalid or expired");
  }

  runningCallId(token: string, id: string): string | undefined {
    const operation = this.requireOperation(token, id);
    return operation?.state === "running" ? operation.callId : undefined;
  }

  snapshot(token: string, id: string): BrokerOwnedOperationSnapshot {
    const operation = this.requireOperation(token, id);
    return operation ? this.ownedOperationSnapshot(operation) : { operationId: id, state: "acknowledged" };
  }

  cancel(token: string, id: string, scope: "queued" | "observation_only"): BrokerOwnedOperationSnapshot {
    const operation = this.requireOperation(token, id);
    if (operation?.state === "running") {
      operation.cancellationScope = scope;
      this.finishOwnedOperation(operation, "cancelled", undefined, scope === "observation_only"
        ? "Owned Codex tool observation was cancelled; the dispatched external tool may still complete or cause side effects"
        : "Owned Codex tool operation was cancelled before dispatch");
    }
    return this.snapshot(token, id);
  }

  runningWithoutInvocation(token: string, hasInvocation: (callId: string) => boolean): number {
    return [...this.ownedOperations.values()].filter(operation => operation.token === token
      && operation.state === "running" && !hasInvocation(operation.callId)).length;
  }

  close(): void {
    for (const operation of this.ownedOperations.values()) {
      this.finishOwnedOperation(operation, "cancelled", undefined, "ChatGPT turn broker closed");
    }
  }

  private finishOwnedOperation(
    operation: OwnedToolOperation,
    state: Exclude<OwnedOperationState, "running">,
    result?: BrokerToolResult,
    error?: string,
  ): void {
    if (operation.state !== "running" || this.ownedOperations.get(operation.id) !== operation) return;
    if (state === "completed" && result === undefined) {
      state = "failed";
      error = "Owned Codex tool operation completed without a result";
    }
    const deliveryId = opaqueId("delivery");
    const retained = Buffer.byteLength(JSON.stringify(result ?? error ?? ""), "utf8");
    const existingOwnerBytes = [...this.ownedOperations.values()]
      .filter(value => value.token === operation.token)
      .reduce((sum, value) => sum + value.retainedBytes, 0);
    const candidateSnapshot: BrokerOwnedOperationSnapshot = state === "completed" && result
      ? { operationId: operation.id, state, deliveryId, result }
      : { operationId: operation.id, state: state === "completed" ? "failed" : state, deliveryId,
          error: error ?? `Owned Codex tool operation ${state}`,
          ...(operation.cancellationScope ? { cancellationScope: operation.cancellationScope } : {}) };
    const exceedsTransport = brokerResponseLineChars(candidateSnapshot) > MAX_BROKER_LINE_CHARS;
    if (exceedsTransport || existingOwnerBytes + retained > MAX_OWNED_TOOL_OPERATION_BYTES_PER_TURN) {
      state = "failed";
      result = undefined;
      error = exceedsTransport
        ? "Owned Codex tool result exceeded the broker transport envelope and was not retained; the external tool may already have completed or caused side effects"
        : "Owned Codex tool results exceeded this turn's retention budget; the external tool may already have completed or caused side effects";
    }
    operation.state = state;
    operation.updatedAt = this.now();
    operation.deliveryId = deliveryId;
    operation.result = result === undefined ? undefined : structuredClone(result);
    operation.error = error;
    operation.retainedBytes = Buffer.byteLength(JSON.stringify(operation.result ?? operation.error ?? ""), "utf8");
    this.onChange(operation.token);
    for (const waiter of operation.waiters) waiter.resolve();
    operation.waiters.clear();
  }

  private ownedOperationSnapshot(operation: OwnedToolOperation): BrokerOwnedOperationSnapshot {
    if (operation.state === "running") return { operationId: operation.id, state: "running" };
    if (!operation.deliveryId) throw new Error("Owned Codex tool operation has no delivery identity");
    if (operation.state === "completed") {
      if (!operation.result) throw new Error("Completed owned Codex tool operation has no result");
      return { operationId: operation.id, state: "completed", deliveryId: operation.deliveryId,
        result: structuredClone(operation.result) };
    }
    return { operationId: operation.id, state: operation.state, deliveryId: operation.deliveryId,
      error: operation.error ?? `Owned Codex tool operation ${operation.state}`,
      ...(operation.cancellationScope ? { cancellationScope: operation.cancellationScope } : {}) };
  }

  async poll(
    token: string,
    operationId: string,
    deliveryId?: string,
    waitMs = 0,
    signal?: AbortSignal,
  ): Promise<BrokerOwnedOperationSnapshot> {
    this.pruneOwnedOperations();
    const operation = this.ownedOperations.get(operationId);
    if (!operation) {
      const acknowledged = this.acknowledgedOperations.get(operationId);
      if (acknowledged?.token === token
        && (deliveryId === undefined || acknowledged.deliveryId === deliveryId)) {
        return { operationId, state: "acknowledged" };
      }
      throw new Error("owned Codex tool operation is invalid or expired");
    }
    if (operation.token !== token) throw new Error("owned Codex tool operation is invalid or expired");
    if (deliveryId !== undefined) {
      if (operation.state === "running" || operation.deliveryId !== deliveryId) {
        throw new Error("owned Codex tool delivery acknowledgement is invalid");
      }
      this.acknowledgedOperations.delete(operation.id);
      this.acknowledgedOperations.set(operation.id, {
        token: operation.token,
        bindingId: operation.bindingId,
        requestFingerprint: operation.requestFingerprint,
        deliveryId,
        updatedAt: this.now(),
      });
      this.ownedOperations.delete(operation.id);
      this.onChange(operation.token);
      return { operationId, state: "acknowledged" };
    }
    if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 30_000) {
      throw new Error("owned Codex tool poll wait must be between 0 and 30000ms");
    }
    if (operation.state === "running" && waitMs > 0) {
      if (signal?.aborted) throw new DOMException("owned operation poll aborted", "AbortError");
      await new Promise<void>((resolveWait, rejectWait) => {
        const waiter: PollWaiter = { resolve: resolveWait, reject: rejectWait, ...(signal ? { signal } : {}) };
        const cleanup = () => {
          clearTimeout(timer);
          operation.waiters.delete(waiter);
          if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
        };
        const timer = setTimeout(() => { cleanup(); resolveWait(); }, waitMs);
        timer.unref?.();
        waiter.resolve = () => { cleanup(); resolveWait(); };
        waiter.reject = pollError => { cleanup(); rejectWait(pollError); };
        if (signal) {
          waiter.onAbort = () => { cleanup(); rejectWait(new DOMException("owned operation poll aborted", "AbortError")); };
          signal.addEventListener("abort", waiter.onAbort, { once: true });
        }
        operation.waiters.add(waiter);
      });
    }
    return this.ownedOperationSnapshot(operation);
  }

  pruneOwnedOperations(now = this.now()): void {
    const cutoff = now - OWNED_TOOL_OPERATION_TTL_MS;
    for (const operation of this.ownedOperations.values()) {
      if (operation.state !== "running" && operation.state !== "expired" && operation.updatedAt < cutoff) {
        operation.state = "expired";
        operation.result = undefined;
        operation.error = "Owned Codex tool result payload expired before acknowledgement";
        operation.retainedBytes = 0;
        this.onChange(operation.token);
      }
    }
  }

  hasUnacknowledgedOwnedOperation(token: string): boolean {
    return [...this.ownedOperations.values()].some(operation => operation.token === token);
  }

  ownedOperationCount(token: string, running: boolean): number {
    return [...this.ownedOperations.values()].filter(operation => (
      operation.token === token && (running ? operation.state === "running" : operation.state !== "running")
    )).length;
  }

  retire(token: string, reason: Error): void {
    for (const [operationId, operation] of this.ownedOperations) {
      if (operation.token !== token) continue;
      for (const waiter of operation.waiters) waiter.reject(reason);
      operation.waiters.clear();
      this.ownedOperations.delete(operationId);
    }
    for (const [operationId, operation] of this.acknowledgedOperations) {
      if (operation.token === token) this.acknowledgedOperations.delete(operationId);
    }
  }
}
