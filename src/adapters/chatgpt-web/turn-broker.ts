import { OwnedToolOperationStore } from "./turn-broker-owned-operations";
import { decodeBrokerRequest, opaqueId, assertSurfaceNonce, MAX_BROKER_LINE_CHARS, MAX_BROKER_REQUEST_ID_CHARS, BROKER_PROTOCOL_VERSION,
  type BrokerRequest, type BrokerResponse, type BrokerToolRequest, type BrokerToolResult,
  type BrokerOwnedOperationSnapshot, type BrokerOwnedOperationStartResult,
  type BrokerCompletionFenceStart, type TurnBrokerOwner,
} from "./turn-broker-protocol";
export type { BrokerToolRequest, BrokerToolResult, BrokerOwnedOperationSnapshot, BrokerOwnedOperationStartResult,
  BrokerOwnedOperationStatus, BrokerCompletionFenceStart, TurnBrokerOwner } from "./turn-broker-protocol";
export { callTurnBroker, RemoteTurnBroker, TurnBrokerTimeoutError } from "./turn-broker-client";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isWindowsPipeEndpoint } from "../../config";
import {
  CompactionTransactionStore,
  type CompactionTransactionHandle,
} from "./compaction-transaction";
import type { ChatGptTurnEnvironment } from "./environment";

interface PendingTurn extends ChatGptTurnEnvironment {
  expiresAt?: number;
}

interface PendingInvocation {
  request: BrokerToolRequest;
  resolve: (result: BrokerToolResult) => void;
  reject: (error: Error) => void;
}

interface ToolWaiter {
  resolve: (requests: BrokerToolRequest[]) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export type SafeTurnState = "awaiting_start" | "running" | "completed" | "revoked";

interface SafeWaiter<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface SafeTurnControl {
  state: SafeTurnState;
  surfaceNonce: string;
  launcherSent: boolean;
  connectorStarted: boolean;
  finalAnswer?: string;
  sentWaiters: Set<SafeWaiter<void>>;
  startWaiters: Set<SafeWaiter<void>>;
  completionWaiters: Set<SafeWaiter<string>>;
}

interface TurnChannel {
  traceId: string;
  externalOwner: boolean;
  environment: PendingTurn;
  bindingId?: string;
  queuedCallIds: string[];
  deliveredCallIds: Set<string>;
  /** Dispatched calls whose observation was cancelled; late owner completions are accepted and ignored. */
  detachedInvocationCallIds: Set<string>;
  invocations: Map<string, PendingInvocation>;
  waiters: Set<ToolWaiter>;
  compactionRequested: boolean;
  compactionResult?: BrokerToolResult;
  compactionDeliveryCount: number;
  safe?: SafeTurnControl;
  /** Every MCP request owns a lease from token claim until its handler has settled. */
  activities: Set<string>;
  /** Prevents a lost/retried or delayed claim from resurrecting activity after cleanup. */
  completedActivities: Set<string>;
  /** Monotonic across activity start/end so a completed request cannot disappear across a fence. */
  activityRevision: number;
  completionCommitted: boolean;
  completionRevision?: number;
  retirementWaiters: Set<SafeWaiter<void>>;
  batchTimer?: ReturnType<typeof setTimeout>;
}

const brokers = new Map<string, TurnBroker>();
const MAX_RETIRED_TURN_HANDLES = 64;
// These bounds cover live work, which cannot be reclaimed until its MCP handler or native
// invocation settles. Overflow retires the capability so outstanding work fails explicitly.
const MAX_ACTIVE_ACTIVITIES_PER_TURN = 64;
const MAX_PENDING_INVOCATIONS_PER_TURN = 64;
// A live turn cannot discard completed IDs: an ambiguously delivered claim could arrive later
// and reopen activity past the completion fence. Retire the entire capability at this limit.
const MAX_COMPLETED_ACTIVITIES_PER_TURN = 4_096;
export async function closeTurnBrokers(): Promise<void> {
  const active = [...brokers.values()];
  const results = await Promise.allSettled(active.map(broker => broker.close()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} ChatGPT turn broker(s) failed to close`);
  }
}

function handleFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function retiredTurnLabel(traceId: string): string {
  return traceId && traceId !== "unknown" ? `Codex turn ${traceId}` : "a Codex turn";
}

function environmentIdentity(environment: ChatGptTurnEnvironment): string {
  return JSON.stringify({
    cwd: environment.cwd,
    roots: environment.roots,
    writableRoots: environment.writableRoots,
    sandboxPolicy: environment.sandboxPolicy,
    producer: environment.producer ?? "codex",
  });
}

function ownerEnvironment(value: unknown): ChatGptTurnEnvironment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("turn owner environment is invalid");
  const environment = value as Partial<ChatGptTurnEnvironment>;
  const paths = (candidate: unknown): candidate is string[] => Array.isArray(candidate)
    && candidate.length > 0
    && candidate.every(path => typeof path === "string" && isAbsolute(path));
  if (typeof environment.cwd !== "string" || !isAbsolute(environment.cwd)
    || !paths(environment.roots) || !Array.isArray(environment.writableRoots)
    || environment.writableRoots.some(path => typeof path !== "string" || !isAbsolute(path))
    || !environment.roots.some(root => {
      const nested = relative(resolve(root), resolve(environment.cwd!));
      return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
    })
    || !environment.sandboxPolicy || !["dangerFullAccess", "workspaceWrite", "readOnly"].includes(environment.sandboxPolicy.type)
    || (environment.producer !== undefined && environment.producer !== "codex" && environment.producer !== "hermes")
    || !Array.isArray(environment.tools)
    || environment.tools.some(tool => !tool || typeof tool.name !== "string" || typeof tool.description !== "string"
      || !tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters))) {
    throw new Error("turn owner environment is invalid");
  }
  return structuredClone(environment as ChatGptTurnEnvironment);
}

/**
 * Bytes available for a Unix socket path. Linux allows 108, macOS and the BSDs expose a 104-byte
 * sun_path including its terminating NUL; the smaller usable bound is used everywhere so a path
 * that works on one developer's machine is not silently unbindable on another's.
 */
const MAX_UNIX_SOCKET_PATH_BYTES = 103;

export class TurnBroker implements TurnBrokerOwner {
  static forSocket(path: string): TurnBroker {
    let broker = brokers.get(path);
    if (!broker) {
      broker = new TurnBroker(path);
      brokers.set(path, broker);
    }
    return broker;
  }

  private readonly channels = new Map<string, TurnChannel>();
  private readonly pending = new Map<string, TurnChannel>();
  private readonly compactionTransactions = new CompactionTransactionStore();
  private readonly operations = new OwnedToolOperationStore(token => {
    const channel = this.channels.get(token);
    if (channel) channel.activityRevision += 1;
  });
  private readonly bindings = new Map<string, { token: string; channel: TurnChannel }>();
  // The Codex context replayed into ChatGPT still carries the handles of finished turns, so a model
  // can present one. Remembering which turn retired a handle is what separates "you are holding a
  // previous turn's handle" from "this handle never existed".
  private readonly retiredBindings = new Map<string, string>();
  private readonly retiredTokens = new Map<string, string>();
  private acceptingExternalOwners = true;
  private server?: Server;
  private startPromise?: Promise<void>;
  private startAttempt?: symbol;
  private socketIdentity?: { dev: number; ino: number };

  private constructor(readonly socketPath: string) {}

  /**
   * A ChatGPT turn outlives the request that started it, and its Codex Native calls arrive from a
   * separate MCP process. Creating the socket only once a turn registers leaves that process
   * connecting to a path that does not exist yet, so an in-flight turn reports a filesystem error
   * instead of the broker's own answer. The endpoint belongs to the runtime's lifetime.
   */
  async listen(): Promise<void> {
    await this.start();
  }

  async register(
    environment: ChatGptTurnEnvironment,
    ttlMs?: number,
    traceId = "unknown",
    externalOwner = false,
    handlePrefix = "turn",
  ): Promise<string> {
    await this.start();
    this.prune();
    if (externalOwner && !this.acceptingExternalOwners) {
      throw new Error("turn broker is draining and does not accept new external owners");
    }
    if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
      throw new Error("ChatGPT web turn broker TTL must be a positive finite number");
    }
    const token = opaqueId(handlePrefix);
    const channel: TurnChannel = {
      traceId,
      externalOwner,
      environment: {
        ...environment,
        ...(ttlMs !== undefined ? { expiresAt: Date.now() + ttlMs } : {}),
      },
      queuedCallIds: [],
      deliveredCallIds: new Set(),
      detachedInvocationCallIds: new Set(),
      invocations: new Map(),
      waiters: new Set(),
      compactionRequested: false,
      compactionDeliveryCount: 0,
      activities: new Set(),
      completedActivities: new Set(),
      activityRevision: 0,
      completionCommitted: false,
      retirementWaiters: new Set(),
    };
    this.channels.set(token, channel);
    this.pending.set(token, channel);
    console.info(`[chatgpt-web] broker trace=${traceId} registered tokenHash=${handleFingerprint(token)}`);
    return token;
  }

  async registerSafe(
    environment: ChatGptTurnEnvironment,
    surfaceNonce: string,
    ttlMs?: number,
    traceId = "unknown",
    externalOwner = false,
  ): Promise<string> {
    assertSurfaceNonce(surfaceNonce);
    const token = await this.register(environment, ttlMs, traceId, externalOwner, "request");
    const channel = this.channels.get(token);
    if (!channel) throw new Error("Manual mode turn registration was revoked before initialization");
    channel.safe = {
      state: "awaiting_start",
      surfaceNonce,
      launcherSent: false,
      connectorStarted: false,
      sentWaiters: new Set(),
      startWaiters: new Set(),
      completionWaiters: new Set(),
    };
    return token;
  }

  async beginCompactionTransaction(
    traceId: string,
    ttlMs = 120_000,
  ): Promise<CompactionTransactionHandle> {
    await this.start();
    return this.compactionTransactions.begin(traceId, ttlMs);
  }

  waitForCompactionHandoff(token: string, signal?: AbortSignal): Promise<string> {
    return this.compactionTransactions.wait(token, signal);
  }

  abortCompactionTransaction(token: string): void {
    this.compactionTransactions.abort(token);
  }

  revokeCompactionTransactions(traceId: string): void {
    this.compactionTransactions.abortTrace(traceId);
  }

  updateEnvironment(token: string, environment: ChatGptTurnEnvironment): void {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (environmentIdentity(channel.environment) !== environmentIdentity(environment)) {
      throw new Error("Codex turn environment changed during an active ChatGPT tool loop");
    }
    if (channel.safe?.state === "revoked") throw new Error("Manual mode turn is already terminal");
    // A no-tool Manual mode answer can complete before its outer Responses observer reaches this owner
    // readback. The environment is already proven identical, so completion makes this a no-op.
    if (channel.safe?.state === "completed") return;
    channel.environment = {
      ...environment,
      ...(channel.environment.expiresAt !== undefined
        ? { expiresAt: channel.environment.expiresAt }
        : {}),
    };
  }

  async nextToolBatch(token: string, signal?: AbortSignal): Promise<BrokerToolRequest[]> {
    this.prune();
    let channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (channel.safe?.state === "awaiting_start") {
      // The outer Codex adapter owns this wait. It crosses the start boundary only after the user
      // confirms in the Launcher that the copied prompt was sent in the visible ChatGPT tab.
      await this.waitForSafeStart(token, signal);
      this.prune();
      channel = this.channels.get(token);
      if (!channel) throw new Error("turn token is invalid or expired");
    }
    // This owner-only empty batch tells the adapter to consume the already accepted completion.
    // Public Manual mode MCP calls remain fail-closed after the turn reaches its terminal state.
    if (channel.safe?.state === "completed") return [];
    this.assertSafeHarnessRunning(channel);
    if (channel.compactionRequested) {
      throw new Error("Codex context compaction superseded ordinary MCP tool delivery");
    }
    // Delivery is at-least-once until Codex returns the corresponding tool result. If the HTTP
    // observer disconnects after the broker handed off a batch but before the adapter journaled
    // it, the exact reconnect receives the same call ids instead of losing the model's invocation.
    const delivered = [...channel.deliveredCallIds]
      .map(id => channel.invocations.get(id)?.request)
      .filter((request): request is BrokerToolRequest => Boolean(request));
    if (delivered.length > 0) return delivered;
    const ready = this.takeQueued(channel);
    if (ready.length > 0) return ready;
    if (signal?.aborted) throw new DOMException("tool wait aborted", "AbortError");
    return new Promise<BrokerToolRequest[]>((resolveWait, rejectWait) => {
      const waiter: ToolWaiter = { resolve: resolveWait, reject: rejectWait, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          channel.waiters.delete(waiter);
          rejectWait(new DOMException("tool wait aborted", "AbortError"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      channel.waiters.add(waiter);
    });
  }

  completeTool(token: string, callId: string, result: BrokerToolResult): void {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    this.assertSafeHarnessRunning(channel, true);
    const invocation = channel.invocations.get(callId);
    if (!invocation) {
      if (channel.detachedInvocationCallIds.has(callId)) {
        console.info(
          `[chatgpt-web] broker trace=${channel.traceId} ignored late completion for observation-cancelled call=${callId.slice(0, 17)}`,
        );
        return;
      }
      throw new Error(`tool call is not pending: ${callId}`);
    }
    if (!channel.deliveredCallIds.delete(callId)) {
      throw new Error(`tool call was completed before it was delivered: ${callId}`);
    }
    channel.invocations.delete(callId);
    console.info(`[chatgpt-web] broker trace=${channel.traceId} completed call=${callId.slice(0, 17)} pending=${channel.invocations.size}`);
    invocation.resolve(result);
  }

  beginCompletionFence(token: string): BrokerCompletionFenceStart {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (channel.completionCommitted) return { revision: channel.completionRevision! };
    const runningWithoutInvocation = this.operations.runningWithoutInvocation(token, callId => channel.invocations.has(callId));
    const activeCount = channel.activities.size + channel.invocations.size + runningWithoutInvocation;
    if (activeCount > 0) return { blockedReason: "active_work", blockedCount: activeCount };
    const unacknowledged = this.operations.ownedOperationCount(token, false);
    if (unacknowledged > 0) {
      return { blockedReason: "unacknowledged_async_result", blockedCount: unacknowledged };
    }
    return { revision: channel.activityRevision };
  }

  commitCompletionFence(token: string, revision: number): boolean {
    this.prune();
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("turn completion fence revision is invalid");
    }
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (channel.completionCommitted) return channel.completionRevision === revision;
    if (channel.activityRevision !== revision
      || channel.activities.size > 0
      || channel.invocations.size > 0
      || this.operations.hasUnacknowledgedOwnedOperation(token)) return false;
    channel.completionCommitted = true;
    channel.completionRevision = revision;
    console.info(
      `[chatgpt-web] broker trace=${channel.traceId} committed browser completion revision=${revision}`,
    );
    return true;
  }

  waitForRetirement(token: string, signal?: AbortSignal): Promise<void> {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) return Promise.resolve();
    return this.waitForSafeState(channel.retirementWaiters, signal, "turn retirement wait aborted");
  }

  requestCompaction(token: string, queuedResult: BrokerToolResult): number {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    this.assertSafeHarnessRunning(channel);
    if (channel.compactionRequested) {
      throw new Error("Codex context compaction was already requested for this turn");
    }
    channel.compactionRequested = true;
    channel.compactionResult = structuredClone(queuedResult);
    if (channel.batchTimer) {
      clearTimeout(channel.batchTimer);
      channel.batchTimer = undefined;
    }
    const queued = channel.queuedCallIds.splice(0);
    for (const callId of queued) {
      const invocation = channel.invocations.get(callId);
      if (!invocation) continue;
      channel.invocations.delete(callId);
      channel.compactionDeliveryCount += 1;
      invocation.resolve(structuredClone(queuedResult));
    }
    if (queued.length > 0) {
      console.info(
        `[chatgpt-web] broker trace=${channel.traceId} interrupted queued calls=${queued.length} for context compaction`,
      );
    }
    return queued.length;
  }

  compactionDeliveryCount(token: string): number {
    const channel = this.channels.get(token);
    if (!channel) throw new Error("Cannot read compaction delivery after the turn capability retired");
    return channel.compactionDeliveryCount;
  }

  startSafeTurn(requestId: string): { started: true; duplicate: boolean } {
    this.prune();
    const channel = this.channels.get(requestId);
    if (!channel) throw new Error("Manual mode request_id is invalid, expired, or revoked");
    const safe = channel.safe;
    if (!safe) throw new Error("request_id is not registered for Manual mode browser interaction");
    if (safe.state === "completed" || safe.state === "revoked") {
      throw new Error("Manual mode turn is already terminal");
    }
    if (safe.connectorStarted) return { started: true, duplicate: true };
    safe.connectorStarted = true;
    this.activateSafeTurn(channel, safe);
    return { started: true, duplicate: false };
  }

  confirmSafeTurnSent(requestId: string, surfaceNonce: string): { confirmed: true; duplicate: boolean } {
    this.prune();
    assertSurfaceNonce(surfaceNonce);
    const channel = this.channels.get(requestId);
    if (!channel) throw new Error("Manual mode request_id is invalid, expired, or revoked");
    const safe = channel.safe;
    if (!safe) throw new Error("request_id is not registered for Manual mode browser interaction");
    this.assertSafeNonce(safe, surfaceNonce);
    if (safe.state === "completed" || safe.state === "revoked") {
      throw new Error("Manual mode turn is already terminal");
    }
    if (safe.launcherSent) return { confirmed: true, duplicate: true };
    safe.launcherSent = true;
    this.resolveSafeWaiters(safe.sentWaiters, undefined);
    this.activateSafeTurn(channel, safe);
    return { confirmed: true, duplicate: false };
  }

  completeSafeTurn(
    requestId: string,
    finalAnswer: string,
  ): { completed: true; duplicate: boolean } {
    this.prune();
    if (typeof finalAnswer !== "string" || finalAnswer.trim().length === 0) {
      throw new Error("Manual mode turn final_answer must not be empty");
    }
    const channel = this.channels.get(requestId);
    if (!channel) throw new Error("Manual mode request_id is invalid, expired, or revoked");
    const safe = channel.safe;
    if (!safe) throw new Error("request_id is not registered for Manual mode browser interaction");
    if (safe.state === "completed") {
      if (safe.finalAnswer !== finalAnswer) {
        throw new Error("Manual mode turn completion conflicts with the accepted final_answer");
      }
      return { completed: true, duplicate: true };
    }
    if (safe.state === "revoked") throw new Error("Manual mode turn is already terminal");
    if (safe.state !== "running") throw new Error("Manual mode turn has not started");
    if (channel.invocations.size > 0) {
      throw new Error(`Manual mode turn cannot complete with ${channel.invocations.size} pending Codex tool invocation(s)`);
    }
    if (channel.activities.size > 0) {
      throw new Error(`Manual mode turn cannot complete with ${channel.activities.size} active Codex MCP request(s)`);
    }
    safe.state = "completed";
    safe.finalAnswer = finalAnswer;
    this.resolveSafeWaiters(safe.completionWaiters, finalAnswer);
    return { completed: true, duplicate: false };
  }

  waitForSafeStart(requestId: string, signal?: AbortSignal): Promise<void> {
    this.prune();
    const channel = this.channels.get(requestId);
    if (!channel) return Promise.reject(new Error("Manual mode request_id is invalid, expired, or revoked"));
    const safe = channel.safe;
    if (!safe) return Promise.reject(new Error("request_id is not registered for Manual mode browser interaction"));
    if (safe.state === "running" || safe.state === "completed") return Promise.resolve();
    if (safe.state === "revoked") return Promise.reject(new Error("Manual mode turn was revoked"));
    return this.waitForSafeState(safe.startWaiters, signal, "Manual mode turn start wait aborted");
  }

  private waitForSafeSent(requestId: string, signal?: AbortSignal): Promise<void> {
    this.prune();
    const channel = this.channels.get(requestId);
    if (!channel) return Promise.reject(new Error("Manual mode request_id is invalid, expired, or revoked"));
    const safe = channel.safe;
    if (!safe) return Promise.reject(new Error("request_id is not registered for Manual mode browser interaction"));
    if (safe.launcherSent) return Promise.resolve();
    if (safe.state === "revoked") return Promise.reject(new Error("Manual mode turn was revoked"));
    return this.waitForSafeState(safe.sentWaiters, signal, "Manual mode turn Sent wait aborted");
  }

  waitForSafeCompletion(requestId: string, signal?: AbortSignal): Promise<string> {
    this.prune();
    const channel = this.channels.get(requestId);
    if (!channel) return Promise.reject(new Error("Manual mode request_id is invalid, expired, or revoked"));
    const safe = channel.safe;
    if (!safe) return Promise.reject(new Error("request_id is not registered for Manual mode browser interaction"));
    if (safe.state === "completed" && safe.finalAnswer !== undefined) return Promise.resolve(safe.finalAnswer);
    if (safe.state === "revoked") return Promise.reject(new Error("Manual mode turn was revoked"));
    return this.waitForSafeState(safe.completionWaiters, signal, "Manual mode turn completion wait aborted");
  }

  revoke(token: string, reason = new Error("Codex turn binding was revoked")): void {
    const channel = this.channels.get(token);
    if (!channel) return;
    this.channels.delete(token);
    this.pending.delete(token);
    if (channel.bindingId) {
      this.bindings.delete(channel.bindingId);
      this.retire(this.retiredBindings, channel.bindingId, channel.traceId);
    }
    if (channel.safe) {
      channel.safe.state = "revoked";
      this.rejectSafeWaiters(channel.safe.sentWaiters, reason);
      this.rejectSafeWaiters(channel.safe.startWaiters, reason);
      this.rejectSafeWaiters(channel.safe.completionWaiters, reason);
    }
    this.retire(this.retiredTokens, token, channel.traceId);
    this.resolveSafeWaiters(channel.retirementWaiters, undefined);
    this.rejectChannel(channel, reason);
    this.operations.retire(token, reason);
  }

  externalOwnerActiveCount(): number {
    this.prune();
    return [...this.channels.values()].filter(channel => channel.externalOwner).length;
  }

  revokeExternalOwners(): number {
    const tokens = [...this.channels]
      .filter(([, channel]) => channel.externalOwner)
      .map(([token]) => token);
    for (const token of tokens) this.revoke(token);
    return tokens.length;
  }

  revokeTrace(traceId: string, reason = new Error("Codex turn binding was revoked")): number {
    const tokens = [...this.channels]
      .filter(([, channel]) => channel.traceId === traceId)
      .map(([token]) => token);
    for (const token of tokens) this.revoke(token, reason);
    return tokens.length;
  }

  setExternalOwnersAccepted(accepted: boolean): void {
    this.acceptingExternalOwners = accepted;
  }

  private retire(history: Map<string, string>, handle: string, traceId: string): void {
    history.delete(handle);
    history.set(handle, traceId);
    while (history.size > MAX_RETIRED_TURN_HANDLES) {
      const oldest = history.keys().next();
      if (oldest.done) return;
      history.delete(oldest.value);
    }
  }

  private assertSafeNonce(safe: SafeTurnControl, surfaceNonce: string): void {
    if (safe.surfaceNonce !== surfaceNonce) throw new Error("Manual mode local browser binding does not match this turn");
  }

  private activateSafeTurn(channel: TurnChannel, safe: SafeTurnControl): void {
    if (safe.state !== "awaiting_start" || !safe.launcherSent || !safe.connectorStarted) return;
    safe.state = "running";
    // The setup window may be bounded, but a turn authorized by the user and bound by the
    // Manual mode connector remains live until completion, cancellation, or runtime shutdown.
    delete channel.environment.expiresAt;
    this.resolveSafeWaiters(safe.startWaiters, undefined);
  }

  private assertSafeHarnessRunning(channel: TurnChannel, allowCompaction = false): void {
    const safe = channel.safe;
    if (!safe) return;
    if (safe.state === "awaiting_start") {
      if (!safe.launcherSent) throw new Error("Manual mode turn is waiting for the user's Sent confirmation");
      throw new Error("Manual mode request is not connected yet. Call codex_turn_start with its request_id first");
    }
    if (safe.state !== "running") throw new Error("Manual mode turn is already terminal");
    if (channel.compactionRequested && !allowCompaction) {
      throw new Error("Manual mode turn is awaiting completion for Codex context compaction");
    }
  }

  private waitForSafeState<T>(
    waiters: Set<SafeWaiter<T>>,
    signal: AbortSignal | undefined,
    abortMessage: string,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException(abortMessage, "AbortError"));
    return new Promise<T>((resolveWait, rejectWait) => {
      const waiter: SafeWaiter<T> = { resolve: resolveWait, reject: rejectWait, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          waiters.delete(waiter);
          rejectWait(new DOMException(abortMessage, "AbortError"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      waiters.add(waiter);
    });
  }

  private resolveSafeWaiters<T>(waiters: Set<SafeWaiter<T>>, value: T): void {
    for (const waiter of waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(value);
    }
    waiters.clear();
  }

  private rejectSafeWaiters<T>(waiters: Set<SafeWaiter<T>>, error: Error): void {
    for (const waiter of waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(error);
    }
    waiters.clear();
  }

  async close(): Promise<void> {
    this.compactionTransactions.close();
    this.operations.close();
    for (const token of [...this.channels.keys()]) this.revoke(token);
    const server = this.server;
    this.server = undefined;
    this.startAttempt = undefined;
    this.startPromise = undefined;
    if (brokers.get(this.socketPath) === this) brokers.delete(this.socketPath);
    if (server?.listening) {
      await new Promise<void>((resolveClose, rejectClose) => server.close(error => {
        if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") resolveClose();
        else rejectClose(error);
      }));
    }
    const socketIdentity = this.socketIdentity;
    this.socketIdentity = undefined;
    if (!isWindowsPipeEndpoint(this.socketPath) && socketIdentity && existsSync(this.socketPath)) {
      const current = lstatSync(this.socketPath);
      if (current.isSocket()
        && current.dev === socketIdentity.dev
        && current.ino === socketIdentity.ino) {
        unlinkSync(this.socketPath);
      }
    }
  }

  private start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    const attempt = Symbol("turn-broker-start");
    this.startAttempt = attempt;
    let startupServer: Server | undefined;
    let startupOwnsSocket = false;
    let startupSocketIdentity: { dev: number; ino: number } | undefined;
    const startup = new Promise<void>((resolveStart, rejectStart) => {
      const windowsPipe = isWindowsPipeEndpoint(this.socketPath);
      if (!windowsPipe) {
        // sun_path is a fixed-size field in the kernel, so an over-long path fails inside listen()
        // with nothing but "Failed to listen" and no hint that the length is the problem. Say so.
        const encodedLength = Buffer.byteLength(this.socketPath);
        if (encodedLength > MAX_UNIX_SOCKET_PATH_BYTES) {
          rejectStart(new Error(
            `ChatGPT web broker socket path is ${encodedLength} bytes, over the`
            + ` ${MAX_UNIX_SOCKET_PATH_BYTES}-byte limit this platform allows for a Unix socket:`
            + ` ${this.socketPath}. Choose a shorter runtime directory.`,
          ));
          return;
        }
        mkdirSync(dirname(this.socketPath), { recursive: true, mode: 0o700 });
      }
      const listen = () => {
        const server = createServer(socket => this.handleSocket(socket));
        startupServer = server;
        this.server = server;
        server.once("error", rejectStart);
        server.on("error", error => {
          console.error(
            `[chatgpt-web] turn broker server error at ${this.socketPath}: ${errorOf(error).message}`,
          );
        });
        server.listen(this.socketPath, () => {
          try {
            server.off("error", rejectStart);
            startupOwnsSocket = !windowsPipe;
            if (!windowsPipe) {
              const socketStat = lstatSync(this.socketPath);
              startupSocketIdentity = { dev: socketStat.dev, ino: socketStat.ino };
              if (this.startAttempt === attempt) this.socketIdentity = startupSocketIdentity;
              chmodSync(this.socketPath, 0o600);
            }
            resolveStart();
          } catch (error) {
            rejectStart(errorOf(error));
          }
        });
      };

      if (windowsPipe) {
        listen();
        return;
      }
      if (!existsSync(this.socketPath)) {
        listen();
        return;
      }
      if (!lstatSync(this.socketPath).isSocket()) {
        rejectStart(new Error(`ChatGPT web broker path exists and is not a socket: ${this.socketPath}`));
        return;
      }
      const socketStat = lstatSync(this.socketPath);
      const getuid = process.getuid;
      if (typeof getuid === "function" && socketStat.uid !== getuid()) {
        rejectStart(new Error(`ChatGPT web broker socket is not owned by the current user: ${this.socketPath}`));
        return;
      }
      if ((socketStat.mode & 0o077) !== 0) {
        rejectStart(new Error(`ChatGPT web broker socket has unsafe permissions: ${this.socketPath}`));
        return;
      }
      const probe = createConnection(this.socketPath);
      let probeSettled = false;
      const finishProbe = (action: () => void) => {
        if (probeSettled) return;
        probeSettled = true;
        probe.destroy();
        action();
      };
      probe.setTimeout(2_000, () => finishProbe(() => {
        rejectStart(new Error(`Timed out while checking existing ChatGPT web broker socket: ${this.socketPath}`));
      }));
      probe.once("connect", () => {
        finishProbe(() => {
          rejectStart(new Error(`ChatGPT web broker socket is already owned by another process: ${this.socketPath}`));
        });
      });
      probe.once("error", error => {
        finishProbe(() => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ECONNREFUSED" && code !== "ENOENT") {
            rejectStart(new Error(
              `Could not verify existing ChatGPT web broker socket ${this.socketPath}: ${error.message}`,
            ));
            return;
          }
          try {
            if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
            listen();
          } catch (cleanupError) {
            rejectStart(errorOf(cleanupError));
          }
        });
      });
    });
    this.startPromise = startup.catch(async error => {
      if (this.server === startupServer) this.server = undefined;
      const server = startupServer;
      if (server) {
        await new Promise<void>(resolveClose => {
          server.close(closeError => {
            if (closeError && (closeError as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
              console.error(`[chatgpt-web] failed to close broker after startup failure at ${this.socketPath}: ${errorOf(closeError).message}`);
            }
            resolveClose();
          });
        });
      }
      try {
        if (startupOwnsSocket && startupSocketIdentity && !isWindowsPipeEndpoint(this.socketPath)
          && existsSync(this.socketPath)) {
          const socketStat = lstatSync(this.socketPath);
          if (socketStat.isSocket()
            && socketStat.dev === startupSocketIdentity.dev
            && socketStat.ino === startupSocketIdentity.ino) {
            unlinkSync(this.socketPath);
          }
        }
      } catch (cleanupError) {
        console.error(`[chatgpt-web] failed to remove broker socket after startup failure at ${this.socketPath}: ${errorOf(cleanupError).message}`);
      }
      if (this.startAttempt === attempt) {
        this.startAttempt = undefined;
        this.socketIdentity = undefined;
        if (brokers.get(this.socketPath) === this) brokers.delete(this.socketPath);
        this.startPromise = undefined;
      }
      throw error;
    });
    return this.startPromise;
  }

  private handleSocket(socket: Socket): void {
    let buffered = "";
    let handled = false;
    const disconnected = new AbortController();
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.once("close", () => disconnected.abort());
    socket.on("data", chunk => {
      if (handled) return;
      buffered += chunk;
      if (buffered.length > MAX_BROKER_LINE_CHARS && !buffered.slice(0, MAX_BROKER_LINE_CHARS + 1).includes("\n")) {
        handled = true;
        this.writeSocketResponse(socket, { id: "unknown", error: "turn broker request exceeds size limit" });
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const line = buffered.slice(0, newline);
      let request: BrokerRequest | undefined;
      let responseId = "unknown";
      try {
        if (line.length > MAX_BROKER_LINE_CHARS) throw new Error("turn broker request exceeds size limit");
        const decoded: unknown = JSON.parse(line);
        // Preserve a valid request identity even when its method/payload is rejected.
        if (decoded && typeof decoded === "object" && "id" in decoded
          && typeof decoded.id === "string" && decoded.id.length > 0
          && decoded.id.length <= MAX_BROKER_REQUEST_ID_CHARS) responseId = decoded.id;
        request = decodeBrokerRequest(decoded);
      } catch (error) {
        this.writeSocketResponse(socket, { id: responseId, error: errorOf(error).message });
        return;
      }
      void Promise.resolve().then(() => this.dispatch(request!, disconnected.signal)).then(
        result => this.writeSocketResponse(socket, { id: request!.id, result }),
        error => this.writeSocketResponse(socket, { id: request!.id, error: errorOf(error).message }),
      );
    });
  }

  private writeSocketResponse(socket: Socket, response: BrokerResponse): void {
    const line = `${JSON.stringify(response)}\n`;
    if (line.length > MAX_BROKER_LINE_CHARS) {
      socket.end(`${JSON.stringify({ id: response.id, error: "turn broker response exceeds size limit" } satisfies BrokerResponse)}\n`);
      return;
    }
    socket.end(line);
  }

  private async dispatch(request: BrokerRequest, socketSignal?: AbortSignal): Promise<unknown> {
    this.prune();
    if (request.method === "safe_start") {
      if (!request.token) throw new Error("Manual mode request_id is required");
      return this.startSafeTurn(request.token);
    }
    if (request.method === "safe_complete") {
      if (!request.token) throw new Error("Manual mode request_id is required");
      if (typeof request.finalAnswer !== "string") throw new Error("Manual mode turn final_answer is required");
      let channel = this.channels.get(request.token);
      if (channel?.safe?.state === "awaiting_start" && !channel.safe.launcherSent) {
        await this.waitForSafeSent(request.token, socketSignal);
        this.prune();
        channel = this.channels.get(request.token);
      }
      return this.completeSafeTurn(request.token, request.finalAnswer);
    }
    if (request.method === "submit_compaction_handoff") {
      if (typeof request.token !== "string" || request.token.length === 0) {
        throw new Error("compaction control token is required");
      }
      if (typeof request.handoffId !== "string" || request.handoffId.length === 0) {
        throw new Error("compaction handoff id is required");
      }
      if (typeof request.summary !== "string") {
        throw new Error("compaction handoff summary is required");
      }
      this.compactionTransactions.submit(request.token, request.handoffId, request.summary);
      return { submitted: true };
    }
    if (request.method === "owner_status") {
      return { protocolVersion: BROKER_PROTOCOL_VERSION, acceptingExternalOwners: this.acceptingExternalOwners };
    }
    if (request.method === "owner_register") {
      const environment = ownerEnvironment(request.environment);
      if (request.traceId !== undefined && !/^[A-Za-z0-9_-]{6,128}$/.test(request.traceId)) {
        throw new Error("turn owner trace id is invalid");
      }
      return this.register(environment, request.ttlMs, request.traceId, true).then(token => ({ token }));
    }
    if (request.method === "owner_register_safe") {
      const environment = ownerEnvironment(request.environment);
      assertSurfaceNonce(request.surfaceNonce);
      if (request.traceId !== undefined && !/^[A-Za-z0-9_-]{6,128}$/.test(request.traceId)) {
        throw new Error("turn owner trace id is invalid");
      }
      return this.registerSafe(
        environment,
        request.surfaceNonce,
        request.ttlMs,
        request.traceId,
        true,
      ).then(token => ({ token }));
    }
    if (request.method === "owner_update") {
      if (!request.token) throw new Error("turn owner token is required");
      this.updateEnvironment(request.token, ownerEnvironment(request.environment));
      return { updated: true };
    }
    if (request.method === "owner_safe_sent") {
      if (!request.token) throw new Error("turn owner token is required");
      assertSurfaceNonce(request.surfaceNonce);
      return this.confirmSafeTurnSent(request.token, request.surfaceNonce);
    }
    if (request.method === "owner_next") {
      if (!request.token) throw new Error("turn owner token is required");
      return this.nextToolBatch(request.token, socketSignal).then(requests => ({ requests }));
    }
    if (request.method === "owner_complete") {
      if (!request.token) throw new Error("turn owner token is required");
      if (!request.callId) throw new Error("turn owner call id is required");
      if (!request.toolResult || !Array.isArray(request.toolResult.content)) {
        throw new Error("turn owner tool result is invalid");
      }
      this.completeTool(request.token, request.callId, request.toolResult);
      return { completed: true };
    }
    if (request.method === "owner_completion_fence_begin") {
      if (!request.token) throw new Error("turn owner token is required");
      const fence = this.beginCompletionFence(request.token);
      return "revision" in fence
        ? { revision: fence.revision }
        : { revision: null, blockedReason: fence.blockedReason, blockedCount: fence.blockedCount };
    }
    if (request.method === "owner_completion_fence_commit") {
      if (!request.token) throw new Error("turn owner token is required");
      if (!Number.isSafeInteger(request.revision) || request.revision! < 0) {
        throw new Error("turn completion fence revision is invalid");
      }
      return { committed: this.commitCompletionFence(request.token, request.revision!) };
    }
    if (request.method === "owner_wait_retirement") {
      if (!request.token) throw new Error("turn owner token is required");
      return this.waitForRetirement(request.token, socketSignal).then(() => ({ retired: true }));
    }
    if (request.method === "owner_revoke") {
      if (!request.token) throw new Error("turn owner token is required");
      this.revoke(request.token);
      return { revoked: true };
    }
    if (request.method === "owner_safe_wait_start") {
      if (!request.token) throw new Error("turn owner token is required");
      return this.waitForSafeStart(request.token, socketSignal).then(() => ({ started: true }));
    }
    if (request.method === "owner_safe_wait_completion") {
      if (!request.token) throw new Error("turn owner token is required");
      return this.waitForSafeCompletion(request.token, socketSignal).then(finalAnswer => ({ finalAnswer }));
    }
    if (request.method === "owner_request_compaction") {
      if (!request.token) throw new Error("turn owner token is required");
      if (!request.toolResult || !Array.isArray(request.toolResult.content)) {
        throw new Error("turn owner compaction result is invalid");
      }
      return { interrupted: this.requestCompaction(request.token, request.toolResult) };
    }
    if (request.method === "owner_compaction_delivery_count") {
      if (!request.token) throw new Error("turn owner token is required");
      return { count: this.compactionDeliveryCount(request.token) };
    }
    if (request.method === "claim") {
      const contract = request.contract ?? "native";
      const token = request.token;
      if (typeof token !== "string" || token.length === 0) {
        throw new Error(contract === "safe" ? "request id is required" : "turn token is required");
      }
      const channel = this.channels.get(token);
      let activeChannel = channel && !channel.completionCommitted ? channel : undefined;
      const retiredTurn = channel?.completionCommitted ? channel.traceId : this.retiredTokens.get(token);
      console.error(
        `[chatgpt-web] broker claim received (tokenChars=${token.length}, tokenHash=${handleFingerprint(token)}, valid=${Boolean(activeChannel)}`
        + `${activeChannel ? "" : `, retiredTurn=${retiredTurn ?? "unknown"}`})`,
      );
      if (!activeChannel) {
        throw new Error(retiredTurn !== undefined
          ? `${contract === "safe" ? "This request_id" : "This turn_token"} was issued for ${retiredTurnLabel(retiredTurn)}, which has already finished.`
          + " This Codex Native action can no longer run."
          : `${contract === "safe" ? "request id" : "turn token"} is invalid, expired, or revoked`);
      }
      if (activeChannel.safe) {
        if (contract !== "safe") throw new Error("Manual mode request id requires the Manual mode MCP contract");
        if (activeChannel.safe.state === "awaiting_start" && !activeChannel.safe.launcherSent) {
          // ChatGPT can issue its first Harness call in the brief interval between the user sending
          // the copied prompt and confirming Sent in the Launcher. Hold that call behind the local
          // authorization boundary, but still require codex_turn_start before it can run.
          await this.waitForSafeSent(token, socketSignal);
          this.prune();
          activeChannel = this.channels.get(token);
          if (!activeChannel || activeChannel.completionCommitted) {
            throw new Error("turn token is invalid, expired, or revoked");
          }
        }
        this.assertSafeHarnessRunning(activeChannel);
      } else if (contract === "safe") {
        throw new Error("Manual mode MCP contract requires a Manual mode request id");
      }
      if (typeof request.activityId !== "string" || !/^activity_[A-Za-z0-9_-]{16,128}$/.test(request.activityId)) {
        throw new Error("turn activity id is invalid");
      }
      const activityId = request.activityId;
      if (activeChannel.completedActivities.has(activityId)) {
        throw new Error("turn activity was already completed before this claim settled");
      }
      if (!activeChannel.activities.has(activityId)) {
        if (activeChannel.activities.size >= MAX_ACTIVE_ACTIVITIES_PER_TURN) {
          const error = new Error(
            `Codex turn exceeded its ${MAX_ACTIVE_ACTIVITIES_PER_TURN} active MCP request limit; turn binding retired`,
          );
          this.revoke(token, error);
          throw error;
        }
        activeChannel.activities.add(activityId);
        activeChannel.activityRevision += 1;
      }
      if (activeChannel.bindingId) {
        const existing = this.bindings.get(activeChannel.bindingId);
        if (!existing || existing.token !== token || existing.channel !== activeChannel) {
          throw new Error("turn token binding state is inconsistent");
        }
        return { bindingId: activeChannel.bindingId, activityId, environment: activeChannel.environment };
      }
      this.pending.delete(token);
      const bindingId = opaqueId("binding");
      activeChannel.bindingId = bindingId;
      this.bindings.set(bindingId, { token, channel: activeChannel });
      return { bindingId, activityId, environment: activeChannel.environment };
    }

    if (request.method === "activity_complete") {
      const token = request.token;
      if (typeof token !== "string" || token.length === 0) throw new Error("turn token is required");
      if (typeof request.activityId !== "string" || !/^activity_[A-Za-z0-9_-]{16,128}$/.test(request.activityId)) {
        throw new Error("turn activity id is invalid");
      }
      const channel = this.channels.get(token);
      if (!channel) {
        return { completed: false, retired: this.retiredTokens.has(token) };
      }
      if (channel.completedActivities.has(request.activityId)) {
        return { completed: false, duplicate: true };
      }
      const wasActive = channel.activities.delete(request.activityId);
      channel.completedActivities.add(request.activityId);
      // A cleanup that overtakes an ambiguously delivered claim is still a causal event. Its
      // tombstone makes the delayed claim fail instead of resurrecting activity after a fence.
      channel.activityRevision += 1;
      if (channel.completedActivities.size >= MAX_COMPLETED_ACTIVITIES_PER_TURN) {
        console.error(
          `[chatgpt-web] broker trace=${channel.traceId} reached the completed activity limit; retiring turn capability`,
        );
        // Revoke before yielding to another dispatch. All delayed claims now fail on the retired
        // token, so dropping the channel also drops its tombstones without permitting replay.
        this.revoke(token, new Error("Codex turn reached its completed MCP activity limit"));
        return { completed: wasActive, retired: true };
      }
      return { completed: wasActive };
    }

    if (request.method === "operation_status") {
      const token = request.token;
      const channel = token ? this.channels.get(token) : undefined;
      if (!token || !channel || channel.completionCommitted || channel.safe) {
        throw new Error("native turn token is invalid, expired, or retired");
      }
      return this.operations.status(token);
    }

    if (request.method === "operation_poll") {
      if (!request.token) throw new Error("turn token is required");
      if (!request.operationId) throw new Error("owned operation id is required");
      return this.operations.poll(request.token, request.operationId, request.deliveryId, request.waitMs, socketSignal);
    }
    if (request.method === "operation_cancel") {
      if (!request.token) throw new Error("turn token is required");
      if (!request.operationId) throw new Error("owned operation id is required");
      return this.cancelOwnedOperation(request.token, request.operationId);
    }

    const bindingId = request.bindingId;
    if (typeof bindingId !== "string" || bindingId.length === 0) throw new Error("binding id is required");
    const binding = this.bindings.get(bindingId);
    if (!binding) {
      const retiredTurn = this.retiredBindings.get(bindingId);
      if (request.method === "release" && retiredTurn !== undefined) {
        return { released: true, duplicate: true };
      }
      console.error(
        `[chatgpt-web] broker rejected ${request.method} (binding=${bindingId.slice(0, 17)},`
        + ` retiredTurn=${retiredTurn ?? "unknown"})`,
      );
      throw new Error(retiredTurn !== undefined
        ? `${retiredTurnLabel(retiredTurn)} has already finished; this Codex Native action can no longer run.`
        : "internal Codex turn binding is invalid or expired");
    }
    if (request.method === "release") {
      this.revoke(binding.token);
      return { released: true };
    }
    if (request.method === "resolve") return { environment: binding.channel.environment };
    if (binding.channel.completionCommitted) {
      throw new Error(`${retiredTurnLabel(binding.channel.traceId)} has already finished; this Codex Native action can no longer run.`);
    }
    this.assertSafeHarnessRunning(binding.channel);
    if (binding.channel.compactionRequested && request.method !== "invoke_async") {
      const result = binding.channel.compactionResult;
      if (!result) throw new Error("Codex context compaction control result is unavailable");
      binding.channel.compactionDeliveryCount += 1;
      console.info(
        `[chatgpt-web] broker trace=${binding.channel.traceId} intercepted a post-compaction MCP call`,
      );
      return structuredClone(result);
    }

    const wireName = request.wireName?.trim();
    if (!wireName) throw new Error("wire tool name is required");
    if (request.method === "invoke_async") {
      this.operations.pruneOwnedOperations();
      if (!request.operationId || !/^operation_[A-Za-z0-9_-]{32,128}$/.test(request.operationId)) {
        throw new Error("owned Codex tool operation id is invalid");
      }
      const existing = this.operations.lookup(binding.token, request.operationId, {
        bindingId, wireName, freeform: request.freeform === true,
        input: request.input, arguments: request.arguments,
      });
      if (existing) return existing;
      // Retries must recover their original identity even after compaction starts.
      // A new request receives control instructions without claiming that its tool ran.
      if (binding.channel.compactionRequested) {
        const result = binding.channel.compactionResult;
        if (!result) throw new Error("Codex context compaction control result is unavailable");
        binding.channel.compactionDeliveryCount += 1;
        return { state: "control", result: structuredClone(result) } satisfies BrokerOwnedOperationStartResult;
      }
      this.operations.assertCapacity(binding.token);
    }
    if (binding.channel.invocations.size >= MAX_PENDING_INVOCATIONS_PER_TURN) {
      const error = new Error(
        `Codex turn exceeded its ${MAX_PENDING_INVOCATIONS_PER_TURN} pending native tool invocation limit; turn binding retired`,
      );
      this.revoke(binding.token, error);
      throw error;
    }
    const callId = opaqueId("call");
    const toolRequest: BrokerToolRequest = {
      callId,
      wireName,
      freeform: request.freeform === true,
      ...(request.freeform === true ? { input: request.input ?? "" } : { arguments: request.arguments ?? {} }),
    };
    const invocation = new Promise<BrokerToolResult>((resolveInvoke, rejectInvoke) => {
      binding.channel.invocations.set(callId, { request: toolRequest, resolve: resolveInvoke, reject: rejectInvoke });
    });
    binding.channel.queuedCallIds.push(callId);
    console.info(
      `[chatgpt-web] broker trace=${binding.channel.traceId} queued call=${callId.slice(0, 17)} tool=${wireName} waiters=${binding.channel.waiters.size}`,
    );
    this.scheduleToolWaiters(binding.channel);
    if (request.method !== "invoke_async") return invocation;
    return this.operations.start(binding.token, request.operationId!, callId, {
      bindingId, wireName, freeform: request.freeform === true,
      input: request.input, arguments: request.arguments,
    }, invocation);
  }

  private cancelOwnedOperation(token: string, operationId: string): BrokerOwnedOperationSnapshot {
    const callId = this.operations.runningCallId(token, operationId);
    if (callId !== undefined) {
      const channel = this.channels.get(token);
      if (!channel) throw new Error("running owned Codex tool operation lost its broker channel");
      const delivered = channel.deliveredCallIds.has(callId);
      const invocation = channel.invocations.get(callId);
      if (delivered) {
        // Observation cancellation does not undo the external action. It only removes this call
        // from at-least-once redelivery and the turn fence; a late owner completion is swallowed by
        // the detached-call tombstone so it cannot resurrect or duplicate the invocation.
        channel.deliveredCallIds.delete(callId);
        channel.invocations.delete(callId);
        channel.detachedInvocationCallIds.add(callId);
        invocation?.reject(new Error(
          "Owned Codex tool observation was cancelled after dispatch; the external tool may still complete or cause side effects",
        ));
      } else {
        channel.queuedCallIds = channel.queuedCallIds.filter(id => id !== callId);
        channel.invocations.delete(callId);
        invocation?.reject(new Error("Owned Codex tool operation was cancelled before dispatch"));
      }
      return this.operations.cancel(token, operationId, delivered ? "observation_only" : "queued");
    }
    return this.operations.snapshot(token, operationId);
  }

  private takeQueued(channel: TurnChannel): BrokerToolRequest[] {
    const ids = channel.queuedCallIds.splice(0);
    for (const id of ids) {
      if (channel.invocations.has(id)) channel.deliveredCallIds.add(id);
    }
    return ids.map(id => channel.invocations.get(id)?.request).filter((request): request is BrokerToolRequest => Boolean(request));
  }

  private scheduleToolWaiters(channel: TurnChannel): void {
    if (channel.queuedCallIds.length === 0 || channel.waiters.size === 0) return;
    if (channel.batchTimer) return;
    channel.batchTimer = setTimeout(() => {
      channel.batchTimer = undefined;
      this.wakeToolWaiters(channel);
    }, 15);
  }

  private wakeToolWaiters(channel: TurnChannel): void {
    if (channel.queuedCallIds.length === 0 || channel.waiters.size === 0) return;
    const batch = this.takeQueued(channel);
    console.info(
      `[chatgpt-web] broker trace=${channel.traceId} delivered calls=${batch.length} tools=${batch.map(request => request.wireName).join(",")}`,
    );
    const waiters = [...channel.waiters];
    channel.waiters.clear();
    const first = waiters.shift();
    if (first) {
      if (first.signal && first.onAbort) first.signal.removeEventListener("abort", first.onAbort);
      first.resolve(batch);
    }
    for (const waiter of waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(new Error("another adapter waiter already claimed the queued tool batch"));
    }
  }

  private rejectChannel(channel: TurnChannel, error: Error): void {
    if (channel.batchTimer) clearTimeout(channel.batchTimer);
    channel.batchTimer = undefined;
    for (const waiter of channel.waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(error);
    }
    channel.waiters.clear();
    for (const invocation of channel.invocations.values()) invocation.reject(error);
    channel.invocations.clear();
    channel.queuedCallIds = [];
    channel.deliveredCallIds.clear();
    channel.detachedInvocationCallIds.clear();
  }

  private prune(): void {
    const now = Date.now();
    this.operations.pruneOwnedOperations(now);
    for (const [token, channel] of this.channels) {
      if (channel.environment.expiresAt === undefined || channel.environment.expiresAt > now) continue;
      this.revoke(token);
    }
  }
}
