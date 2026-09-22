import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { atomicWriteFile } from "../../config";
import { getCodexHome } from "../../codex-integration-shared";
import type { CodexParsedRequest } from "../../types";
import type { ChatGptSandboxPolicy, ChatGptTurnEnvironment } from "./environment";
import { resolveCurrentCodexRolloutEnvironment } from "./codex-rollout-environment";
import { resolveThreadEnvironment, pathIdentity, contains } from "./thread-environment-resolver";
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
    const decision = resolveThreadEnvironment(parsed, {
      readCache: threadId => this.get(threadId),
      resolveRollout: options => resolveCurrentCodexRolloutEnvironment({
        ...options, codexHome: this.codexHome,
        ...(this.sqliteHome ? { sqliteHome: this.sqliteHome } : {}),
      }),
    });
    if (decision.persistForThreadId) this.set(decision.persistForThreadId, decision.environment);
    return decision.environment;
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
