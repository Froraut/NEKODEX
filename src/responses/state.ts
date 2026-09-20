import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../config";
import { readBoundedUtf8File } from "../read-bounded-file";

const MAX_STORED_RESPONSES = 1_000;
const RESPONSE_TTL_MS = 60 * 60 * 1_000;
const SNAPSHOT_DEBOUNCE_MS = 2_000;
/** In-memory high-water byte cap across reachable history nodes. */
const MAX_STORED_RESPONSE_BYTES = 64 * 1024 * 1024;
const SNAPSHOT_TOTAL_MAX_BYTES = 24 * 1024 * 1024;
const SNAPSHOT_READ_HEADROOM_BYTES = 1024 * 1024;
const MAX_DELTA_DEPTH = 7;
const MAX_SNAPSHOT_NODES = MAX_STORED_RESPONSES * (MAX_DELTA_DEPTH + 1);
const MAX_NONRETAINED_RESPONSES = 1_000;
const MAX_RESPONSE_ID_LENGTH = 512;
const MAX_PROVIDER_NAMESPACE_LENGTH = 128;
const MAX_OWNER_KEY_LENGTH = 128;
const MAX_ACCOUNT_ROUTING_KEY_LENGTH = 128;

export interface ResponseContinuationOwnerContext {
  /** Stable cache namespace. Use the same namespace when a native request expands Web-owned output. */
  providerNamespace: string;
  threadId?: string;
  promptCacheKey?: string;
  turnId?: string;
  /** The launcher's already-derived sticky account key, when the selected route has one. */
  accountRoutingKey?: string;
}

export interface ResponseContinuationScope {
  providerNamespace: string;
  /** SHA-256 of the strongest available native owner identity; raw IDs are never persisted. */
  ownerKey: string;
  accountRoutingKey?: string;
}

export interface ResponseContinuationLookupOptions {
  scope?: ResponseContinuationScope;
}

export interface PreviousResponseResolution {
  body: unknown;
  previousResponseId?: string;
  status: "not-requested" | "expanded" | "unavailable";
  reason?: Exclude<PreviousResponseStateStatus, "retained">;
}

type NonretainedReason = "too-large" | "unserializable" | "capacity" | "snapshot-capacity"
  | "owner-mismatch" | "owner-unavailable";

export type ResponseStateRetentionResult =
  | { status: "retained"; restartPersistence: "eligible" | "memory-only"; reason?: "snapshot-capacity" }
  | { status: "not-retained"; reason: NonretainedReason }
  | { status: "skipped" };

export type PreviousResponseStateStatus = "retained" | "not-retained-too-large"
  | "not-retained-unserializable" | "not-retained-capacity" | "not-retained-snapshot-capacity"
  | "owner-mismatch" | "owner-unavailable" | "unavailable";

interface StoredResponseState {
  createdAt: number;
  /** A checkpoint is self-contained; subsequent nodes contain only their new suffix. */
  items: readonly unknown[];
  parent?: StoredResponseState;
  depth: number;
  itemCount: number;
  /** Local payload size, never trusted from disk. */
  sizeBytes: number;
  scope?: ResponseContinuationScope;
}

const states = new Map<string, StoredResponseState>();
type NonretainedState = {
  createdAt: number;
  reason: Exclude<PreviousResponseStateStatus, "retained" | "unavailable">;
};
const nonretained = new Map<string, NonretainedState>();

export function serializedResponseStateBytes(items: readonly unknown[]): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(items), "utf8");
  } catch {
    return undefined;
  }
}

function rememberNonretained(id: string, reason: NonretainedReason): void {
  nonretained.delete(id);
  nonretained.set(id, {
    createdAt: now(),
    reason: reason === "owner-mismatch" || reason === "owner-unavailable"
      ? reason : `not-retained-${reason}`,
  });
  while (nonretained.size > MAX_NONRETAINED_RESPONSES) {
    const oldest = nonretained.keys().next().value as string | undefined;
    if (!oldest) break;
    nonretained.delete(oldest);
  }
}

function materialize(state: StoredResponseState): unknown[] {
  const segments: (readonly unknown[])[] = [];
  let current: StoredResponseState | undefined = state;
  while (current) {
    segments.push(current.items);
    current = current.parent;
  }
  const items: unknown[] = [];
  for (let i = segments.length - 1; i >= 0; i--) {
    for (const item of segments[i]) items.push(item);
  }
  return items;
}

function setEntry(id: string, state: StoredResponseState): void {
  states.delete(id);
  states.set(id, state);
}

/** Evicted IDs may still be ancestors of live IDs; count every reachable node once. */
function reachableBytes(): number {
  const seen = new Set<StoredResponseState>();
  let total = 0;
  for (const state of states.values()) {
    let current: StoredResponseState | undefined = state;
    while (current && !seen.has(current)) {
      seen.add(current);
      total += current.sizeBytes;
      current = current.parent;
    }
  }
  return total;
}
// Expansion provenance must stay proxy-private: a WeakMap distinguishes replayed history from the
// newly appended input suffix without adding an unknown field that native passthrough could send
// upstream. Consumers use the prefix length to bind trusted history and rolling checkpoints to the
// exact replayed portion of this request.
const replayedInputPrefixLengths = new WeakMap<object, number>();
const replayedInputParents = new WeakMap<object, StoredResponseState>();
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersistPath: string | null = null;

function now(): number {
  return Date.now();
}

function boundedIdentity(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function normalizeContinuationScope(value: unknown): ResponseContinuationScope | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Response continuation scope must be an object");
  }
  const scope = value as Partial<ResponseContinuationScope>;
  if (!boundedIdentity(scope.providerNamespace, MAX_PROVIDER_NAMESPACE_LENGTH)) {
    throw new TypeError("Response continuation provider namespace is invalid");
  }
  if (!boundedIdentity(scope.ownerKey, MAX_OWNER_KEY_LENGTH) || !/^[a-f0-9]{64}$/.test(scope.ownerKey)) {
    throw new TypeError("Response continuation owner key is invalid");
  }
  if (scope.accountRoutingKey !== undefined
    && (!boundedIdentity(scope.accountRoutingKey, MAX_ACCOUNT_ROUTING_KEY_LENGTH)
      || !/^[a-f0-9]{64}$/.test(scope.accountRoutingKey))) {
    throw new TypeError("Response continuation account routing key is invalid");
  }
  return {
    providerNamespace: scope.providerNamespace,
    ownerKey: scope.ownerKey,
    ...(scope.accountRoutingKey !== undefined ? { accountRoutingKey: scope.accountRoutingKey } : {}),
  };
}

/**
 * Derive a persistence-safe owner scope from the same native identity and account-affinity inputs
 * used by request routing. Callers should pass the returned scope to resolve/expand and remember.
 * No scope is returned for ordinary OpenAI-compatible requests that carry no stable native owner.
 */
export function createResponseContinuationScope(
  context: ResponseContinuationOwnerContext,
): ResponseContinuationScope | undefined {
  const owner = boundedIdentity(context.threadId, 4_096)
    ? { kind: "thread", id: context.threadId }
    : boundedIdentity(context.promptCacheKey, 4_096)
      ? { kind: "prompt_cache", id: context.promptCacheKey }
      : boundedIdentity(context.turnId, 4_096)
        ? { kind: "turn", id: context.turnId }
        : undefined;
  if (!owner) return undefined;
  if (!boundedIdentity(context.providerNamespace, MAX_PROVIDER_NAMESPACE_LENGTH)) {
    throw new TypeError("Response continuation provider namespace is invalid");
  }
  if (context.accountRoutingKey !== undefined
    && (!boundedIdentity(context.accountRoutingKey, MAX_ACCOUNT_ROUTING_KEY_LENGTH)
      || !/^[a-f0-9]{64}$/.test(context.accountRoutingKey))) {
    throw new TypeError("Response continuation account routing key is invalid");
  }
  return {
    providerNamespace: context.providerNamespace,
    ownerKey: createHash("sha256").update(JSON.stringify(owner)).digest("hex"),
    ...(context.accountRoutingKey !== undefined ? { accountRoutingKey: context.accountRoutingKey } : {}),
  };
}

function continuationScopeStatus(
  stored: ResponseContinuationScope | undefined,
  expected: ResponseContinuationScope | undefined,
): "retained" | "owner-mismatch" | "owner-unavailable" {
  if (!stored && !expected) return "retained";
  if (!stored || !expected) return "owner-unavailable";
  return stored.providerNamespace === expected.providerNamespace
    && stored.ownerKey === expected.ownerKey
    && stored.accountRoutingKey === expected.accountRoutingKey
    ? "retained"
    : "owner-mismatch";
}

function snapshotPath(): string {
  return join(getConfigDir(), "responses-state.json");
}

/**
 * Best-effort disk snapshot so previous_response_id chains survive a proxy restart (the
 * dominant expansion-miss cause: an in-memory-only store dies with the process, and the next
 * chained turn then reaches the upstream as a naked delta). Load is lazy on first store access;
 * persistence is debounced + unref'd so request completion only schedules the bounded write and
 * the process can exit.
 * Every disk failure is swallowed — the snapshot is a cache, not a source of truth.
 */
interface LoadedSnapshot {
  entries: Array<[string, StoredResponseState]>;
  rejections: Array<[string, NonretainedState]>;
}

function loadVersionOneSnapshot(rawStates: unknown[]): LoadedSnapshot {
  const entries: Array<[string, StoredResponseState]> = [];
  for (const entry of rawStates.slice(-MAX_STORED_RESPONSES)) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [id, state] = entry as [unknown, unknown];
    if (!boundedIdentity(id, MAX_RESPONSE_ID_LENGTH) || !state || typeof state !== "object") continue;
    const rec = state as { createdAt?: unknown; items?: unknown };
    if (typeof rec.createdAt !== "number" || !Number.isFinite(rec.createdAt) || !Array.isArray(rec.items)) continue;
    const sizeBytes = serializedResponseStateBytes(rec.items);
    if (sizeBytes === undefined || sizeBytes > MAX_STORED_RESPONSE_BYTES) continue;
    // Version 1 had no owner field. It remains readable by unscoped OpenAI-compatible callers,
    // while a scoped native caller receives owner-unavailable and cannot adopt it into an account.
    entries.push([id, {
      createdAt: rec.createdAt,
      items: rec.items,
      depth: 0,
      itemCount: rec.items.length,
      sizeBytes,
    }]);
  }
  return { entries, rejections: [] };
}

function persistedRejectionReason(value: unknown): NonretainedState["reason"] | undefined {
  return value === "not-retained-too-large"
    || value === "not-retained-unserializable"
    || value === "not-retained-capacity"
    || value === "not-retained-snapshot-capacity"
    || value === "owner-mismatch"
    || value === "owner-unavailable"
    ? value
    : undefined;
}

function loadVersionTwoSnapshot(raw: Record<string, unknown>): LoadedSnapshot {
  if (!Array.isArray(raw.nodes) || raw.nodes.length > MAX_SNAPSHOT_NODES
    || !Array.isArray(raw.roots) || raw.roots.length > MAX_STORED_RESPONSES) {
    throw new Error("Invalid response-state snapshot shape");
  }
  const nodes: Array<StoredResponseState | undefined> = [];
  for (let index = 0; index < raw.nodes.length; index += 1) {
    const value = raw.nodes[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid response-state snapshot node");
    }
    const rec = value as { createdAt?: unknown; items?: unknown; parent?: unknown; scope?: unknown };
    if (typeof rec.createdAt !== "number" || !Number.isFinite(rec.createdAt) || !Array.isArray(rec.items)) {
      throw new Error("Invalid response-state snapshot node payload");
    }
    const parentIndex = rec.parent;
    const parent = parentIndex === undefined
      ? undefined
      : Number.isSafeInteger(parentIndex) && (parentIndex as number) >= 0 && (parentIndex as number) < index
        ? nodes[parentIndex as number]
        : undefined;
    if (parentIndex !== undefined && !parent) throw new Error("Invalid response-state snapshot parent");
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > MAX_DELTA_DEPTH) throw new Error("Response-state snapshot depth exceeded");
    const itemCount = (parent?.itemCount ?? 0) + rec.items.length;
    if (!Number.isSafeInteger(itemCount)) throw new Error("Response-state snapshot item count exceeded");
    const sizeBytes = serializedResponseStateBytes(rec.items);
    if (sizeBytes === undefined || sizeBytes > MAX_STORED_RESPONSE_BYTES) {
      throw new Error("Invalid response-state snapshot node size");
    }
    nodes.push({
      createdAt: rec.createdAt,
      items: rec.items,
      ...(parent ? { parent } : {}),
      depth,
      itemCount,
      sizeBytes,
      ...(rec.scope !== undefined ? { scope: normalizeContinuationScope(rec.scope)! } : {}),
    });
  }

  const entries: Array<[string, StoredResponseState]> = [];
  for (const root of raw.roots) {
    if (!Array.isArray(root) || root.length !== 2) continue;
    const [id, nodeIndex] = root;
    if (!boundedIdentity(id, MAX_RESPONSE_ID_LENGTH) || !Number.isSafeInteger(nodeIndex)) continue;
    const node = nodes[nodeIndex as number];
    if (node) entries.push([id, node]);
  }

  const rejections: Array<[string, NonretainedState]> = [];
  if (raw.rejections !== undefined) {
    if (!Array.isArray(raw.rejections) || raw.rejections.length > MAX_NONRETAINED_RESPONSES) {
      throw new Error("Invalid response-state snapshot rejections");
    }
    for (const value of raw.rejections) {
      if (!Array.isArray(value) || value.length !== 3) continue;
      const [id, createdAt, rawReason] = value;
      const reason = persistedRejectionReason(rawReason);
      if (boundedIdentity(id, MAX_RESPONSE_ID_LENGTH)
        && typeof createdAt === "number" && Number.isFinite(createdAt) && reason) {
        rejections.push([id, { createdAt, reason }]);
      }
    }
  }
  return { entries, rejections };
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const path = snapshotPath();
    if (!existsSync(path)) return;
    const raw = JSON.parse(readBoundedUtf8File(path, SNAPSHOT_TOTAL_MAX_BYTES + SNAPSHOT_READ_HEADROOM_BYTES)) as {
      version?: unknown;
      states?: unknown;
      nodes?: unknown;
      roots?: unknown;
      rejections?: unknown;
    };
    const snapshot = raw.version === 1 && Array.isArray(raw.states)
      ? loadVersionOneSnapshot(raw.states)
      : raw.version === 2
        ? loadVersionTwoSnapshot(raw as Record<string, unknown>)
        : undefined;
    if (!snapshot) return;
    for (const [id, state] of snapshot.entries) setEntry(id, state);
    for (const [id, state] of snapshot.rejections) nonretained.set(id, state);
    pruneResponses();
  } catch {
    /* missing/corrupt snapshot: start empty */
  }
}

interface PersistedSnapshotNode {
  createdAt: number;
  items: readonly unknown[];
  parent?: number;
  scope?: ResponseContinuationScope;
}

function jsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Response-state snapshot value is not serializable");
  return Buffer.byteLength(serialized, "utf8");
}

function arrayEntryBytes(serializedBytes: number, existingEntries: number): number {
  return serializedBytes + (existingEntries > 0 ? 1 : 0);
}

function persistNow(path: string): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  pendingPersistPath = null;
  try {
    const nodes: PersistedSnapshotNode[] = [];
    const selectedNodes = new Map<StoredResponseState, number>();
    const newestRoots: Array<[string, number]> = [];
    const selectedRootIds = new Set<string>();
    let total = jsonBytes({ version: 2, nodes: [], roots: [], rejections: [] });

    // Newest roots win. Each local delta node is serialized once and shared by every descendant;
    // the in-memory size bound rejects a node before JSON.stringify can allocate a giant chain.
    for (const [id, state] of [...states].reverse()) {
      const chain: StoredResponseState[] = [];
      const seen = new Set<StoredResponseState>();
      let cursor: StoredResponseState | undefined = state;
      while (cursor && !selectedNodes.has(cursor)) {
        if (seen.has(cursor)) throw new Error("Response continuation state contains a cycle");
        seen.add(cursor);
        chain.push(cursor);
        cursor = cursor.parent;
      }
      chain.reverse();

      const staged: Array<{ state: StoredResponseState; node: PersistedSnapshotNode }> = [];
      let stagedBytes = 0;
      let parentIndex = cursor ? selectedNodes.get(cursor) : undefined;
      let rejectedBeforeSerialization = false;
      for (const nodeState of chain) {
        // Measure metadata without serializing the item payload. If it cannot fit, reject the node
        // before JSON.stringify can allocate a giant candidate.
        const skeleton: PersistedSnapshotNode = {
          createdAt: nodeState.createdAt,
          items: [],
          ...(parentIndex !== undefined ? { parent: parentIndex } : {}),
          ...(nodeState.scope ? { scope: nodeState.scope } : {}),
        };
        const estimatedNodeBytes = jsonBytes(skeleton) - 2 + nodeState.sizeBytes;
        const estimatedIncrement = arrayEntryBytes(estimatedNodeBytes, nodes.length + staged.length);
        if (estimatedIncrement > SNAPSHOT_TOTAL_MAX_BYTES - total - stagedBytes) {
          rejectedBeforeSerialization = true;
          break;
        }
        const node: PersistedSnapshotNode = {
          createdAt: nodeState.createdAt,
          items: nodeState.items,
          ...(parentIndex !== undefined ? { parent: parentIndex } : {}),
          ...(nodeState.scope ? { scope: nodeState.scope } : {}),
        };
        const bytes = jsonBytes(node);
        stagedBytes += arrayEntryBytes(bytes, nodes.length + staged.length);
        staged.push({ state: nodeState, node });
        parentIndex = nodes.length + staged.length - 1;
      }
      if (rejectedBeforeSerialization || staged.length !== chain.length) continue;
      const rootIndex = selectedNodes.get(state) ?? parentIndex;
      if (rootIndex === undefined) continue;
      const root: [string, number] = [id, rootIndex];
      const rootBytes = arrayEntryBytes(jsonBytes(root), newestRoots.length);
      if (total + stagedBytes + rootBytes > SNAPSHOT_TOTAL_MAX_BYTES) continue;
      for (const entry of staged) {
        selectedNodes.set(entry.state, nodes.length);
        nodes.push(entry.node);
      }
      total += stagedBytes + rootBytes;
      newestRoots.push(root);
      selectedRootIds.add(id);
    }

    const newestRejections: Array<[string, number, NonretainedState["reason"]]> = [];
    for (const [id, state] of [...nonretained].reverse()) {
      if (selectedRootIds.has(id)) continue;
      const rejection: [string, number, NonretainedState["reason"]] = [id, state.createdAt, state.reason];
      const bytes = arrayEntryBytes(jsonBytes(rejection), newestRejections.length);
      if (total + bytes > SNAPSHOT_TOTAL_MAX_BYTES) continue;
      total += bytes;
      newestRejections.push(rejection);
    }
    const snapshot = JSON.stringify({
      version: 2,
      nodes,
      // Map insertion order is oldest-first; restore that order after newest-first selection.
      roots: newestRoots.reverse(),
      rejections: newestRejections.reverse(),
    });
    if (Buffer.byteLength(snapshot, "utf8") > SNAPSHOT_TOTAL_MAX_BYTES) return;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // mkdirSync's mode only applies on creation — re-harden an existing config dir so the
    // conversation-content snapshot never lands in a group/world-readable directory.
    try { chmodSync(dirname(path), 0o700); } catch { /* best-effort (e.g. Windows) */ }
    atomicWriteFile(path, snapshot);
  } catch {
    /* best-effort: disk trouble must never affect request handling */
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  // Resolve the target path now: tests may swap CODEX_CHATGPT_WEB_HOME before the
  // debounce fires, and a late write must land in the home that owned the recorded state.
  pendingPersistPath = snapshotPath();
  const path = pendingPersistPath;
  persistTimer = setTimeout(() => persistNow(path), SNAPSHOT_DEBOUNCE_MS);
  (persistTimer as { unref?: () => void }).unref?.();
}

/** Flush any pending debounced snapshot write (graceful shutdown / deterministic tests). */
export function flushResponseState(): void {
  if (!persistTimer) return;
  // Use the path captured when the write was scheduled; CODEX_CHATGPT_WEB_HOME may have moved.
  persistNow(pendingPersistPath ?? snapshotPath());
}

function inputItems(input: unknown): unknown[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") return [{ role: "user", content: input }];
  return [input];
}

function pruneResponses(at = now()): void {
  for (const [id, state] of states) {
    if (at - state.createdAt > RESPONSE_TTL_MS) states.delete(id);
  }
  for (const [id, state] of nonretained) {
    if (at - state.createdAt > RESPONSE_TTL_MS) nonretained.delete(id);
  }
  while (states.size > MAX_STORED_RESPONSES) {
    const oldest = states.keys().next().value as string | undefined;
    if (!oldest) break;
    states.delete(oldest);
    rememberNonretained(oldest, "capacity");
  }
  // Byte high-water eviction, oldest-first (Map preserves insertion order).
  while (reachableBytes() > MAX_STORED_RESPONSE_BYTES && states.size > 0) {
    const oldest = states.keys().next().value as string | undefined;
    if (!oldest) break;
    states.delete(oldest);
    rememberNonretained(oldest, "capacity");
  }
}

export function previousResponseStateStatus(
  id: string,
  options: ResponseContinuationLookupOptions = {},
): PreviousResponseStateStatus {
  if (!boundedIdentity(id, MAX_RESPONSE_ID_LENGTH)) return "unavailable";
  ensureLoaded();
  pruneResponses();
  const state = states.get(id);
  if (state) return continuationScopeStatus(state.scope, normalizeContinuationScope(options.scope));
  return nonretained.get(id)?.reason ?? "unavailable";
}

/**
 * Owner-aware continuation lookup for server/native callers. The result keeps the original body on
 * every failure so a caller can return an explicit 409 without risking partial-context delivery.
 */
export function resolvePreviousResponseInput(
  body: unknown,
  options: ResponseContinuationLookupOptions = {},
): PreviousResponseResolution {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { body, status: "not-requested" };
  }
  const request = body as Record<string, unknown>;
  const rawPreviousId = typeof request.previous_response_id === "string"
    ? request.previous_response_id : undefined;
  if (!rawPreviousId) return { body, status: "not-requested" };
  if (!boundedIdentity(rawPreviousId, MAX_RESPONSE_ID_LENGTH)) {
    return { body, status: "unavailable", reason: "unavailable" };
  }
  const previousId = rawPreviousId;
  ensureLoaded();
  pruneResponses();
  const previous = states.get(previousId);
  if (!previous) {
    return {
      body,
      previousResponseId: previousId,
      status: "unavailable",
      reason: nonretained.get(previousId)?.reason ?? "unavailable",
    };
  }
  const ownerStatus = continuationScopeStatus(previous.scope, normalizeContinuationScope(options.scope));
  if (ownerStatus !== "retained") {
    return { body, previousResponseId: previousId, status: "unavailable", reason: ownerStatus };
  }
  const expanded = {
    ...request,
    input: [...materialize(previous), ...inputItems(request.input)],
  };
  replayedInputPrefixLengths.set(expanded, previous.itemCount);
  replayedInputParents.set(expanded, previous);
  return { body: expanded, previousResponseId: previousId, status: "expanded" };
}

/** Backward-compatible projection for existing ordinary OpenAI-compatible callers. */
export function expandPreviousResponseInput(
  body: unknown,
  options: ResponseContinuationLookupOptions = {},
): unknown {
  return resolvePreviousResponseInput(body, options).body;
}

/** Number of leading input items restored from previous_response_id state for this exact body. */
export function previousResponseReplayPrefixLength(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  return replayedInputPrefixLengths.get(body) ?? 0;
}

function snapshotChainEligible(id: string, state: StoredResponseState): boolean {
  let total = jsonBytes({ version: 2, nodes: [], roots: [], rejections: [] });
  const chain: StoredResponseState[] = [];
  let current: StoredResponseState | undefined = state;
  const seen = new Set<StoredResponseState>();
  while (current) {
    if (seen.has(current)) return false;
    seen.add(current);
    chain.push(current);
    current = current.parent;
  }
  chain.reverse();
  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]!;
    const skeleton: PersistedSnapshotNode = {
      createdAt: node.createdAt,
      items: [],
      ...(index > 0 ? { parent: index - 1 } : {}),
      ...(node.scope ? { scope: node.scope } : {}),
    };
    const nodeBytes = jsonBytes(skeleton) - 2 + node.sizeBytes;
    total += arrayEntryBytes(nodeBytes, index);
    if (total > SNAPSHOT_TOTAL_MAX_BYTES) return false;
  }
  total += arrayEntryBytes(jsonBytes([id, Math.max(0, chain.length - 1)]), 0);
  if (total > SNAPSHOT_TOTAL_MAX_BYTES) return false;
  return true;
}

/**
 * Cache completed output and max_output_tokens partial output for previous_response_id replay.
 * Content-filtered incomplete and failed output are not authoritative replay history.
 */
export function rememberResponseState(
  requestBody: unknown,
  response: { id?: unknown; output?: unknown; status?: unknown; incomplete_details?: unknown },
  opts?: { force?: boolean; scope?: ResponseContinuationScope },
): ResponseStateRetentionResult {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) return { status: "skipped" };
  const request = requestBody as Record<string, unknown>;
  // `force` bypasses only the store:false skip: Codex sends `store:false` on every non-Azure
  // HTTP request (and WS inherits it), yet its WS turns still chain with previous_response_id.
  // The passthrough branch records with force so those chains can be expanded locally; the
  // bounded store has a 1h TTL and a private restart snapshot, so this remains a proxy-internal
  // continuation cache rather than real server-side response storage.
  if (request.store === false && !opts?.force) return { status: "skipped" };
  if (typeof response.id !== "string" || !Array.isArray(response.output)) return { status: "skipped" };
  if (!boundedIdentity(response.id, MAX_RESPONSE_ID_LENGTH)) return { status: "not-retained", reason: "too-large" };
  if (response.status === "incomplete") {
    const details = response.incomplete_details;
    if (!details || typeof details !== "object" || Array.isArray(details)
      || (details as { reason?: unknown }).reason !== "max_output_tokens") return { status: "skipped" };
  } else if (response.status !== undefined && response.status !== "completed") return { status: "skipped" };
  ensureLoaded();
  const scope = normalizeContinuationScope(opts?.scope);
  const parent = replayedInputParents.get(requestBody);
  if (parent) {
    const ownerStatus = continuationScopeStatus(parent.scope, scope);
    if (ownerStatus !== "retained") {
      rememberNonretained(response.id, ownerStatus);
      schedulePersist();
      return { status: "not-retained", reason: ownerStatus };
    }
  }
  const input = inputItems(request.input);
  const prefix = parent && replayedInputPrefixLengths.get(requestBody) === parent.itemCount
    ? parent.itemCount : 0;
  const suffix = [...input.slice(prefix), ...response.output];
  const useDelta = !!parent && prefix > 0 && parent.depth < MAX_DELTA_DEPTH;
  const items = useDelta ? suffix : prefix > 0 ? [...input, ...response.output] : suffix;
  const sizeBytes = serializedResponseStateBytes(items);
  if (sizeBytes === undefined) {
    rememberNonretained(response.id, "unserializable");
    return { status: "not-retained", reason: "unserializable" };
  }
  if (sizeBytes > MAX_STORED_RESPONSE_BYTES) {
    rememberNonretained(response.id, "too-large");
    return { status: "not-retained", reason: "too-large" };
  }
  nonretained.delete(response.id);
  setEntry(response.id, {
    createdAt: now(),
    items,
    ...(useDelta ? { parent } : {}),
    depth: useDelta ? parent!.depth + 1 : 0,
    itemCount: (useDelta ? parent!.itemCount : 0) + items.length,
    sizeBytes,
    ...(scope ? { scope } : {}),
  });
  pruneResponses();
  if (!states.has(response.id)) {
    rememberNonretained(response.id, "capacity");
    return { status: "not-retained", reason: "capacity" };
  }
  schedulePersist();
  const retained = states.get(response.id)!;
  if (!snapshotChainEligible(response.id, retained)) {
    rememberNonretained(response.id, "snapshot-capacity");
    return { status: "retained", restartPersistence: "memory-only", reason: "snapshot-capacity" };
  }
  return { status: "retained", restartPersistence: "eligible" };
}
