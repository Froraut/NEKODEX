import { readLauncherBrowserHostDescriptor } from "./launcher-browser-host";

const EXPLICIT_PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
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
  if (!descriptorPath) return fetch(request);
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const response = await fetch(`${descriptor.control.endpoint}/v1/network/resolve-proxy`, {
    method: "POST",
    headers: { authorization: `Bearer ${descriptor.control.token}`, "content-type": "application/json" },
    body: JSON.stringify({ url: request.url }),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    redirect: "error",
    // Never let ambient proxy resolution carry the loopback control token off-machine.
    proxy: "",
  });
  if (!response.ok) throw proxyError(`Launcher native proxy resolution failed (HTTP ${response.status})`);
  const result = await response.json() as { proxy?: unknown };
  const proxy = nativeProxyOrigin(result.proxy);
  return fetch(request, { proxy });
}
