import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { atomicWriteFile } from "../../config";
import { getCodexHome } from "../../codex-integration-shared";
import { isReadableCompactionSummaryText, OPAQUE_COMPACTION_NOTE } from "../../responses/compaction";
import type { CodexParsedRequest } from "../../types";
import {
  extractChatGptTurnEnvironment,
  extractChatGptCompactionSourceRevision,
  extractChatGptContinuationEnvironmentClaim,
  extractChatGptSteeringEnvironmentClaim,
  extractChatGptTrailingEnvironmentDeltaClaim,
  extractChatGptTurnIdentity,
  extractChatGptThreadSpawnLineage,
  extractChatGptRootThreadMetadata,
  hasCurrentChatGptEnvironmentContext,
  hasRawChatGptEnvironmentContext,
  unattributedChatGptEnvironmentMessages,
  isChatGptCompactionContinuation,
  MissingTrustedCodexEnvironmentError,
  type ChatGptSandboxPolicy,
  type ChatGptTurnEnvironment,
} from "./environment";
import { resolveCurrentCodexRolloutEnvironment } from "./codex-rollout-environment";
import { canonicalChatGptStatePath, withChatGptStateFileLock } from "./state-file-lock";

interface StoredThreadEnvironment {
  cwd: string;
  roots: string[];
  writableRoots: string[];
  sandboxPolicy: ChatGptSandboxPolicy;
  updatedAt: number;
}

interface StoredThreadEnvironmentFile {
  version: 1;
  threads: Record<string, StoredThreadEnvironment>;
}

const MAX_THREAD_ENVIRONMENTS = 256;
const THREAD_ENVIRONMENT_TTL_MS = 30 * 24 * 60 * 60_000;

interface ThreadEnvironmentBackend {
  loaded: boolean;
  threads: Map<string, StoredThreadEnvironment>;
}

const threadEnvironmentBackends = new Map<string, ThreadEnvironmentBackend>();

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function itemTurnId(value: unknown): string | undefined {
  const turnId = record(record(value)?.internal_chat_message_metadata_passthrough)?.turn_id;
  return typeof turnId === "string" ? turnId : undefined;
}

function messageText(item: Record<string, unknown>): string {
  if (typeof item.content === "string") return item.content;
  if (!Array.isArray(item.content)) return "";
  return item.content
    .map(part => record(part)?.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function messageHoldsEnvironmentEnvelope(item: Record<string, unknown>): boolean {
  if (item.type !== "message" || item.role !== "user" || !Array.isArray(item.content)) return false;
  const environmentParts = item.content.flatMap(part => {
    const text = record(part)?.text;
    return typeof text === "string" && /<\/?environment_context\b/i.test(text) ? [text.trim()] : [];
  });
  return environmentParts.length === 1
    && /^<environment_context>[\s\S]*<\/environment_context>$/.test(environmentParts[0]!);
}

function isCompactionSummaryMessage(item: Record<string, unknown>): boolean {
  if (item.type !== "message" || item.role !== "user") return false;
  const text = messageText(item).trim();
  return isReadableCompactionSummaryText(text) || text === OPAQUE_COMPACTION_NOTE;
}

function skippedMessageHasBoundedShape(item: Record<string, unknown>, turnId: string): boolean {
  const owner = itemTurnId(item);
  // An untagged item ID is only a structural bound for the observed Codex wire shape. It grants no
  // authority: resolve() accepts the projection only after matching the current native rollout.
  return owner === undefined
    ? typeof item.id === "string" && item.id.length > 0
    : owner === turnId;
}

/**
 * Codex 0.155 can place its summary between the current environment envelope and instruction, or
 * make that summary the final input item. Build only the adjacency projection consumed by the
 * existing trusted-environment parser; metadata and sandbox validation remain unchanged there.
 */
function environmentRequestAcrossCompactionSummary(parsed: CodexParsedRequest): CodexParsedRequest | undefined {
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : undefined;
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  if (!body || !input || !turnId) return undefined;

  const envelopeIndexes = input.flatMap((value, index) => {
    const item = record(value);
    return item && messageHoldsEnvironmentEnvelope(item) ? [index] : [];
  });
  if (envelopeIndexes.length !== 1) return undefined;
  const envelopeIndex = envelopeIndexes[0]!;
  const envelope = record(input[envelopeIndex]);
  if (!envelope || typeof envelope.id !== "string" || !envelope.id
    || (itemTurnId(envelope) !== undefined && itemTurnId(envelope) !== turnId)) return undefined;

  let activeInstructionIndex = -1;
  let sawSummary = false;
  let lastSummary: Record<string, unknown> | undefined;
  for (let index = input.length - 1; index > envelopeIndex; index -= 1) {
    const item = record(input[index]);
    if (!item || item.type !== "message") return undefined;
    if (isCompactionSummaryMessage(item)) {
      if (!skippedMessageHasBoundedShape(item, turnId)) return undefined;
      sawSummary = true;
      lastSummary ??= item;
      continue;
    }
    if (item.role === "developer") {
      if (!skippedMessageHasBoundedShape(item, turnId)) return undefined;
      continue;
    }
    if (item.role === "user") {
      if (activeInstructionIndex >= 0) return undefined;
      activeInstructionIndex = index;
      continue;
    }
    return undefined;
  }
  if (!sawSummary) return undefined;

  const normalized = input.filter((value, index) => {
    if (index <= envelopeIndex || (activeInstructionIndex >= 0 && index >= activeInstructionIndex)) return true;
    const item = record(value);
    return !item || !isCompactionSummaryMessage(item);
  });
  if (activeInstructionIndex < 0) {
    if (!lastSummary) return undefined;
    normalized.push({
      ...lastSummary,
      role: "user",
      content: [{ type: "input_text", text: "Continue after the native compaction summary." }],
    });
  }
  return { ...parsed, _rawBody: { ...body, input: normalized } };
}

function pathIdentity(value: string): string {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function contains(root: string, path: string): boolean {
  const rel = relative(pathIdentity(root), pathIdentity(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function absolutePaths(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(path => typeof path !== "string" || !isAbsolute(path))) {
    throw new Error(`Invalid persisted ChatGPT thread ${field}`);
  }
  const unique = new Map<string, string>();
  for (const path of value.map(path => resolve(path as string))) {
    if (!unique.has(pathIdentity(path))) unique.set(pathIdentity(path), path);
  }
  return [...unique.values()];
}

function sandboxPolicy(value: unknown, roots: string[], writableRoots: string[]): ChatGptSandboxPolicy {
  const parsed = record(value);
  if (parsed?.type === "dangerFullAccess") {
    const rootIdentities = new Set(roots.map(pathIdentity));
    if (writableRoots.length !== roots.length || writableRoots.some(path => !rootIdentities.has(pathIdentity(path)))) {
      throw new Error("Invalid persisted ChatGPT danger-full-access roots");
    }
    return { type: "dangerFullAccess" };
  }
  if (parsed?.type === "workspaceWrite") {
    if (typeof parsed.networkAccess !== "boolean" || writableRoots.some(path => !roots.some(root => contains(root, path)))) {
      throw new Error("Invalid persisted ChatGPT workspace-write policy");
    }
    return { type: "workspaceWrite", writableRoots, networkAccess: parsed.networkAccess };
  }
  if (parsed?.type === "readOnly") {
    if (typeof parsed.networkAccess !== "boolean" || writableRoots.length !== 0) {
      throw new Error("Invalid persisted ChatGPT read-only policy");
    }
    return { type: "readOnly", networkAccess: parsed.networkAccess };
  }
  throw new Error("Invalid persisted ChatGPT sandbox policy");
}

function validateStoredEnvironment(value: unknown): StoredThreadEnvironment {
  const parsed = record(value);
  if (!parsed || typeof parsed.cwd !== "string" || !isAbsolute(parsed.cwd) || typeof parsed.updatedAt !== "number") {
    throw new Error("Invalid persisted ChatGPT thread environment");
  }
  const cwd = resolve(parsed.cwd);
  const roots = absolutePaths(parsed.roots, "roots");
  const writableRoots = Array.isArray(parsed.writableRoots) && parsed.writableRoots.length === 0
    ? []
    : absolutePaths(parsed.writableRoots, "writable roots");
  if (!roots.some(root => contains(root, cwd))) throw new Error("Persisted ChatGPT cwd is outside its roots");
  return {
    cwd,
    roots,
    writableRoots,
    sandboxPolicy: sandboxPolicy(parsed.sandboxPolicy, roots, writableRoots),
    updatedAt: parsed.updatedAt,
  };
}

function authority(environment: ChatGptTurnEnvironment, updatedAt: number): StoredThreadEnvironment {
  return {
    cwd: environment.cwd,
    roots: environment.roots,
    writableRoots: environment.writableRoots,
    sandboxPolicy: environment.sandboxPolicy,
    updatedAt,
  };
}

function sameAuthority(left: ChatGptTurnEnvironment, right: ChatGptTurnEnvironment): boolean {
  const samePaths = (a: string[], b: string[]): boolean => {
    const expected = new Set(b.map(pathIdentity));
    return a.length === expected.size && a.every(path => expected.has(pathIdentity(path)));
  };
  return pathIdentity(left.cwd) === pathIdentity(right.cwd)
    && samePaths(left.roots, right.roots)
    && samePaths(left.writableRoots, right.writableRoots)
    && left.sandboxPolicy.type === right.sandboxPolicy.type
    && (left.sandboxPolicy.type === "dangerFullAccess" || (right.sandboxPolicy.type !== "dangerFullAccess"
      && left.sandboxPolicy.networkAccess === right.sandboxPolicy.networkAccess));
}

/**
 * Codex emits its trusted environment envelope when a task starts or its environment changes,
 * not on every follow-up. This store carries only that trusted authority across turns. Tool
 * declarations are always taken from the current request and are never persisted.
 */
export class ChatGptThreadEnvironmentStore {
  private readonly path?: string;
  private readonly backend: ThreadEnvironmentBackend;

  constructor(
    path?: string,
    private readonly now: () => number = Date.now,
    private readonly codexHome: string = getCodexHome(),
    private readonly sqliteHome?: string,
  ) {
    this.path = canonicalChatGptStatePath(path);
    const key = this.path ?? `memory:${resolve(codexHome)}:${sqliteHome ? resolve(sqliteHome) : "default"}`;
    let backend = threadEnvironmentBackends.get(key);
    if (!backend) {
      backend = { loaded: false, threads: new Map() };
      threadEnvironmentBackends.set(key, backend);
    }
    this.backend = backend;
  }

  resolve(parsed: CodexParsedRequest): ChatGptTurnEnvironment {
    // Hermes owns execution and approvals. The bridge itself receives no filesystem authority,
    // and its producer scope never enters the persistent native Codex environment cache.
    if (parsed._hermesContext) return {
      producer: "hermes",
      cwd: parsed._hermesContext.root, roots: [parsed._hermesContext.root], writableRoots: [],
      sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: parsed.context.tools ?? [],
    };
    const identity = extractChatGptTurnIdentity(parsed);
    try {
      const environment = extractChatGptTurnEnvironment(parsed);
      if (identity.threadId) this.set(identity.threadId, environment);
      return environment;
    } catch (error) {
      if (!(error instanceof MissingTrustedCodexEnvironmentError) || !identity.threadId) throw error;
      const trailingDelta = extractChatGptTrailingEnvironmentDeltaClaim(parsed);
      if (trailingDelta) {
        const rolloutIdentity = extractChatGptThreadSpawnLineage(parsed) ?? extractChatGptRootThreadMetadata(parsed);
        if (!rolloutIdentity || rolloutIdentity.threadId !== trailingDelta.threadId
          || identity.turnId !== trailingDelta.turnId) throw error;
        const nativeEnvironment = resolveCurrentCodexRolloutEnvironment({
          codexHome: this.codexHome,
          ...(this.sqliteHome ? { sqliteHome: this.sqliteHome } : {}),
          lineage: rolloutIdentity,
          turnId: trailingDelta.turnId,
          tools: parsed.context.tools,
        });
        if (!nativeEnvironment) throw error;
        if (trailingDelta.sandboxType !== nativeEnvironment.sandboxPolicy.type
          || (nativeEnvironment.sandboxPolicy.type === "dangerFullAccess"
            ? trailingDelta.networkAccess !== undefined
            : trailingDelta.networkAccess === undefined
              || trailingDelta.networkAccess !== nativeEnvironment.sandboxPolicy.networkAccess)) {
          throw new Error("Trailing environment delta conflicts with its current Codex rollout");
        }
        this.set(identity.threadId, nativeEnvironment);
        return nativeEnvironment;
      }
      const compactedRequest = environmentRequestAcrossCompactionSummary(parsed);
      if (compactedRequest) {
        const claim = extractChatGptTurnEnvironment(compactedRequest);
        const rolloutIdentity = extractChatGptThreadSpawnLineage(parsed) ?? extractChatGptRootThreadMetadata(parsed);
        const nativeEnvironment = rolloutIdentity && identity.turnId
          ? resolveCurrentCodexRolloutEnvironment({
            codexHome: this.codexHome,
            ...(this.sqliteHome ? { sqliteHome: this.sqliteHome } : {}),
            lineage: rolloutIdentity,
            turnId: identity.turnId,
            tools: parsed.context.tools,
          })
          : undefined;
        if (!nativeEnvironment) throw error;
        if (!sameAuthority(claim, nativeEnvironment)) {
          throw new Error("Compacted environment conflicts with its current Codex rollout");
        }
        this.set(identity.threadId, nativeEnvironment);
        return nativeEnvironment;
      }
      const hasCurrentContext = hasCurrentChatGptEnvironmentContext(parsed);
      const lineage = extractChatGptThreadSpawnLineage(parsed);
      const currentCompaction = hasCurrentContext && isChatGptCompactionContinuation(parsed);
      const historicalMessages = hasCurrentContext && !currentCompaction && lineage
        ? unattributedChatGptEnvironmentMessages(parsed) : undefined;
      const steeringClaim = hasCurrentContext && !currentCompaction
        ? extractChatGptSteeringEnvironmentClaim(parsed) : undefined;
      if (hasCurrentContext && !currentCompaction && !historicalMessages && !steeringClaim) throw error;
      const currentClaim = currentCompaction ? extractChatGptContinuationEnvironmentClaim(parsed) : steeringClaim;
      const rolloutIdentity = lineage ?? extractChatGptRootThreadMetadata(parsed);
      // Automatic compaction has a current turn_context; standalone compaction has only its
      // source turn_context. Either must be the latest native record, never an arbitrary ancestor.
      const compactionSourceTurnId = parsed._compactionRequest
        ? extractChatGptCompactionSourceRevision(parsed).turnId : undefined;
      if (rolloutIdentity && identity.turnId) {
        const rolloutEnvironment = resolveCurrentCodexRolloutEnvironment({
          codexHome: this.codexHome,
          ...(this.sqliteHome ? { sqliteHome: this.sqliteHome } : {}),
          lineage: rolloutIdentity,
          turnId: identity.turnId,
          ...(compactionSourceTurnId ? { compactionSourceTurnId } : {}),
          ...(historicalMessages ? { historicalEnvironmentMessages: historicalMessages } : {}),
          tools: parsed.context.tools,
        });
        if (rolloutEnvironment) {
          if (currentClaim && !sameAuthority(currentClaim, rolloutEnvironment)) {
            throw new Error(`${currentCompaction ? "Compaction continuation" : "Steering"} environment conflicts with its current Codex rollout`);
          }
          this.set(rolloutIdentity.threadId, rolloutEnvironment);
          return rolloutEnvironment;
        }
      }
      // History may reuse this thread's earned authority, but never masks a current invalid
      // update or authorizes inheritance from a different thread (#567).
      const hasRawContext = hasRawChatGptEnvironmentContext(parsed);
      if (hasRawContext && hasCurrentContext) throw error;
      const sameThread = this.get(identity.threadId);
      if (sameThread) return {
        cwd: sameThread.cwd,
        roots: sameThread.roots,
        writableRoots: sameThread.writableRoots,
        sandboxPolicy: sameThread.sandboxPolicy,
        tools: parsed.context.tools ?? [],
      };

      if (hasRawContext || !lineage) throw error;
      const parent = this.get(lineage.parentThreadId);
      if (!parent) throw error;
      if (lineage.sandboxType !== parent.sandboxPolicy.type) {
        throw new Error("ChatGPT Web subagent sandbox metadata conflicts with its trusted parent thread");
      }
      if (lineage.workspaceRoots.length > 0 && !lineage.workspaceRoots.some(root => contains(root, parent.cwd))) {
        throw new Error("ChatGPT Web subagent workspace metadata does not contain its trusted parent cwd");
      }
      if (lineage.workspaceRoots.some(root => !parent.roots.some(parentRoot => (
        contains(parentRoot, root) || contains(root, parentRoot)
      )))) {
        throw new Error("ChatGPT Web subagent workspace metadata conflicts with its trusted parent roots");
      }
      const inherited: ChatGptTurnEnvironment = {
        cwd: parent.cwd,
        roots: parent.roots,
        writableRoots: parent.writableRoots,
        sandboxPolicy: parent.sandboxPolicy,
        tools: parsed.context.tools ?? [],
      };
      this.set(lineage.threadId, inherited);
      return inherited;
    }
  }

  private get(threadId: string): StoredThreadEnvironment | undefined {
    this.load(true);
    const stored = this.backend.threads.get(threadId);
    if (!stored) return undefined;
    if (this.now() - stored.updatedAt > THREAD_ENVIRONMENT_TTL_MS) {
      const next = new Map(this.backend.threads);
      next.delete(threadId);
      this.persist(next);
      return undefined;
    }
    return stored;
  }

  private set(threadId: string, environment: ChatGptTurnEnvironment): void {
    this.load(true);
    const next = new Map(this.backend.threads);
    next.delete(threadId);
    next.set(threadId, authority(environment, this.now()));
    while (next.size > MAX_THREAD_ENVIRONMENTS) {
      const oldest = next.keys().next().value as string | undefined;
      if (!oldest) break;
      next.delete(oldest);
    }
    this.persist(next);
  }

  private readFile(): Map<string, StoredThreadEnvironment> {
    if (!this.path || !existsSync(this.path)) return new Map();
    const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<StoredThreadEnvironmentFile>;
    const rawThreads = record(parsed.threads);
    if (parsed.version !== 1 || !rawThreads) {
      throw new Error(`Invalid ChatGPT thread environment store: ${this.path}`);
    }
    const cutoff = this.now() - THREAD_ENVIRONMENT_TTL_MS;
    const entries = Object.entries(rawThreads)
      .map(([threadId, value]) => [threadId, validateStoredEnvironment(value)] as const)
      .filter(([, environment]) => environment.updatedAt >= cutoff)
      .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
      .slice(-MAX_THREAD_ENVIRONMENTS);
    return new Map<string, StoredThreadEnvironment>(entries);
  }

  private merge(...sources: ReadonlyMap<string, StoredThreadEnvironment>[]): Map<string, StoredThreadEnvironment> {
    const cutoff = this.now() - THREAD_ENVIRONMENT_TTL_MS;
    const merged = new Map<string, StoredThreadEnvironment>();
    for (const source of sources) for (const [threadId, environment] of source) {
      if (environment.updatedAt < cutoff) continue;
      const current = merged.get(threadId);
      if (!current || current.updatedAt <= environment.updatedAt) merged.set(threadId, environment);
    }
    return new Map([...merged].sort((left, right) => left[1].updatedAt - right[1].updatedAt)
      .slice(-MAX_THREAD_ENVIRONMENTS));
  }

  private load(refresh = false): void {
    if (this.backend.loaded && (!refresh || !this.path)) return;
    this.backend.threads = this.merge(this.backend.threads, this.readFile());
    this.backend.loaded = true;
  }

  private persist(threads: Map<string, StoredThreadEnvironment>): void {
    if (!this.path) {
      this.backend.threads = this.merge(threads);
      this.backend.loaded = true;
      return;
    }
    withChatGptStateFileLock(this.path, () => {
      const merged = this.merge(this.readFile(), this.backend.threads, threads);
      const payload: StoredThreadEnvironmentFile = {
        version: 1,
        threads: Object.fromEntries(merged),
      };
      atomicWriteFile(this.path!, `${JSON.stringify(payload, null, 2)}\n`);
      this.backend.threads = merged;
      this.backend.loaded = true;
    });
  }
}
