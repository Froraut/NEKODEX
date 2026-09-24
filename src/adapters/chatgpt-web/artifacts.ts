import { createHash, randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Download, Locator, Page } from "playwright-core";
import { getConfigDir } from "../../config";
import { sanitizeCodexFileName } from "../../responses/file-content";
import {
  CHATGPT_ARTIFACT_MAX_BYTES, CHATGPT_ARTIFACT_MAX_COUNT, CHATGPT_ARTIFACT_MANIFEST_MAX_BYTES,
  digestFile, promoteOwnedArtifact, verifiedManifest,
  type ChatGptArtifact, type ChatGptArtifactManifest,
} from "./artifact-storage";
export { CHATGPT_ARTIFACT_MAX_BYTES, CHATGPT_ARTIFACT_MAX_COUNT, CHATGPT_ARTIFACT_MANIFEST_MAX_BYTES } from "./artifact-storage";
export type { ChatGptArtifact } from "./artifact-storage";
export { validateChatGptZipContainer } from "./artifact-format";
export const CHATGPT_ARTIFACT_TRANSACTION_TIMEOUT_MS = 60_000;

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
    return await promoteOwnedArtifact(partial, directory, expectedName, { size, sha256, firstBytes }, transaction, maxAcceptedBytes);
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
    return await promoteOwnedArtifact(partial, directory, expectedName, measured, transaction, maxAcceptedBytes);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    throw error;
  }
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
