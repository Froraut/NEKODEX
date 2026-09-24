import { boundedIdentity, normalizeContinuationScope, continuationScopeStatus } from "./continuation-scope";
export { createResponseContinuationScope, type ResponseContinuationOwnerContext } from "./continuation-scope";
import {
  MAX_STORED_RESPONSES, MAX_STORED_RESPONSE_BYTES, SNAPSHOT_TOTAL_MAX_BYTES,
  MAX_DELTA_DEPTH, MAX_NONRETAINED_RESPONSES, MAX_RESPONSE_ID_LENGTH,
  decodeResponseSnapshot, encodeResponseSnapshot, snapshotChainEligible, serializedResponseStateBytes,
  type ResponseContinuationScope, type StoredResponseState, type NonretainedState,
} from "./state-snapshot";
export { serializedResponseStateBytes, type ResponseContinuationScope } from "./state-snapshot";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../config";
import { readBoundedUtf8File } from "../read-bounded-file";

const RESPONSE_TTL_MS = 60 * 60 * 1_000;
const SNAPSHOT_DEBOUNCE_MS = 2_000;
const SNAPSHOT_READ_HEADROOM_BYTES = 1024 * 1024;

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

const states = new Map<string, StoredResponseState>();
const nonretained = new Map<string, NonretainedState>();

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
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const path = snapshotPath();
    if (!existsSync(path)) return;
    const raw: unknown = JSON.parse(readBoundedUtf8File(path, SNAPSHOT_TOTAL_MAX_BYTES + SNAPSHOT_READ_HEADROOM_BYTES));
    const snapshot = decodeResponseSnapshot(raw, normalizeContinuationScope);
    if (!snapshot) return;
    for (const [id, state] of snapshot.entries) setEntry(id, state);
    for (const [id, state] of snapshot.rejections) nonretained.set(id, state);
    pruneResponses();
  } catch {
    /* missing/corrupt snapshot: start empty */
  }
}

function persistNow(path: string): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  pendingPersistPath = null;
  try {
    const snapshot = encodeResponseSnapshot(states, nonretained);
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
  try {
    const parent = replayedInputParents.get(requestBody);
    if (parent) {
      const ownerStatus = continuationScopeStatus(parent.scope, scope);
      if (ownerStatus !== "retained") {
        rememberNonretained(response.id, ownerStatus);
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
    const retained = states.get(response.id)!;
    if (!snapshotChainEligible(response.id, retained)) {
      rememberNonretained(response.id, "snapshot-capacity");
      return { status: "retained", restartPersistence: "memory-only", reason: "snapshot-capacity" };
    }
    return { status: "retained", restartPersistence: "eligible" };
  } finally {
    // Every eligible retention attempt mutates a root or rejection, including early returns.
    // Reads, invalid IDs and skipped completions never enter this persistence boundary.
    schedulePersist();
  }
}
