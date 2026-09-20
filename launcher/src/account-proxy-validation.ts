import type { AccountProxy } from "./types";

export type ProxyValidationError = "url" | "pac" | "socks-port";
export function normalizeAccountProxy(value: AccountProxy): { value: AccountProxy | null; error: ProxyValidationError | null } {
  if (value.mode === "system" || value.mode === "direct") return { value: { mode: value.mode }, error: null };
  if (!value.url || value.url.length > 2048) return { value: null, error: "url" };
  let url: URL;
  try { url = new URL(value.url); } catch { return { value: null, error: "url" }; }
  if (url.username || url.password || url.hash) return { value: null, error: "url" };
  if (value.mode === "pac") return url.protocol === "https:"
    ? { value: { mode: "pac", url: url.href }, error: null } : { value: null, error: "pac" };
  if (url.protocol !== `${value.mode}:` || !url.hostname || (url.pathname && url.pathname !== "/") || url.search) {
    return { value: null, error: "url" };
  }
  if (value.mode === "socks5" && !url.port) return { value: null, error: "socks-port" };
  return { value: { mode: value.mode, url: `${value.mode}://${url.host}` }, error: null };
}
