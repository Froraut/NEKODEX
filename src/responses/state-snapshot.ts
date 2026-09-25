import { boundedIdentity } from "../lib/bounded-identity";

export const MAX_STORED_RESPONSES = 1_000;
/** In-memory high-water byte cap across reachable history nodes. */
export const MAX_STORED_RESPONSE_BYTES = 64 * 1024 * 1024;
export const SNAPSHOT_TOTAL_MAX_BYTES = 24 * 1024 * 1024;
export const MAX_DELTA_DEPTH = 7;
export const MAX_SNAPSHOT_NODES = MAX_STORED_RESPONSES * (MAX_DELTA_DEPTH + 1);
export const MAX_NONRETAINED_RESPONSES = 1_000;
export const MAX_RESPONSE_ID_LENGTH = 512;

export interface ResponseContinuationScope {
  providerNamespace: string;
  /** SHA-256 of the strongest available native owner identity; raw IDs are never persisted. */
  ownerKey: string;
  accountRoutingKey?: string;
}

export interface StoredResponseState {
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

export type NonretainedState = {
  createdAt: number;
  reason: "not-retained-too-large" | "not-retained-unserializable" | "not-retained-capacity"
    | "not-retained-snapshot-capacity" | "owner-mismatch" | "owner-unavailable";
};

export function serializedResponseStateBytes(items: readonly unknown[]): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(items), "utf8");
  } catch {
    return undefined;
  }
}


type ScopeDecoder = (value: unknown) => ResponseContinuationScope | undefined;

export function decodeResponseSnapshot(raw: unknown, normalizeScope: ScopeDecoder): LoadedSnapshot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.version === 1 && Array.isArray(record.states)) return loadVersionOneSnapshot(record.states);
  if (record.version === 2) return loadVersionTwoSnapshot(record, normalizeScope);
  return undefined;
}

export interface LoadedSnapshot {
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

function loadVersionTwoSnapshot(raw: Record<string, unknown>, normalizeContinuationScope: ScopeDecoder): LoadedSnapshot {
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

/** Encode a bounded newest-first graph; callers own time, retention and filesystem policy. */
export function encodeResponseSnapshot(
  states: ReadonlyMap<string, StoredResponseState>,
  nonretained: ReadonlyMap<string, NonretainedState>,
  maxBytes = SNAPSHOT_TOTAL_MAX_BYTES,
): string {
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
      const estimatedIncrement = arrayEntryBytes(estimatedNodeBytes(nodeState, parentIndex), nodes.length + staged.length);
      if (estimatedIncrement > maxBytes - total - stagedBytes) {
        rejectedBeforeSerialization = true;
        break;
      }
      const node = persistedNode(nodeState, parentIndex);
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
    if (total + stagedBytes + rootBytes > maxBytes) continue;
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
    if (total + bytes > maxBytes) continue;
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
  if (Buffer.byteLength(snapshot, "utf8") > maxBytes) throw new Error("Response snapshot exceeds budget");
  return snapshot;
}

export function snapshotChainEligible(id: string, state: StoredResponseState, maxBytes = SNAPSHOT_TOTAL_MAX_BYTES): boolean {
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
    const nodeBytes = estimatedNodeBytes(node, index > 0 ? index - 1 : undefined);
    total += arrayEntryBytes(nodeBytes, index);
    if (total > maxBytes) return false;
  }
  total += arrayEntryBytes(jsonBytes([id, Math.max(0, chain.length - 1)]), 0);
  if (total > maxBytes) return false;
  return true;
}


function persistedNode(state: StoredResponseState, parent: number | undefined, items = state.items): PersistedSnapshotNode {
  return {
    createdAt: state.createdAt,
    items,
    ...(parent !== undefined ? { parent } : {}),
    ...(state.scope ? { scope: state.scope } : {}),
  };
}

function estimatedNodeBytes(state: StoredResponseState, parent: number | undefined): number {
  return jsonBytes(persistedNode(state, parent, [])) - 2 + state.sizeBytes;
}
