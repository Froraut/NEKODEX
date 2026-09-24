import { existsSync, readFileSync } from "node:fs";
import { atomicWriteFile } from "../../config";
import type { CodexParsedRequest } from "../../types";
import { extractChatGptTurnIdentity } from "./environment";
import { canonicalChatGptStatePath, withChatGptStateFileLock } from "./state-file-lock";
import { hashChatGptLunaAnswer, parseChatGptLunaCheckpoint, type CapturedChatGptLunaCheckpoint } from "./rolling-checkpoint-format";
import { analyzeLunaCheckpointProjection, projectLunaCheckpoint } from "./rolling-checkpoint-projection";
export * from "./rolling-checkpoint-format";

interface StoredChatGptLunaCheckpoint extends CapturedChatGptLunaCheckpoint {
  threadId: string;
  sourceTurnId: string;
  updatedAt: number;
}

interface StoredChatGptLunaCheckpointFile {
  version: 1;
  checkpoints: StoredChatGptLunaCheckpoint[];
}

const MAX_STORED_CHECKPOINTS = 512;
const CHECKPOINT_TTL_MS = 30 * 24 * 60 * 60_000;

interface LunaCheckpointBackend {
  loaded: boolean;
  checkpoints: Map<string, StoredChatGptLunaCheckpoint>;
}

const lunaCheckpointBackends = new Map<string, LunaCheckpointBackend>();

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function checkpointKey(threadId: string, answerHash: string): string {
  return `${threadId}\u0000${answerHash}`;
}

function validateStoredCheckpoint(value: unknown): StoredChatGptLunaCheckpoint {
  const parsed = record(value);
  if (!parsed
    || typeof parsed.threadId !== "string"
    || typeof parsed.sourceTurnId !== "string"
    || typeof parsed.answerHash !== "string"
    || !/^[a-f0-9]{64}$/.test(parsed.answerHash)
    || typeof parsed.updatedAt !== "number") {
    throw new Error("Invalid persisted ChatGPT Luna checkpoint metadata");
  }
  return {
    threadId: parsed.threadId,
    sourceTurnId: parsed.sourceTurnId,
    answerHash: parsed.answerHash,
    checkpoint: parseChatGptLunaCheckpoint(parsed.checkpoint),
    updatedAt: parsed.updatedAt,
  };
}

/** Exact-parent, per-thread checkpoint store. Full Codex history remains canonical on mismatch. */
export class ChatGptLunaCheckpointStore {
  private readonly path?: string;
  private readonly backend: LunaCheckpointBackend;

  constructor(
    path?: string,
    private readonly now: () => number = Date.now,
    private readonly writeFile: typeof atomicWriteFile = atomicWriteFile,
  ) {
    this.path = canonicalChatGptStatePath(path);
    const key = this.path ?? "memory:luna-checkpoints";
    let backend = lunaCheckpointBackends.get(key);
    if (!backend) {
      backend = { loaded: false, checkpoints: new Map() };
      lunaCheckpointBackends.set(key, backend);
    }
    this.backend = backend;
  }

  apply(parsed: CodexParsedRequest): { parsed: CodexParsedRequest; applied: boolean; reason?: string } {
    const identity = extractChatGptTurnIdentity(parsed);
    if (!identity.threadId || !identity.turnId) return { parsed, applied: false, reason: "missing native thread identity" };
    const projection = analyzeLunaCheckpointProjection(parsed, identity.turnId);
    if (!projection) return { parsed, applied: false, reason: "no proven completed parent assistant answer" };

    const { parent } = projection;
    const parentHash = hashChatGptLunaAnswer(parent.answer);
    const stored = this.get(identity.threadId, parentHash);
    if (!stored) return { parsed, applied: false, reason: "no checkpoint for the exact parent answer" };
    if (stored.sourceTurnId !== parent.turnId) {
      return { parsed, applied: false, reason: "checkpoint source turn does not match the exact parent answer" };
    }

    if (!projection.currentInput.length) {
      return { parsed, applied: false, reason: "current native turn boundary is unavailable" };
    }
    return { parsed: projectLunaCheckpoint(parsed, identity.turnId, stored.checkpoint, projection), applied: true };
  }

  commit(parsed: CodexParsedRequest, captured: CapturedChatGptLunaCheckpoint, answer: string): void {
    const identity = extractChatGptTurnIdentity(parsed);
    if (!identity.threadId || !identity.turnId) {
      throw new Error("ChatGPT Luna rolling checkpoint requires native thread_id and turn_id metadata");
    }
    const checkpoint = parseChatGptLunaCheckpoint(captured.checkpoint);
    const answerHash = hashChatGptLunaAnswer(answer);
    if (captured.answerHash !== answerHash) {
      throw new Error("ChatGPT Luna rolling checkpoint answer hash does not match the completed browser answer");
    }
    this.load(true);
    const stored: StoredChatGptLunaCheckpoint = {
      threadId: identity.threadId,
      sourceTurnId: identity.turnId,
      answerHash,
      checkpoint,
      updatedAt: this.now(),
    };
    const key = checkpointKey(identity.threadId, answerHash);
    const candidate = new Map(this.backend.checkpoints);
    candidate.delete(key);
    candidate.set(key, stored);
    this.persist(candidate);
  }

  private get(threadId: string, answerHash: string): StoredChatGptLunaCheckpoint | undefined {
    this.load(true);
    this.prune();
    return this.backend.checkpoints.get(checkpointKey(threadId, answerHash));
  }

  private prune(): void {
    const cutoff = this.now() - CHECKPOINT_TTL_MS;
    for (const [key, checkpoint] of this.backend.checkpoints) {
      if (checkpoint.updatedAt < cutoff) this.backend.checkpoints.delete(key);
    }
    while (this.backend.checkpoints.size > MAX_STORED_CHECKPOINTS) {
      const oldest = this.backend.checkpoints.keys().next().value as string | undefined;
      if (!oldest) break;
      this.backend.checkpoints.delete(oldest);
    }
  }

  private readFile(): Map<string, StoredChatGptLunaCheckpoint> {
    if (!this.path || !existsSync(this.path)) return new Map();
    const payload = JSON.parse(readFileSync(this.path, "utf8")) as Partial<StoredChatGptLunaCheckpointFile>;
    if (!payload || payload.version !== 1 || !Array.isArray(payload.checkpoints)) {
      throw new Error(`Invalid ChatGPT Luna checkpoint store: ${this.path}`);
    }
    const checkpoints = payload.checkpoints
      .map(validateStoredCheckpoint)
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(-MAX_STORED_CHECKPOINTS);
    const loadedCheckpoints = new Map<string, StoredChatGptLunaCheckpoint>();
    for (const checkpoint of checkpoints) {
      loadedCheckpoints.set(checkpointKey(checkpoint.threadId, checkpoint.answerHash), checkpoint);
    }
    return loadedCheckpoints;
  }

  private merge(...sources: ReadonlyMap<string, StoredChatGptLunaCheckpoint>[]): Map<string, StoredChatGptLunaCheckpoint> {
    const cutoff = this.now() - CHECKPOINT_TTL_MS;
    const merged = new Map<string, StoredChatGptLunaCheckpoint>();
    for (const source of sources) for (const [key, checkpoint] of source) {
      if (checkpoint.updatedAt < cutoff) continue;
      const current = merged.get(key);
      if (!current || current.updatedAt <= checkpoint.updatedAt) merged.set(key, checkpoint);
    }
    return new Map([...merged].sort((left, right) => left[1].updatedAt - right[1].updatedAt)
      .slice(-MAX_STORED_CHECKPOINTS));
  }

  private load(refresh = false): void {
    if (this.backend.loaded && (!refresh || !this.path)) return;
    this.backend.checkpoints = this.merge(this.backend.checkpoints, this.readFile());
    this.backend.loaded = true;
    this.prune();
  }

  private persist(candidate: ReadonlyMap<string, StoredChatGptLunaCheckpoint>): void {
    if (!this.path) {
      this.backend.checkpoints = this.merge(candidate);
      this.backend.loaded = true;
      return;
    }
    withChatGptStateFileLock(this.path, () => {
      const merged = this.merge(this.readFile(), candidate);
      const payload: StoredChatGptLunaCheckpointFile = {
        version: 1,
        checkpoints: [...merged.values()],
      };
      this.writeFile(this.path!, `${JSON.stringify(payload, null, 2)}\n`);
      this.backend.checkpoints = merged;
      this.backend.loaded = true;
    });
  }
}
