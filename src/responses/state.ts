import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../config";
import { readBoundedUtf8File } from "../read-bounded-file";

const MAX_STORED_RESPONSES = 1_000;
const RESPONSE_TTL_MS = 60 * 60 * 1_000;
const SNAPSHOT_DEBOUNCE_MS = 2_000;
/** In-memory high-water byte cap across reachable history nodes. */
const MAX_STORED_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Entries whose serialized size exceeds this are kept in memory but skipped on disk: inputs can
 * carry base64 `input_image` data URLs, and one screenshot-heavy thread must not balloon the file. */
const SNAPSHOT_ENTRY_MAX_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_TOTAL_MAX_BYTES = 24 * 1024 * 1024;
const MAX_DELTA_DEPTH = 7;
const MAX_NONRETAINED_RESPONSES = 1_000;

export type ResponseStateRetentionResult =
  | { status: "retained" }
  | { status: "not-retained"; reason: "too-large" | "unserializable" | "capacity" }
  | { status: "skipped" };

export type PreviousResponseStateStatus = "retained" | "not-retained-too-large"
  | "not-retained-unserializable" | "not-retained-capacity" | "unavailable";

interface StoredResponseState {
  createdAt: number;
  /** A checkpoint is self-contained; subsequent nodes contain only their new suffix. */
  items: readonly unknown[];
  parent?: StoredResponseState;
  depth: number;
  itemCount: number;
  /** Local payload size, never trusted from disk. */
  sizeBytes: number;
}

const states = new Map<string, StoredResponseState>();
const nonretained = new Map<string, { createdAt: number; reason: Exclude<PreviousResponseStateStatus, "retained" | "unavailable"> }>();

export function serializedResponseStateBytes(items: readonly unknown[]): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(items), "utf8");
  } catch {
    return undefined;
  }
}

function rememberNonretained(id: string, reason: "too-large" | "unserializable" | "capacity"): void {
  nonretained.delete(id);
  nonretained.set(id, { createdAt: now(), reason: `not-retained-${reason}` });
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
 * persistence is debounced + unref'd so the hot path never blocks and the process can exit.
 * Every disk failure is swallowed — the snapshot is a cache, not a source of truth.
 */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const path = snapshotPath();
    if (!existsSync(path)) return;
    const raw = JSON.parse(readBoundedUtf8File(path, SNAPSHOT_TOTAL_MAX_BYTES + 1024 * 1024)) as {
      version?: unknown;
      states?: unknown;
    };
    if (raw.version !== 1 || !Array.isArray(raw.states)) return;
    for (const entry of raw.states) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [id, state] = entry as [unknown, unknown];
      if (typeof id !== "string" || !state || typeof state !== "object") continue;
      const rec = state as { createdAt?: unknown; items?: unknown };
      if (typeof rec.createdAt !== "number" || !Array.isArray(rec.items)) continue;
      // Recompute sizes locally while loading; persisted sizeBytes is never trusted.
      setEntry(id, {
        createdAt: rec.createdAt,
        items: rec.items,
        depth: 0,
        itemCount: rec.items.length,
        sizeBytes: serializedResponseStateBytes(rec.items) ?? MAX_STORED_RESPONSE_BYTES + 1,
      });
    }
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
    const entries: [string, { createdAt: number; items: unknown[] }][] = [];
    let total = 0;
    // Newest-first so the most recent chains survive both caps.
    for (const entry of [...states].reverse()) {
      const [id, state] = entry;
      // Version 1 remains self-contained: omitted oversized ancestors cannot strand a
      // descendant, and older snapshots remain readable after this in-memory change.
      const persistEntry: [string, { createdAt: number; items: unknown[] }] =
        [id, { createdAt: state.createdAt, items: materialize(state) }];
      const serialized = JSON.stringify(persistEntry);
      const size = Buffer.byteLength(serialized, "utf8");
      if (size > SNAPSHOT_ENTRY_MAX_BYTES) continue;
      if (total + size > SNAPSHOT_TOTAL_MAX_BYTES) break;
      total += size;
      entries.push(persistEntry);
    }
    entries.reverse();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // mkdirSync's mode only applies on creation — re-harden an existing config dir so the
    // conversation-content snapshot never lands in a group/world-readable directory.
    try { chmodSync(dirname(path), 0o700); } catch { /* best-effort (e.g. Windows) */ }
    atomicWriteFile(path, JSON.stringify({ version: 1, states: entries }));
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

export function previousResponseStateStatus(id: string): PreviousResponseStateStatus {
  ensureLoaded();
  pruneResponses();
  if (states.has(id)) return "retained";
  return nonretained.get(id)?.reason ?? "unavailable";
}

export function expandPreviousResponseInput(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const request = body as Record<string, unknown>;
  const previousId = typeof request.previous_response_id === "string" ? request.previous_response_id : undefined;
  if (!previousId) return body;
  ensureLoaded();
  pruneResponses();
  const previous = states.get(previousId);
  if (!previous) return body;
  const expanded = {
    ...request,
    input: [...materialize(previous), ...inputItems(request.input)],
  };
  replayedInputPrefixLengths.set(expanded, previous.itemCount);
  replayedInputParents.set(expanded, previous);
  return expanded;
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
  opts?: { force?: boolean },
): ResponseStateRetentionResult {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) return { status: "skipped" };
  const request = requestBody as Record<string, unknown>;
  // `force` bypasses only the store:false skip: Codex sends `store:false` on every non-Azure
  // HTTP request (and WS inherits it), yet its WS turns still chain with previous_response_id.
  // The passthrough branch records with force so those chains can be expanded locally; the
  // store stays in-memory with a 1h TTL, so this is a proxy-internal continuation cache, not
  // real server-side response storage.
  if (request.store === false && !opts?.force) return { status: "skipped" };
  if (typeof response.id !== "string" || !Array.isArray(response.output)) return { status: "skipped" };
  if (response.status === "incomplete") {
    const details = response.incomplete_details;
    if (!details || typeof details !== "object" || Array.isArray(details)
      || (details as { reason?: unknown }).reason !== "max_output_tokens") return { status: "skipped" };
  } else if (response.status !== undefined && response.status !== "completed") return { status: "skipped" };
  ensureLoaded();
  const parent = replayedInputParents.get(requestBody);
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
  });
  pruneResponses();
  if (!states.has(response.id)) {
    rememberNonretained(response.id, "capacity");
    return { status: "not-retained", reason: "capacity" };
  }
  schedulePersist();
  return { status: "retained" };
}
