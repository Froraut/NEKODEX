import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { Download, Locator, Page } from "playwright-core";
import { getConfigDir } from "../../config";
import { sanitizeCodexFileName } from "../../responses/file-content";

export const CHATGPT_ARTIFACT_MAX_BYTES = 50_000_000;
export const CHATGPT_ARTIFACT_MAX_COUNT = 10;
export const CHATGPT_ARTIFACT_TRANSACTION_TIMEOUT_MS = 60_000;
export const CHATGPT_ARTIFACT_MANIFEST_MAX_BYTES = 1024 * 1024;

const OUTPUT_MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".xls": "application/vnd.ms-excel",
};

export interface ChatGptArtifactAcquisitionOptions {
  /** Test seam may lower, never raise, the production transaction deadline. */
  transactionTimeoutMs?: number;
  /** Test seam may lower, never raise, the post-download acceptance limit. */
  maxAcceptedBytes?: number;
  networkGuard?: ChatGptArtifactNetworkGuard;
  /** Trusted launcher-derived CORE_HOME/artifacts/<traceId>; required with networkGuard. */
  taskDirectory?: string;
}

export interface ChatGptArtifactNetworkReceipt {
  leaseId: string;
  traceId: string;
  assistantTurnId: string;
  filename: string;
  partialPath: string;
  receivedBytes: number;
  downloadAuthority: ChatGptArtifact["source"]["downloadAuthority"];
}

export interface ChatGptArtifactNetworkGuard {
  register(input: {
    assistantTurnId: string;
    expectedFilename: string;
    maxBytes: number;
    deadlineMs: number;
  }): Promise<{ leaseId: string }>;
  wait(leaseId: string): Promise<ChatGptArtifactNetworkReceipt>;
  cancel(leaseId: string, reason: Error): Promise<void>;
}

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

interface ChatGptArtifactManifest {
  version: 1;
  artifacts: ChatGptArtifact[];
}

function outputDirectory(traceId: string): string {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(traceId)) throw new Error("ChatGPT artifact trace identity is invalid");
  return join(getConfigDir(), "artifacts", traceId);
}

async function ensureArtifactDirectory(traceId: string, configuredDirectory?: string): Promise<string> {
  const directory = configuredDirectory ? resolve(configuredDirectory) : outputDirectory(traceId);
  const root = dirname(directory);
  if (basename(root) !== "artifacts" || basename(directory) !== traceId || directory !== join(root, traceId)) {
    throw new Error("ChatGPT artifact task directory is not bound to its trace identity");
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("ChatGPT artifact root must be a real owned directory");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("ChatGPT artifact task directory must be a real owned directory");
  }
  return directory;
}

function visibleArtifactName(label: string): string {
  const compact = label.replace(/\s+/g, " ").trim();
  if (!compact) throw new Error("ChatGPT exposed a file control without a visible filename");
  const withoutObservedActionPrefix = compact.startsWith("Download ") ? compact.slice("Download ".length) : compact;
  return sanitizeCodexFileName(basename(withoutObservedActionPrefix));
}

async function responseArtifactControls(responseTurn: Locator): Promise<Array<{ control: Locator; card: Locator; name: string }>> {
  // The observed generated-file card owns a distinct `Download file` button. The inline
  // `Download <filename>` entity button opens a preview and is deliberately excluded, as is the
  // page-global preview-pane `Download` action. Keep every search inside this exact assistant turn.
  const actions = responseTurn.getByRole("button", { name: "Download file", exact: true }).filter({ visible: true });
  const count = await actions.count();
  if (count > CHATGPT_ARTIFACT_MAX_COUNT) {
    throw new Error(`ChatGPT response exposed ${count} generated-file card actions; the safe limit is ${CHATGPT_ARTIFACT_MAX_COUNT}`);
  }
  const controls: Array<{ control: Locator; card: Locator; name: string }> = [];
  for (let index = 0; index < count; index++) {
    const control = actions.nth(index);
    const binding = await control.evaluate((action) => {
      const rendered = (candidate: HTMLElement): boolean => {
        const style = getComputedStyle(candidate);
        return candidate.isConnected && style.display !== "none" && style.visibility !== "hidden"
          && style.opacity !== "0" && !candidate.hidden && candidate.getAttribute("aria-hidden") !== "true";
      };
      const fileName = /[^/\\\s][^/\\]{0,159}\.(?:pdf|txt|md|csv|tsv|json|png|jpe?g|gif|webp|zip|xlsx|docx|pptx|ods|xls)$/i;
      let ancestor = action.parentElement;
      for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
        const candidates = [...ancestor.querySelectorAll<HTMLElement>("button")]
          .filter(candidate => candidate !== action && rendered(candidate))
          .map(candidate => (candidate.innerText || candidate.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
          .filter(value => fileName.test(value));
        if (candidates.length === 1) return { label: candidates[0], depth: depth + 1 };
        if (candidates.length > 1) return null;
      }
      return null;
    });
    if (!binding) throw new Error("ChatGPT generated-file card did not expose one exact filename beside its Download file action");
    let card = control;
    for (let depth = 0; depth < binding.depth; depth++) card = card.locator("xpath=..");
    controls.push({ control, card, name: visibleArtifactName(binding.label) });
  }
  return controls;
}

function trustedChatGptPage(page: Page): void {
  let url: URL;
  try { url = new URL(page.url()); }
  catch { throw new Error("ChatGPT artifact acquisition requires a valid bound page URL"); }
  if (url.protocol !== "https:" || url.origin !== "https://chatgpt.com") {
    throw new Error(`ChatGPT artifact acquisition refused untrusted bound page origin ${JSON.stringify(url.origin)}`);
  }
}

function trustedDownloadAuthority(raw: string): ChatGptArtifact["source"]["downloadAuthority"] {
  if (raw.startsWith("sandbox:/")) return "chatgpt-sandbox";
  if (raw.startsWith("blob:https://chatgpt.com/")) return "chatgpt-blob";
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("ChatGPT artifact download did not expose a supported authoritative URL"); }
  if (url.protocol !== "https:") {
    throw new Error(`ChatGPT artifact download scheme ${JSON.stringify(url.protocol)} is unsupported`);
  }
  if (url.hostname === "chatgpt.com") return "chatgpt.com";
  if (url.hostname === "oaiusercontent.com" || url.hostname.endsWith(".oaiusercontent.com")) {
    return "oaiusercontent.com";
  }
  throw new Error(`ChatGPT artifact download origin ${JSON.stringify(url.origin)} is not trusted`);
}

function artifactStageError(stage: "card-hover" | "register" | "click" | "host-wait" | "receipt" | "promotion", error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const timeout = source.name === "TimeoutError" || /timed? out|timeout/i.test(source.message);
  const owner = /owner|ownership|surface/i.test(source.message);
  const deadline = /deadline/i.test(source.message);
  const suffix = timeout ? "timeout" : owner ? "owner" : deadline ? "deadline" : "failed";
  const code = `artifact_${stage.replace("-", "_")}_${suffix}`;
  return new Error(`ChatGPT artifact acquisition failed at ${stage} [${code}]`, { cause: source });
}

interface DownloadTransaction {
  readonly signal: AbortSignal;
  bind(download: Download): void;
  race<T>(promise: Promise<T>): Promise<T>;
  cancel(reason: Error): Promise<void>;
  dispose(): void;
}

function downloadTransaction(
  abortSignal: AbortSignal | undefined,
  timeoutMs: number,
): DownloadTransaction {
  const controller = new AbortController();
  let download: Download | undefined;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const abort = (reason: Error) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    rejectAbort(reason);
    if (download) void download.cancel().catch(() => {});
  };
  const onExternalAbort = () => abort(
    abortSignal?.reason instanceof Error
      ? abortSignal.reason
      : new DOMException("ChatGPT artifact acquisition aborted", "AbortError"),
  );
  abortSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (abortSignal?.aborted) onExternalAbort();
  const timer = setTimeout(() => abort(new Error(`ChatGPT artifact download transaction exceeded ${timeoutMs} ms`)), timeoutMs);
  return {
    signal: controller.signal,
    bind(value) {
      download = value;
      if (controller.signal.aborted) void value.cancel().catch(() => {});
    },
    race: promise => Promise.race([promise, aborted]),
    async cancel(reason) {
      abort(reason);
      if (download) await download.cancel().catch(() => {});
    },
    dispose() {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

export async function writeAllArtifactBytes(
  handle: Pick<FileHandle, "write">,
  bytes: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.length - offset) {
      throw new Error("ChatGPT artifact file write reported invalid progress");
    }
    offset += bytesWritten;
  }
}

function findZipEndOfCentralDirectory(bytes: Buffer): number {
  const first = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= first; offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function validateZipEntryName(raw: Buffer): string {
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new Error("ZIP artifact contains a non-UTF-8 entry name");
  }
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/")
    || /^[A-Za-z]:/.test(name) || name.split("/").some(part => part === ".." || part === ".")) {
    throw new Error(`ZIP artifact contains an unsafe entry name: ${JSON.stringify(name)}`);
  }
  return name;
}

/** Structural validation only. Archives remain inert and are never extracted. */
export function validateChatGptZipContainer(bytes: Buffer, extension: string): void {
  const eocd = findZipEndOfCentralDirectory(bytes);
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error("ZIP artifact has no bounded end-of-central-directory record");
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount > 10_000
    || centralOffset + centralSize !== eocd || eocd + 22 + commentLength !== bytes.length) {
    throw new Error("ZIP artifact uses an unsupported multi-disk, ZIP64, excessive, or inconsistent directory");
  }

  const names = new Set<string>();
  let offset = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP artifact central directory is malformed");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const entryCommentLength = bytes.readUInt16LE(offset + 32);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + entryCommentLength;
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (flags & 0x1 || unixType === 0xa000 || ![0, 8].includes(method) || next > eocd
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
      || localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("ZIP artifact contains encrypted, unsupported, ZIP64, or malformed entries");
    }
    const name = validateZipEntryName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localDataStart = localNameStart + localNameLength + localExtraLength;
    if (localDataStart + compressedSize > centralOffset
      || !bytes.subarray(localNameStart, localNameStart + localNameLength)
        .equals(bytes.subarray(offset + 46, offset + 46 + nameLength))) {
      throw new Error("ZIP artifact local entry does not match its central directory");
    }
    if (names.has(name)) throw new Error(`ZIP artifact contains duplicate entry ${JSON.stringify(name)}`);
    names.add(name);
    expandedBytes += uncompressedSize;
    if (expandedBytes > 500_000_000 || (compressedSize > 0 && uncompressedSize / compressedSize > 200)) {
      throw new Error("ZIP artifact declares an excessive expanded size or compression ratio");
    }
    offset = next;
  }
  if (offset !== eocd) throw new Error("ZIP artifact central directory length is inconsistent");

  const required = extension === ".xlsx"
    ? ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"]
    : extension === ".docx"
    ? ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]
    : extension === ".pptx"
    ? ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"]
    : extension === ".ods"
    ? ["mimetype", "content.xml"]
    : [];
  if (required.some(name => !names.has(name))) {
    throw new Error(`${extension} artifact is missing required Office container entries`);
  }
}

async function artifactMimeType(name: string, path: string, firstBytes: Uint8Array): Promise<string> {
  const extension = extname(name).toLowerCase();
  const mimeType = OUTPUT_MIME_TYPES[extension];
  if (!mimeType) throw new Error(`Downloaded ChatGPT artifact ${JSON.stringify(name)} has an unsupported output type`);
  const bytes = Buffer.from(firstBytes);
  const matches = mimeType === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/gif" ? ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
    : mimeType === "image/webp" ? bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP"
    : mimeType === "application/vnd.ms-excel" ? bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    : mimeType === "application/zip" || [".xlsx", ".docx", ".pptx", ".ods"].includes(extension)
    ? bytes.length >= 4 && [0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0))
    : !bytes.includes(0);
  if (!matches) throw new Error(`Downloaded ChatGPT artifact ${JSON.stringify(name)} bytes do not match ${mimeType}`);
  if (extension === ".json") {
    try { JSON.parse(await readFile(path, "utf8")); }
    catch { throw new Error(`Downloaded ChatGPT artifact ${JSON.stringify(name)} is not valid JSON`); }
  }
  if ([".zip", ".xlsx", ".docx", ".pptx", ".ods"].includes(extension)) {
    validateChatGptZipContainer(await readFile(path), extension);
  }
  return mimeType;
}

async function digestFile(path: string, maxAcceptedBytes = CHATGPT_ARTIFACT_MAX_BYTES): Promise<{ size: number; sha256: string; firstBytes: Buffer }> {
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

async function saveBoundedDownload(
  download: Download,
  directory: string,
  expectedName: string,
  transaction: DownloadTransaction,
  maxAcceptedBytes: number,
): Promise<Omit<ChatGptArtifact, "source">> {
  const suggested = sanitizeCodexFileName(download.suggestedFilename());
  if (suggested !== expectedName) {
    throw new Error(`ChatGPT artifact label ${JSON.stringify(expectedName)} does not match downloaded file ${JSON.stringify(suggested)}`);
  }
  const partial = join(directory, `.${randomUUID()}.partial`);
  let handle: FileHandle | undefined;
  let size = 0;
  const hash = createHash("sha256");
  let firstBytes = Buffer.alloc(0);
  try {
    // Playwright's server-side Artifact.stream waits for localPathAfterFinished. The transaction
    // deadline can cancel that browser transfer, but byte counting below is explicitly a
    // post-download acceptance check. Live network byte enforcement requires the Electron
    // DownloadItem guard described by the launcher integration contract.
    const stream = await transaction.race(download.createReadStream());
    if (!stream) throw new Error(`ChatGPT artifact ${JSON.stringify(expectedName)} did not expose downloadable bytes`);
    const onAbort = () => stream.destroy(
      transaction.signal.reason instanceof Error
        ? transaction.signal.reason
        : new DOMException("ChatGPT artifact acquisition aborted", "AbortError"),
    );
    transaction.signal.addEventListener("abort", onAbort, { once: true });
    handle = await transaction.race(open(partial, "wx", 0o600));
    for await (const chunk of stream) {
      if (transaction.signal.aborted) throw transaction.signal.reason;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxAcceptedBytes) {
        throw new Error("Downloaded ChatGPT artifact exceeds the post-download acceptance limit");
      }
      if (firstBytes.length < 16) firstBytes = Buffer.concat([firstBytes, bytes]).subarray(0, 16);
      hash.update(bytes);
      await transaction.race(writeAllArtifactBytes(handle, bytes));
    }
    transaction.signal.removeEventListener("abort", onAbort);
    await transaction.race(handle.sync());
    await handle.close();
    handle = undefined;
    const failure = await transaction.race(download.failure());
    if (failure) throw new Error(`ChatGPT artifact download failed: ${failure}`);

    if (size === 0) throw new Error(`Downloaded ChatGPT artifact ${JSON.stringify(expectedName)} is empty`);
    const sha256 = hash.digest("hex");
    const mimeType = await transaction.race(artifactMimeType(expectedName, partial, firstBytes));
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
  } catch (error) {
    await transaction.cancel(error instanceof Error ? error : new Error(String(error)));
    await handle?.close().catch(() => {});
    await rm(partial, { force: true }).catch(() => {});
    throw error;
  }
}

async function promoteGuardedDownload(
  receipt: ChatGptArtifactNetworkReceipt,
  directory: string,
  expectedName: string,
  expectedTraceId: string,
  expectedAssistantTurnId: string,
  expectedAuthority: ChatGptArtifact["source"]["downloadAuthority"] | undefined,
  transaction: DownloadTransaction,
  maxAcceptedBytes: number,
): Promise<Omit<ChatGptArtifact, "source">> {
  const partial = resolve(receipt.partialPath);
  try {
    if (receipt.traceId !== expectedTraceId || receipt.assistantTurnId !== expectedAssistantTurnId
      || receipt.filename !== expectedName || (expectedAuthority !== undefined && receipt.downloadAuthority !== expectedAuthority)
      || !["chatgpt.com", "oaiusercontent.com", "chatgpt-blob", "chatgpt-sandbox"].includes(receipt.downloadAuthority)
      || !Number.isInteger(receipt.receivedBytes) || receipt.receivedBytes <= 0
      || receipt.receivedBytes > maxAcceptedBytes || dirname(partial) !== resolve(directory)) {
      throw new Error("Launcher artifact receipt does not match the bound ChatGPT response download");
    }
    const info = await transaction.race(lstat(partial));
    if (!info.isFile() || info.isSymbolicLink() || info.size !== receipt.receivedBytes) {
      throw new Error("Launcher artifact receipt does not identify a complete task-owned file");
    }
    const realDirectory = await transaction.race(realpath(directory));
    if (dirname(await transaction.race(realpath(partial))) !== realDirectory) {
      throw new Error("Launcher artifact receipt escapes its task directory");
    }
    const measured = await transaction.race(digestFile(partial, maxAcceptedBytes));
    if (measured.size !== receipt.receivedBytes) {
      throw new Error("Launcher artifact receipt byte count changed before validation");
    }
    const mimeType = await transaction.race(artifactMimeType(expectedName, partial, measured.firstBytes));
    const extension = extname(expectedName);
    const stem = basename(expectedName, extension).slice(0, 100).replace(/[^\p{L}\p{N}._-]+/gu, "-") || "artifact";
    const finalPath = join(directory, `${stem}--${measured.sha256.slice(0, 16)}${extension.toLowerCase()}`);
    if (existsSync(finalPath)) {
      const existingInfo = await lstat(finalPath);
      if (!existingInfo.isFile() || existingInfo.isSymbolicLink()) {
        throw new Error(`Existing ChatGPT artifact path is not a regular owned file: ${finalPath}`);
      }
      const existing = await transaction.race(digestFile(finalPath, maxAcceptedBytes));
      if (existing.sha256 !== measured.sha256 || existing.size !== measured.size) {
        throw new Error(`Existing ChatGPT artifact path failed its digest check: ${finalPath}`);
      }
      await rm(partial, { force: true });
    } else {
      await transaction.race(rename(partial, finalPath));
    }
    return {
      name: expectedName,
      path: finalPath,
      mimeType,
      size: measured.size,
      sha256: measured.sha256,
    };
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    throw error;
  }
}

async function verifiedManifest(directory: string, traceId: string, assistantTurnId: string): Promise<ChatGptArtifact[] | undefined> {
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

/** Acquire only exact, visible file controls owned by the bound completed assistant turn. */
export async function acquireChatGptResponseArtifacts(
  page: Page,
  responseTurn: Locator,
  traceId: string,
  assistantTurnId: string,
  abortSignal?: AbortSignal,
  options: ChatGptArtifactAcquisitionOptions = {},
): Promise<ChatGptArtifact[]> {
  trustedChatGptPage(page);
  if (options.networkGuard && !options.taskDirectory) {
    throw new Error("Launcher artifact network guard requires its host-derived task directory");
  }
  const directory = await ensureArtifactDirectory(traceId, options.taskDirectory);
  const previous = await verifiedManifest(directory, traceId, assistantTurnId);
  if (previous) return previous;

  const controls = await responseArtifactControls(responseTurn);
  if (controls.length === 0) return [];

  const artifacts: ChatGptArtifact[] = [];
  const timeoutMs = Math.min(
    CHATGPT_ARTIFACT_TRANSACTION_TIMEOUT_MS,
    Number.isFinite(options.transactionTimeoutMs) && options.transactionTimeoutMs! > 0
      ? options.transactionTimeoutMs! : CHATGPT_ARTIFACT_TRANSACTION_TIMEOUT_MS,
  );
  const maxAcceptedBytes = Math.min(
    CHATGPT_ARTIFACT_MAX_BYTES,
    Number.isFinite(options.maxAcceptedBytes) && options.maxAcceptedBytes! > 0
      ? options.maxAcceptedBytes! : CHATGPT_ARTIFACT_MAX_BYTES,
  );
  try {
    for (const artifactControl of controls) {
      if (abortSignal?.aborted) throw new DOMException("ChatGPT artifact acquisition aborted", "AbortError");
      const transaction = downloadTransaction(abortSignal, timeoutMs);
      let networkLeaseId: string | undefined;
      try {
        const control = artifactControl.control;
        const expectedName = artifactControl.name;
        trustedChatGptPage(page);
        await transaction.race(artifactControl.card.hover({
          timeout: Math.min(5_000, timeoutMs),
          signal: transaction.signal,
        })).catch(error => { throw artifactStageError("card-hover", error); });
        if (options.networkGuard) {
          const lease = await transaction.race(options.networkGuard.register({
            assistantTurnId,
            expectedFilename: expectedName,
            maxBytes: maxAcceptedBytes,
            deadlineMs: timeoutMs,
          })).catch(error => { throw artifactStageError("register", error); });
          if (!/^artifact_[a-f0-9]{32}$/.test(lease.leaseId)) {
            throw new Error("Launcher returned an invalid artifact download lease");
          }
          networkLeaseId = lease.leaseId;
        }
        let downloadAuthority: ChatGptArtifact["source"]["downloadAuthority"];
        let saved: Omit<ChatGptArtifact, "source">;
        if (options.networkGuard && networkLeaseId) {
          const clickAttempt = control.click({
            timeout: Math.min(10_000, timeoutMs),
            signal: transaction.signal,
            noWaitAfter: true,
          }).then(() => undefined, error => {
            const classified = artifactStageError("click", error);
            // Native DownloadItem completion is authoritative. A Playwright click may report a
            // post-dispatch wait fault even when Electron owns a live transfer, so retain this
            // safe stage code for diagnostics but let the bounded host receipt decide success.
            console.warn(`[chatgpt-web] ${classified.message}`);
          });
          void clickAttempt;
          const receipt = await transaction.race(options.networkGuard.wait(networkLeaseId).catch(error => {
            throw artifactStageError("host-wait", error);
          }));
          downloadAuthority = receipt.downloadAuthority;
          saved = await promoteGuardedDownload(
              receipt,
              directory,
              expectedName,
              traceId,
              assistantTurnId,
              undefined,
              transaction,
              maxAcceptedBytes,
            ).catch(error => { throw artifactStageError("promotion", error); });
        } else {
          const download = await transaction.race(Promise.all([
            page.waitForEvent("download", { timeout: Math.min(15_000, timeoutMs) })
              .then(observed => { transaction.bind(observed); return observed; }),
            control.click({ timeout: Math.min(10_000, timeoutMs), signal: transaction.signal }),
          ]).then(([observed]) => observed)).catch(error => {
            if (transaction.signal.aborted && transaction.signal.reason instanceof Error) throw transaction.signal.reason;
            throw new Error(`ChatGPT generated-file card ${JSON.stringify(expectedName)} did not produce a download`, { cause: error });
          });
          downloadAuthority = trustedDownloadAuthority(download.url());
          saved = await saveBoundedDownload(download, directory, expectedName, transaction, maxAcceptedBytes);
        }
        const artifact: ChatGptArtifact = {
          ...saved,
          source: { provider: "chatgpt.com", traceId, assistantTurnId, downloadAuthority },
        };
        if (!artifacts.some(existing => existing.path === artifact.path && existing.sha256 === artifact.sha256)) {
          artifacts.push(artifact);
        }
      } catch (error) {
        if (networkLeaseId && options.networkGuard) {
          await options.networkGuard.cancel(
            networkLeaseId,
            error instanceof Error ? error : new Error(String(error)),
          ).catch(() => {});
        }
        await transaction.cancel(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        transaction.dispose();
      }
    }
    const manifest: ChatGptArtifactManifest = { version: 1, artifacts };
    const partialManifest = join(directory, `.manifest-${randomUUID()}.partial`);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (manifestBytes.length > CHATGPT_ARTIFACT_MANIFEST_MAX_BYTES) {
      throw new Error("ChatGPT artifact manifest exceeds the 1 MB limit");
    }
    const manifestPath = join(directory, "manifest.json");
    try {
      const manifestHandle = await open(partialManifest, "wx", 0o600);
      try {
        await writeAllArtifactBytes(manifestHandle, manifestBytes);
        await manifestHandle.sync();
      } finally {
        await manifestHandle.close();
      }
      await rm(manifestPath, { force: true });
      await rename(partialManifest, manifestPath);
    } catch (error) {
      await rm(partialManifest, { force: true }).catch(() => {});
      throw error;
    }
    return artifacts;
  } catch (error) {
    throw error;
  }
}

export function chatGptArtifactMarkdown(artifacts: readonly ChatGptArtifact[]): string {
  if (artifacts.length === 0) return "";
  const rows = artifacts.map(artifact => {
    const label = artifact.name.replace(/([\\\]])/g, "\\$1");
    const target = artifact.path.replace(/>/g, "%3E");
    return `- [${label}](<${target}>) — ${artifact.mimeType}, ${artifact.size} bytes, SHA-256 \`${artifact.sha256}\`; source ChatGPT ${artifact.source.downloadAuthority}, assistant turn \`${artifact.source.assistantTurnId}\``;
  });
  return `\n\nGenerated artifacts (verified local files):\n\n${rows.join("\n")}`;
}
