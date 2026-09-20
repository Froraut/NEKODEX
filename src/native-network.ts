import {
  LauncherBrowserHostUnavailableError,
  readLauncherBrowserHostDescriptor,
} from "./launcher-browser-host";

const EXPLICIT_PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const NATIVE_FALLBACK_PROXY_KEY = "CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY";
function proxyError(message: string): Error {
  return Object.assign(new Error(message), { code: "NativeProxyConfigurationError" });
}

export function nativeProxyOrigin(value: unknown): string {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > 4096) throw proxyError("Native Codex proxy configuration is invalid");
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw proxyError("Native Codex proxy configuration is invalid"); }
}

function fallbackProxyOrigin(value: string): string {
  if (value === "DIRECT") return "";
  if (!value) throw proxyError("Native Codex background proxy configuration is invalid");
  const origin = nativeProxyOrigin(value);
  if (origin !== value) throw proxyError("Native Codex background proxy configuration is invalid");
  return origin;
}

let backgroundProxy: string | undefined;
let backgroundProxyError: Error | undefined;
const configuredBackgroundProxy = process.env[NATIVE_FALLBACK_PROXY_KEY];
if (configuredBackgroundProxy !== undefined) {
  try {
    backgroundProxy = fallbackProxyOrigin(configuredBackgroundProxy);
  } catch (error) {
    backgroundProxyError = error instanceof Error ? error : proxyError("Native Codex background proxy configuration is invalid");
  }
}

/** True when the detached daemon has a launcher-independent native transport route. */
export function nativeNetworkBackgroundReady(): boolean {
  const explicit = process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY?.trim();
  if (explicit) {
    try {
      nativeProxyOrigin(explicit);
      return true;
    } catch {
      return false;
    }
  }
  // These overrides are interpreted by Bun with its existing HTTP(S)/ALL_PROXY and NO_PROXY
  // semantics. Their presence already makes native transport independent of the launcher.
  if (EXPLICIT_PROXY_KEYS.some(key => process.env[key]?.trim())) return true;
  return backgroundProxy !== undefined;
}

function requireBackgroundProxy(cause: unknown): string {
  if (backgroundProxy !== undefined) return backgroundProxy;
  const error = backgroundProxyError
    ?? proxyError("Native Codex background proxy route is unavailable");
  if (!("cause" in error)) Object.defineProperty(error, "cause", { value: cause, configurable: true });
  throw error;
}

function hasErrorCode(error: unknown, code: string, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  if ("code" in error && error.code === code) return true;
  if ("cause" in error && hasErrorCode(error.cause, code, seen)) return true;
  if (error instanceof AggregateError) {
    return error.errors.some(candidate => hasErrorCode(candidate, code, seen));
  }
  return false;
}

function fetchWithProxy(request: Request, proxy: string): Promise<Response> {
  return fetch(request, { proxy });
}

/** Per-request OS proxy refresh applies only to native first-party traffic, never account sessions. */
export async function fetchNativeCodex(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== "https://chatgpt.com" || !url.pathname.startsWith("/backend-api/codex/")
    || url.username || url.password) throw proxyError("Native proxy resolution requires the first-party Codex endpoint");
  const explicit = process.env.CODEX_CHATGPT_WEB_NATIVE_PROXY?.trim();
  if (explicit) return fetch(request, { proxy: nativeProxyOrigin(explicit) });
  // Keep Bun's explicit environment semantics, including NO_PROXY.
  if (EXPLICIT_PROXY_KEYS.some(key => process.env[key]?.trim())) return fetch(request);
  const descriptorPath = process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR?.trim();
  if (!descriptorPath) {
    if (backgroundProxy !== undefined || backgroundProxyError !== undefined) {
      return fetchWithProxy(request, requireBackgroundProxy(
        proxyError("Launcher native proxy descriptor path is unavailable"),
      ));
    }
    return fetch(request);
  }
  let descriptor;
  try {
    descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  } catch (error) {
    if (error instanceof LauncherBrowserHostUnavailableError) {
      return fetchWithProxy(request, requireBackgroundProxy(error));
    }
    throw error;
  }
  let response: Response;
  const controlTimeout = AbortSignal.timeout(10_000);
  try {
    response = await fetch(`${descriptor.control.endpoint}/v1/network/resolve-proxy`, {
      method: "POST",
      headers: { authorization: `Bearer ${descriptor.control.token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: request.url }),
      signal: AbortSignal.any([request.signal, controlTimeout]),
      redirect: "error",
      // Never let ambient proxy resolution carry the loopback control token off-machine.
      proxy: "",
    });
  } catch (error) {
    if (!request.signal.aborted && !controlTimeout.aborted && hasErrorCode(error, "ECONNREFUSED")) {
      return fetchWithProxy(request, requireBackgroundProxy(error));
    }
    throw error;
  }
  if (!response.ok) throw proxyError(`Launcher native proxy resolution failed (HTTP ${response.status})`);
  const result = await response.json() as { proxy?: unknown };
  const proxy = nativeProxyOrigin(result.proxy);
  backgroundProxy = proxy;
  backgroundProxyError = undefined;
  return fetchWithProxy(request, proxy);
}
