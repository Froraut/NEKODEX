import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { EventEmitter } from "node:events";
import type { AppConfig } from "./config";
import { atomicWriteFile } from "./config";
import { loginVerificationMarkerPath, sanitizeBrowserLoginStorageState, type BrowserLoginStorageState } from "./browser-login";

// Chrome's approval-based endpoint deliberately does not expose /json/version. Connect directly
// after explicit app consent; Chrome itself must grant its separate, native Allow prompt.
// This exported Playwright bundle is already pinned and shipped with the application. Unlike
// the global WebSocket API, it lets us disable redirects and bound frames before allocation.
const { ws: WebSocketClient } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle") as {
  ws: new (url: string, options: Record<string, unknown>) => Socket;
};

interface Socket extends EventEmitter {
  readyState: number;
  send(data: string): void;
  terminate(): void;
}
type JsonObject = Record<string, unknown>;
const COOKIE_URLS = ["https://chatgpt.com/", "https://auth.openai.com/"] as const;
const MAX_FRAME_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_COOKIES = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 2_000;

export type ExistingChromeLoginErrorCode = "consent-required" | "unsupported-platform" | "chrome-unavailable" | "chrome-profile-access-denied"
  | "invalid-endpoint" | "chrome-permission-denied" | "chrome-permission-timeout" | "chrome-too-old"
  | "chrome-disconnected" | "invalid-response" | "session-missing" | "cancelled" | "capture-write-failed";
const MESSAGES: Record<ExistingChromeLoginErrorCode, string> = {
  "consent-required": "Confirm access to your current Chrome profile before importing its ChatGPT sign-in.",
  "unsupported-platform": "Existing Chrome sign-in import is unavailable on this operating system.",
  "chrome-unavailable": "Open Google Chrome and enable its remote debugging approval setting, then retry the import.",
  "chrome-profile-access-denied": "The operating system denied access to Chrome's local connection information. Review access permissions for Codex Web GPT, then retry.",
  "invalid-endpoint": "Chrome's local connection information is unavailable or invalid. Reopen its remote debugging settings and retry.",
  "chrome-permission-denied": "Chrome did not allow the connection. Choose Allow in Chrome when you retry.",
  "chrome-permission-timeout": "Chrome did not finish approving the connection in time. Check its Allow prompt and retry.",
  "chrome-too-old": "Importing an existing Chrome sign-in requires Google Chrome 144 or later with native connection approval enabled.",
  "chrome-disconnected": "The connection to Chrome ended. Keep Chrome open and retry the import.",
  "invalid-response": "Chrome returned an unsupported or oversized session response. No sign-in was imported.",
  "session-missing": "The current Chrome profile has no usable ChatGPT sign-in. Open ChatGPT in that profile and retry.",
  "cancelled": "Chrome sign-in import was cancelled.",
  "capture-write-failed": "The private Chrome sign-in capture could not be saved. Retry the import.",
};
export class ExistingChromeLoginError extends Error {
  constructor(readonly code: ExistingChromeLoginErrorCode) {
    super(MESSAGES[code]);
    this.name = "ExistingChromeLoginError";
  }
}
const failure = (code: ExistingChromeLoginErrorCode) => new ExistingChromeLoginError(code);
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

export interface ExistingChromeLoginProgress {
  version: 1;
  phase: "discovering" | "waiting-for-chrome" | "reading-session" | "complete";
  deadlineAt: string;
}
export interface ExistingChromeLoginOptions {
  consent: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: ExistingChromeLoginProgress) => void;
  /** One-use discovery contents from the launcher's private pipe after native file selection.
   * Never provide a path or endpoint through argv, environment, renderer state or logs. */
  discoveryData?: Promise<string>;
}
export interface ExistingChromeLoginCapture {
  storageState: BrowserLoginStorageState;
  marker: { version: 1; captureComplete: true; source: "existing-chrome-profile"; capturedAt: string };
}

/** Stable Chrome only. This never reads Preferences, Local State, profile databases or tabs. */
export function existingChromePortFile(options: {
  platform?: string; home?: string; localAppData?: string; xdgConfigHome?: string;
} = {}): string {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const safePath = (path: string) => path.length <= 4096 && !path.includes("\0") && isAbsolute(path);
  if (!safePath(home)) throw failure("invalid-endpoint");
  if (platform === "darwin") return join(home, "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort");
  if (platform === "win32") {
    const base = options.localAppData ?? process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    if (!safePath(base)) throw failure("invalid-endpoint");
    return join(base, "Google", "Chrome", "User Data", "DevToolsActivePort");
  }
  if (platform === "linux") {
    const base = options.xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? join(home, ".config");
    if (!safePath(base)) throw failure("invalid-endpoint");
    return join(base, "google-chrome", "DevToolsActivePort");
  }
  throw failure("unsupported-platform");
}

export function parseExistingChromeEndpoint(contents: string): string {
  if (typeof contents !== "string" || contents.length > 2048 || Buffer.byteLength(contents) > 2048) throw failure("invalid-endpoint");
  const match = /^([1-9][0-9]{0,4})\r?\n(\/devtools\/browser\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\r?\n?$/i.exec(contents);
  const port = match ? Number(match[1]) : 0;
  if (!match || port < 1024 || port > 65535) throw failure("invalid-endpoint");
  return `ws://127.0.0.1:${port}${match[2]}`;
}

/** One small regular file; enforce no-follow and file ownership where supported by the OS. */
function discoverEndpoint(path: string): string {
  let fd: number | undefined;
  try {
    if (lstatSync(path).isSymbolicLink()) throw failure("invalid-endpoint");
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 2048 || (process.getuid && stat.uid !== process.getuid())) throw failure("invalid-endpoint");
    const buffer = Buffer.alloc(2049);
    let count = 0;
    while (count < buffer.length) {
      const bytes = readSync(fd, buffer, count, buffer.length - count, null);
      if (!bytes) break;
      count += bytes;
    }
    if (count > 2048) throw failure("invalid-endpoint");
    return parseExistingChromeEndpoint(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)));
  } catch (error) {
    if (error instanceof ExistingChromeLoginError) throw error;
    if (object(error) && (error.code === "EACCES" || error.code === "EPERM")) throw failure("chrome-profile-access-denied");
    if (object(error) && error.code === "ENOENT") throw failure("chrome-unavailable");
    throw failure("invalid-endpoint");
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** Validate only the fields accepted by the app. Unknown/partitioned cookies are discarded. */
export function sanitizeExistingChromeCookies(value: unknown): BrowserLoginStorageState {
  if (!Array.isArray(value) || value.length > MAX_COOKIES) throw failure("invalid-response");
  const cookies: BrowserLoginStorageState["cookies"] = [];
  for (const cookie of value) {
    if (!object(cookie)) throw failure("invalid-response");
    if (Object.hasOwn(cookie, "partitionKey") || cookie.partitionKeyOpaque === true) continue;
    if (typeof cookie.domain !== "string" || !/^\.?[a-z0-9.-]{1,253}$/i.test(cookie.domain)) continue;
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    // The allowlist is enforced before touching values, even if a peer ignores Network.getCookies URLs.
    if (!["chatgpt.com", "openai.com"].some(root => domain === root || domain.endsWith(`.${root}`))) continue;
    if (typeof cookie.name !== "string" || cookie.name.length > 1024 || /[\x00-\x20\x7f;,=]/.test(cookie.name)
      || typeof cookie.value !== "string" || Buffer.byteLength(cookie.value) > 16384 || /[\x00-\x1f\x7f]/.test(cookie.value)
      || typeof cookie.path !== "string" || !cookie.path.startsWith("/") || cookie.path.length > 2048 || /[\x00-\x1f\x7f]/.test(cookie.path)
      || typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires)
      || typeof cookie.httpOnly !== "boolean" || typeof cookie.secure !== "boolean"
      || (cookie.sameSite !== undefined && !["Strict", "Lax", "None"].includes(String(cookie.sameSite)))) throw failure("invalid-response");
    cookies.push({ name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
      expires: cookie.session === true ? -1 : cookie.expires, httpOnly: cookie.httpOnly, secure: cookie.secure,
      sameSite: cookie.sameSite as "Strict" | "Lax" | "None" | undefined ?? "Lax" });
  }
  const state = sanitizeBrowserLoginStorageState({ cookies, origins: [] });
  if (Buffer.byteLength(JSON.stringify(state)) > MAX_FRAME_BYTES) throw failure("invalid-response");
  if (!state.cookies.length) throw failure("session-missing");
  return state;
}

interface Pending {
  resolve(value: JsonObject): void; reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  onResult?: (value: JsonObject) => void;
}
async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise;
  return await new Promise((resolve, reject) => {
    const abort = () => reject(failure("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

async function selectedDiscoveryEndpoint(data: Promise<string> | undefined, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The parent alone receives the native single-file grant. Its owned child gets only these
  // bounded contents, once, over stdin; it must not try reading the protected path again.
  const received = Promise.resolve(data).then(
    contents => parseExistingChromeEndpoint(contents as string),
    () => { throw failure("invalid-endpoint"); },
  );
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(failure("chrome-permission-timeout")), timeoutMs);
  });
  try { return await abortable(Promise.race([received, timeout]), signal); }
  finally { if (timer) clearTimeout(timer); }
}

class RestrictedChromeConnection {
  private id = 0;
  private pending = new Map<number, Pending>();
  private bytes = 0;
  private frames = 0;
  private stopped = false;
  constructor(private socket: Socket) {
    socket.on("message", (raw: Buffer, binary: boolean) => {
      if (this.stopped) return;
      this.bytes += raw.length;
      if (binary || ++this.frames > 64 || this.bytes > MAX_TOTAL_BYTES) return this.fail("invalid-response");
      let value: unknown;
      try { value = JSON.parse(raw.toString("utf8")); } catch { return this.fail("invalid-response"); }
      if (!object(value)) return this.fail("invalid-response");
      if (value.id === undefined) return; // Ignore events without reading or logging any payload.
      if (!Number.isSafeInteger(value.id)) return this.fail("invalid-response");
      const call = this.pending.get(value.id as number);
      if (!call) return;
      this.pending.delete(value.id as number);
      clearTimeout(call.timer);
      if (value.error || !object(value.result)) return call.reject(failure("invalid-response"));
      try { call.onResult?.(value.result); call.resolve(value.result); }
      catch { call.reject(failure("invalid-response")); }
    });
    socket.on("error", () => this.fail("chrome-disconnected"));
    socket.on("close", () => this.fail("chrome-disconnected"));
  }
  private fail(code: ExistingChromeLoginErrorCode) {
    if (this.stopped) return;
    this.stopped = true;
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(failure(code)); }
    this.pending.clear();
    this.socket.terminate();
  }
  request(method: string, params: JsonObject, timeoutMs: number, sessionId?: string, onResult?: Pending["onResult"]): Promise<JsonObject> {
    if (this.stopped || this.socket.readyState !== 1) return Promise.reject(failure("chrome-disconnected"));
    if (++this.id > 8) return Promise.reject(failure("invalid-response"));
    const id = this.id;
    return new Promise((resolve, reject) => {
      // Retain a timed-out createTarget result hook until disconnect so late tab creation can be cleaned up.
      const timer = setTimeout(() => {
        if (!onResult) this.pending.delete(id);
        reject(failure("chrome-disconnected"));
      }, Math.max(1, timeoutMs));
      this.pending.set(id, { resolve, reject, timer, onResult });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch { this.fail("chrome-disconnected"); }
    });
  }
  disconnect() { this.fail("chrome-disconnected"); }
}

async function connect(endpoint: string, timeoutMs: number, signal?: AbortSignal): Promise<RestrictedChromeConnection> {
  if (signal?.aborted) throw failure("cancelled");
  return await new Promise((resolve, reject) => {
    const socket = new WebSocketClient(endpoint, {
      followRedirects: false, perMessageDeflate: false, maxPayload: MAX_FRAME_BYTES,
      // Our timer produces a stable permission-timeout code; the transport deadline is a backup.
      handshakeTimeout: timeoutMs + 1000, maxRedirects: 0,
    });
    let settled = false;
    const finish = (code?: ExistingChromeLoginErrorCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (code) { socket.terminate(); reject(failure(code)); }
      else resolve(new RestrictedChromeConnection(socket));
    };
    const timer = setTimeout(() => finish("chrome-permission-timeout"), timeoutMs);
    const abort = () => finish("cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("open", () => finish());
    socket.on("error", () => finish("chrome-disconnected")); // Keep error listener after failed/aborted handshake.
    socket.once("unexpected-response", (_request: unknown, response: { statusCode?: number; resume(): void }) => {
      response.resume();
      finish(response.statusCode === 403 ? "chrome-permission-denied" : "invalid-endpoint");
    });
    socket.once("close", () => finish("chrome-disconnected"));
    if (signal?.aborted) abort();
  });
}

/** Tests may inject a discovery file. Production callers never accept arbitrary profiles/endpoints. */
export async function captureExistingChromeLogin(options: ExistingChromeLoginOptions, dependencies: {
  portFile?: () => string;
} = {}): Promise<ExistingChromeLoginCapture> {
  if (options.consent !== true) throw failure("consent-required");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw failure("invalid-response");
  const deadline = Date.now() + timeoutMs;
  const check = () => {
    if (options.signal?.aborted) throw failure("cancelled");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure("chrome-permission-timeout");
    return remaining;
  };
  const progress = (phase: ExistingChromeLoginProgress["phase"]) => {
    check();
    options.onProgress?.({ version: 1, phase, deadlineAt: new Date(deadline).toISOString() });
  };
  progress("discovering");
  // An explicitly requested selected-file transfer never falls back to discovery on disk,
  // including when the control payload is missing, malformed, cancelled or late.
  const endpoint = Object.hasOwn(options, "discoveryData")
    ? await selectedDiscoveryEndpoint(options.discoveryData, check(), options.signal)
    : discoverEndpoint((dependencies.portFile ?? existingChromePortFile)());
  progress("waiting-for-chrome");
  const connection = await connect(endpoint, check(), options.signal);
  let targetId: string | undefined;
  let closing = false;
  let lateClose: Promise<unknown> | undefined;
  let creationPending: Promise<unknown> | undefined;
  let creationObserved!: () => void;
  const observedCreation = new Promise<void>(resolve => { creationObserved = resolve; });
  let cleanupFailed = false;
  const closeOwnedTarget = async () => {
    const owned = targetId;
    targetId = undefined;
    if (owned) {
      try {
        const result = await connection.request("Target.closeTarget", { targetId: owned }, CLEANUP_TIMEOUT_MS);
        if (result.success !== true) cleanupFailed = true;
      } catch { cleanupFailed = true; }
    }
  };
  const request = (method: string, params: JsonObject, sessionId?: string) => abortable(
    connection.request(method, params, Math.min(10_000, check()), sessionId), options.signal,
  );
  try {
    const version = await request("Browser.getVersion", {});
    const match = typeof version.product === "string" ? /^Chrome\/([1-9][0-9]{1,3})\.[0-9.]+$/.exec(version.product) : null;
    if (!match || Number(match[1]) < 144) throw failure("chrome-too-old");
    progress("reading-session");
    // Chrome 144 supports hidden targets tied to this connection. Disconnect destroys an
    // unresolved/late target too; never fall back to a visible user tab or inspect existing tabs.
    const creation = connection.request("Target.createTarget", { url: "about:blank", background: true, hidden: true }, Math.min(10_000, check()), undefined, result => {
      creationObserved();
      if (typeof result.targetId !== "string" || !/^[a-z0-9-]{1,128}$/i.test(result.targetId)) throw failure("invalid-response");
      targetId = result.targetId;
      if (closing) lateClose = closeOwnedTarget();
    });
    creationPending = creation;
    const created = await abortable(creation, options.signal);
    creationPending = undefined;
    check();
    if (!targetId || created.targetId !== targetId) throw failure("invalid-response");
    const attached = await request("Target.attachToTarget", { targetId, flatten: true });
    if (typeof attached.sessionId !== "string" || !/^[a-z0-9-]{1,128}$/i.test(attached.sessionId)) throw failure("invalid-response");
    const result = await request("Network.getCookies", { urls: [...COOKIE_URLS] }, attached.sessionId);
    check();
    const storageState = sanitizeExistingChromeCookies(result.cookies);
    return { storageState, marker: { version: 1, captureComplete: true, source: "existing-chrome-profile", capturedAt: new Date().toISOString() } };
  } catch (error) {
    if (options.signal?.aborted) throw failure("cancelled");
    throw error instanceof ExistingChromeLoginError ? error : failure("invalid-response");
  } finally {
    closing = true;
    if (creationPending) {
      // CDP has no createTarget cancellation command. Briefly drain a late create response and
      // close only that returned ID; never enumerate or close someone else's tabs to compensate.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        observedCreation,
        new Promise(resolve => { timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS); }),
      ]);
      if (timer) clearTimeout(timer);
    }
    await closeOwnedTarget();
    if (lateClose) await lateClose;
    connection.disconnect();
    if (cleanupFailed && !options.signal?.aborted) throw failure("chrome-disconnected");
  }
}

export async function captureExistingChromeLoginToFile(config: Pick<AppConfig, "storageStatePath">, options: ExistingChromeLoginOptions,
  dependencies: { portFile?: () => string } = {}): Promise<void> {
  const capture = await captureExistingChromeLogin(options, dependencies);
  if (options.signal?.aborted) throw failure("cancelled");
  const markerPath = loginVerificationMarkerPath(config.storageStatePath);
  try {
    // A capture marker is deliberately not an authentication marker. The launcher's disposable
    // verifier must confirm this session before replacing its live authenticated state.
    rmSync(markerPath, { force: true });
    atomicWriteFile(config.storageStatePath, `${JSON.stringify(capture.storageState)}\n`);
    atomicWriteFile(markerPath, `${JSON.stringify(capture.marker)}\n`);
  } catch {
    try { rmSync(markerPath, { force: true }); } catch { /* Preserve the sanitized write error. */ }
    throw failure("capture-write-failed");
  }
  options.onProgress?.({ version: 1, phase: "complete", deadlineAt: new Date(Date.now()).toISOString() });
}
