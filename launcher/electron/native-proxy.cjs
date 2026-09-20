// Adapted from upstream PR #469. Only launcher-owned children receive these values.
const NATIVE_URL = "https://chatgpt.com/backend-api/codex";
const TUNNEL_URL = "https://api.openai.com/v1/tunnels";
const EXPLICIT_PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

function loopbackBypass(environment = process.env) {
  const values = [environment.NO_PROXY, environment.no_proxy, "localhost,127.0.0.1,::1"]
    .filter(value => typeof value === "string").flatMap(value => value.split(",").map(part => part.trim()).filter(Boolean));
  const value = [...new Set(values)].join(",");
  return { NO_PROXY: value, no_proxy: value };
}

function proxyOriginFromPac(result) {
  const first = typeof result === "string" ? result.split(";")[0].trim() : "";
  if (first.toUpperCase() === "DIRECT") return "";
  const match = /^(PROXY|HTTPS)\s+([^\s/]+)$/i.exec(first);
  if (!match) throw new Error("The system proxy requires an HTTP/HTTPS proxy for native OpenAI connections");
  let url;
  try { url = new URL(`${match[1].toUpperCase() === "HTTPS" ? "https" : "http"}://${match[2]}`); }
  catch { throw new Error("The system proxy returned an invalid address"); }
  const port = /:(\d+)$/.exec(match[2])?.[1];
  if (!url.hostname || !port || url.username || url.password || url.search || url.hash
    || Number(port) < 1 || Number(port) > 65535) throw new Error("The system proxy returned an invalid address");
  return url.origin;
}

function nativeFallbackProxyEnvironment(value) {
  if (value === "") return { CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY: "DIRECT" };
  if (typeof value !== "string") throw new Error("Native fallback proxy must be DIRECT or an HTTP/HTTPS origin");
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Native fallback proxy must be DIRECT or an HTTP/HTTPS origin"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || url.origin !== value) throw new Error("Native fallback proxy must be DIRECT or an HTTP/HTTPS origin");
  return { CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY: url.origin };
}

async function resolvePac(session, url, timeoutMs) {
  let timer;
  try {
    return proxyOriginFromPac(await Promise.race([
      session.resolveProxy(url),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Resolving the system proxy for OpenAI timed out")), timeoutMs); }),
    ]));
  } finally { clearTimeout(timer); }
}

async function resolveNativeRequestProxy(session, value, timeoutMs = 5000) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid native request URL"); }
  if (url.origin !== "https://chatgpt.com" || !url.pathname.startsWith("/backend-api/codex/")
    || url.username || url.password || url.hash) throw new Error("Native proxy resolution requires the first-party Codex endpoint");
  return resolvePac(session, url.href, timeoutMs);
}

async function resolveNativeProxyEnvironment(session, environment = process.env, timeoutMs = 5000) {
  if (["CODEX_CHATGPT_WEB_NATIVE_PROXY", ...EXPLICIT_PROXY_KEYS].some(key => environment[key]?.trim())) return {};
  const origin = await resolvePac(session, NATIVE_URL, timeoutMs);
  return origin ? { CODEX_CHATGPT_WEB_NATIVE_PROXY: origin } : {};
}

async function resolveTunnelProxyEnvironment(session, environment = process.env, timeoutMs = 5000) {
  const bypass = loopbackBypass(environment);
  if (EXPLICIT_PROXY_KEYS.some(key => environment[key]?.trim())) return bypass;
  const origin = await resolvePac(session, TUNNEL_URL, timeoutMs);
  return origin ? { HTTPS_PROXY: origin, https_proxy: origin, ...bypass } : bypass;
}

module.exports = {
  loopbackBypass,
  nativeFallbackProxyEnvironment,
  proxyOriginFromPac,
  resolveNativeProxyEnvironment,
  resolveNativeRequestProxy,
  resolveTunnelProxyEnvironment,
};
