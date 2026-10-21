import { existsSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrowserCompanionHost, type BrowserCompanionHost } from "./host";
import { COMPANION_ORIGIN } from "./protocol";
import { createCompanionBrowserProvider } from "./providers";
import { reviewedCompanionExtensionOrigin } from "./firefox-identity";
import { createCompanionChatGptTransport } from "./chatgpt-transport";

export interface CompanionListener { stop(closeActiveConnections?: boolean): void | Promise<void> }
export interface BrowserCompanionRuntimeOptions {
  /** Trusted composition-root path; never read from a model/renderer request. */
  extensionArtifactPath?: string;
  /** Local deterministic fixture seam. Production uses the fixed Bun loopback listener. */
  startListener?: (host: BrowserCompanionHost) => CompanionListener;
}

/** Resolve only the two shipped layouts. Never search cwd/parents or fall back to a
 * different checkout when the expected artifact is missing. The override is trusted config. */
export function browserCompanionArtifactDirectory(moduleUrl: string, explicitPath?: string): string {
  if (explicitPath !== undefined) return resolve(explicitPath);
  const modulePath = fileURLToPath(moduleUrl);
  const directory = dirname(modulePath);
  if (basename(modulePath) === "cli.js") return join(directory, "browser-companion");
  if (basename(modulePath) === "runtime.ts" && basename(directory) === "browser-companion" && basename(dirname(directory)) === "src") {
    return resolve(directory, "../../browser-companion");
  }
  throw new Error("Companion artifact layout is unsupported; supply its trusted application path");
}

/** One explicitly enabled, process-owned listener. No startup policy, token or selected page is persisted. */
export function createBrowserCompanionRuntime(options: BrowserCompanionRuntimeOptions = {}) {
  const directory = browserCompanionArtifactDirectory(import.meta.url, options.extensionArtifactPath);
  const manifestPath = join(directory, "manifest.json");
  let host: BrowserCompanionHost | undefined;
  let listener: CompanionListener | undefined;
  let extensionId = "";
  let extensionOrigin = "";
  let unavailableReason: string | null = null;
  let transitioning = false;
  let closed = false;
  let stopping: Promise<ReturnType<typeof status>> | undefined;
  let lastReceipt: { operationId: string; outcome: string; cancelRequested: boolean; reason?: string } | null = null;
  // Outlives listener restarts so a held unknown send survives Disable/Enable in this process.
  const chatgpt = createCompanionChatGptTransport({ host: () => host && listener ? host : undefined });

  function status() {
    return {
      enabled: !!listener, state: closed ? "closed" as const : transitioning ? "transitioning" as const : unavailableReason ? "unavailable" as const : listener ? "listening" as const : "disabled" as const,
      origin: COMPANION_ORIGIN, extensionId, extensionOrigin, reason: unavailableReason, restartPolicy: "off" as const,
      extensionArtifact: { directory, manifestPath, available: existsSync(manifestPath) },
      companion: host?.status() ?? null,
      lastReceipt: lastReceipt ? structuredClone(lastReceipt) : null, chatGptSendSupported: true as const,
      chatGpt: chatgpt.status(),
    };
  }
  async function enable(selectedId: unknown, selectedOrigin?: unknown) {
    if (closed) throw new Error("Companion runtime is closed");
    if (transitioning) throw new Error("Companion listener transition is already in progress");
    // The application owner accepts only the reviewed artifact identity (fixed Chrome key ID, or
    // the Firefox ID with its profile origin); the host leaf itself stays exact-identity generic.
    const checkedOrigin = reviewedCompanionExtensionOrigin(selectedId, selectedOrigin);
    if (listener) {
      if (selectedId !== extensionId || checkedOrigin !== extensionOrigin) throw new Error("Disable the current listener before changing extension identity");
      return status();
    }
    transitioning = true; unavailableReason = null; extensionId = selectedId as string; extensionOrigin = checkedOrigin;
    const candidate = createBrowserCompanionHost({ extensionId, ...(selectedOrigin !== undefined ? { extensionOrigin } : {}) });
    try {
      const owned = options.startListener ? options.startListener(candidate) : Bun.serve({
        hostname: "127.0.0.1", port: 17843, idleTimeout: 30,
        fetch: candidate.fetch,
        error: () => Response.json({ error: "Companion request failed" }, { status: 500 }),
      });
      listener = owned; host = candidate;
    } catch (error) {
      candidate.close();
      unavailableReason = error && typeof error === "object" && ["EADDRINUSE", "EACCES"].includes(String((error as { code?: unknown }).code))
        ? "The fixed local companion port is unavailable. Close its known owner or choose Disable; NEKODEX will not stop another process."
        : "The local companion listener could not start. No extension was paired.";
    } finally { transitioning = false; }
    return status();
  }
  function disable(): Promise<ReturnType<typeof status>> {
    if (stopping) return stopping;
    if (transitioning) return Promise.reject(new Error("Companion listener transition is already in progress"));
    transitioning = true;
    const ownedHost = host, ownedListener = listener;
    const operation = ownedHost?.status().operation;
    chatgpt.unbind();
    stopping = (async () => { try {
      // Revoke and settle the logical owner before closing its transports. A browser action
      // already dispatched can still finish, so its cancellation receipt remains unknown.
      ownedHost?.close();
      if (operation) {
        const receipt = ownedHost?.receipt(operation.operationId);
        if (receipt) lastReceipt = { operationId: receipt.operationId, outcome: receipt.outcome, cancelRequested: receipt.cancelRequested, ...(receipt.reason ? { reason: receipt.reason } : {}) };
      }
      await ownedListener?.stop(true);
      listener = undefined; host = undefined; unavailableReason = null;
    } catch {
      unavailableReason = "The owned listener did not confirm shutdown. Retry Disable; no replacement listener will be started.";
      throw new Error(unavailableReason);
    } finally { transitioning = false; stopping = undefined; }
    return status(); })();
    return stopping;
  }
  return {
    status, enable, disable,
    createPairing() {
      if (closed || transitioning || !host || !listener) throw new Error("Enable the local companion listener first");
      const pairing = host.createPairing();
      chatgpt.unbind();
      return { status: status(), pairing };
    },
    revoke() {
      if (transitioning) throw new Error("Companion listener transition is already in progress");
      const operation = host?.status().operation;
      host?.revoke();
      chatgpt.unbind();
      if (operation) {
        const receipt = host?.receipt(operation.operationId);
        if (receipt) lastReceipt = { operationId: receipt.operationId, outcome: receipt.outcome, cancelRequested: receipt.cancelRequested, ...(receipt.reason ? { reason: receipt.reason } : {}) };
      }
      return status();
    },
    /** Trusted tool-owner port only; no execution method is exposed by the admin HTTP surface. */
    browserProvider: () => host && listener ? createCompanionBrowserProvider(host) : undefined,
    /** Composition-root port for the existing ChatGPT worker; never exposed over HTTP. */
    chatGptTransport: () => chatgpt.port,
    async bindChatGpt(input: unknown) {
      if (closed || transitioning || !host || !listener) throw new Error("Enable the local companion listener first");
      await chatgpt.bind(input);
      return status();
    },
    unbindChatGpt() { chatgpt.unbind(); return status(); },
    releaseChatGptHeld(operationId: unknown) { chatgpt.release(operationId); return status(); },
    async close() { if (closed) return; await disable(); closed = true; },
  };
}
export type BrowserCompanionRuntime = ReturnType<typeof createBrowserCompanionRuntime>;
