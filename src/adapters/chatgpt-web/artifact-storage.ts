import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { lstat, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { sanitizeCodexFileName } from "../../responses/file-content";
import { artifactMimeType } from "./artifact-format";

export const CHATGPT_ARTIFACT_MAX_BYTES = 50_000_000;
export const CHATGPT_ARTIFACT_MAX_COUNT = 10;
export const CHATGPT_ARTIFACT_MANIFEST_MAX_BYTES = 1024 * 1024;

export interface ChatGptArtifact {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
  source: {
    provider: "chatgpt.com";
    traceId: string;
    assistantTurnId: string;
    downloadAuthority: "chatgpt.com" | "oaiusercontent.com" | "chatgpt-blob" | "chatgpt-sandbox";
  };
}

export interface ChatGptArtifactManifest {
  version: 1;
  artifacts: ChatGptArtifact[];
}

export async function digestFile(path: string, maxAcceptedBytes = CHATGPT_ARTIFACT_MAX_BYTES): Promise<{ size: number; sha256: string; firstBytes: Buffer }> {
  const hash = createHash("sha256");
  let size = 0;
  let firstBytes = Buffer.alloc(0);
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (firstBytes.length < 16) firstBytes = Buffer.concat([firstBytes, bytes]).subarray(0, 16);
    size += bytes.length;
    if (size > maxAcceptedBytes) throw new Error("Downloaded ChatGPT artifact exceeds the post-download acceptance limit");
    hash.update(bytes);
  }
  if (size === 0) throw new Error("Downloaded ChatGPT artifact is empty");
  return { size, sha256: hash.digest("hex"), firstBytes };
}

/** Only acquisition may hand off a partial after validating transport authority. */
export interface ArtifactStorageTransaction {
  readonly signal: AbortSignal;
  race<T>(promise: Promise<T>): Promise<T>;
}

export async function promoteOwnedArtifact(
  partial: string,
  directory: string,
  expectedName: string,
  measured: { size: number; sha256: string; firstBytes: Buffer },
  transaction: ArtifactStorageTransaction,
  maxAcceptedBytes: number,
): Promise<Omit<ChatGptArtifact, "source">> {
  if (transaction.signal.aborted) throw transaction.signal.reason;
  const { size, sha256 } = measured;
  const mimeType = await transaction.race(artifactMimeType(expectedName, partial, measured.firstBytes));
  const extension = extname(expectedName);
  const stem = basename(expectedName, extension).slice(0, 100).replace(/[^\p{L}\p{N}._-]+/gu, "-") || "artifact";
  const finalPath = join(directory, `${stem}--${sha256.slice(0, 16)}${extension.toLowerCase()}`);
  if (existsSync(finalPath)) {
    const existingInfo = await lstat(finalPath);
    if (!existingInfo.isFile() || existingInfo.isSymbolicLink()) {
      throw new Error(`Existing ChatGPT artifact path is not a regular owned file: ${finalPath}`);
    }
    const existing = await transaction.race(digestFile(finalPath, maxAcceptedBytes));
    if (existing.sha256 !== sha256 || existing.size !== size) {
      throw new Error(`Existing ChatGPT artifact path failed its digest check: ${finalPath}`);
    }
    await rm(partial, { force: true });
  } else {
    await transaction.race(rename(partial, finalPath));
  }
  return { name: expectedName, path: finalPath, mimeType, size, sha256 };
}

export async function verifiedManifest(directory: string, traceId: string, assistantTurnId: string): Promise<ChatGptArtifact[] | undefined> {
  const manifestPath = join(directory, "manifest.json");
  let manifestInfo;
  try { manifestInfo = await lstat(manifestPath); }
  catch { return undefined; }
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) {
    throw new Error("ChatGPT artifact manifest must be a regular owned file");
  }
  if (manifestInfo.size > CHATGPT_ARTIFACT_MANIFEST_MAX_BYTES) {
    throw new Error("ChatGPT artifact manifest exceeds the 1 MB limit");
  }
  let parsed: ChatGptArtifactManifest;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8")) as ChatGptArtifactManifest;
  } catch {
    return undefined;
  }
  if (parsed.version !== 1 || !Array.isArray(parsed.artifacts) || parsed.artifacts.length > CHATGPT_ARTIFACT_MAX_COUNT) return undefined;
  const realDirectory = await realpath(directory);
  for (const artifact of parsed.artifacts) {
    if (artifact.source?.provider !== "chatgpt.com" || artifact.source.traceId !== traceId
      || artifact.source.assistantTurnId !== assistantTurnId
      || !["chatgpt.com", "oaiusercontent.com", "chatgpt-blob", "chatgpt-sandbox"].includes(artifact.source.downloadAuthority)
      || typeof artifact.path !== "string" || dirname(resolve(artifact.path)) !== resolve(directory)
      || typeof artifact.name !== "string" || sanitizeCodexFileName(artifact.name) !== artifact.name
      || !Number.isInteger(artifact.size) || artifact.size <= 0 || artifact.size > CHATGPT_ARTIFACT_MAX_BYTES
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)) return undefined;
    const fileInfo = await lstat(artifact.path).catch(() => undefined);
    if (!fileInfo || !fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.size !== artifact.size) {
      throw new Error(`ChatGPT artifact manifest points to a non-owned or changed file: ${artifact.path}`);
    }
    const realArtifact = await realpath(artifact.path);
    if (dirname(realArtifact) !== realDirectory) {
      throw new Error(`ChatGPT artifact manifest escapes its task directory: ${artifact.path}`);
    }
    const measured = await digestFile(artifact.path).catch(() => undefined);
    if (!measured || measured.size !== artifact.size || measured.sha256 !== artifact.sha256
      || await artifactMimeType(artifact.name, artifact.path, measured.firstBytes) !== artifact.mimeType) return undefined;
  }
  return parsed.artifacts;
}
