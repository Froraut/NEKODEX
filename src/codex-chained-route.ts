import { inspectCodexIntegration, type CodexIntegrationInspection } from "./codex-integration";

// A user may put a local gateway (for example a multi-provider router) in front of the managed
// route: Codex -> gateway -> this runtime. The route then stays usable even though Codex's
// openai_base_url no longer names the runtime itself. Status accepts that chain only when the
// runtime answers at its managed origin and the gateway's /healthz reports that same runtime as
// its reachable upstream. Nothing here writes the Codex config.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_HEALTH_BYTES = 64 * 1024;
const RUNTIME_SERVICE = "codex-chatgpt-web";

export type HealthFetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface ChainedRouteProof {
  /** The user's openai_base_url: the gateway in front of this runtime. */
  url: string;
  /** The managed runtime route the gateway forwards to. */
  upstreamUrl: string;
  upstreamVersion: string;
  gatewayVersion?: string;
}

export const UNVERIFIED_CHAIN_DETAIL =
  "no local gateway at the newer openai_base_url confirmed that it forwards to this NEKODEX runtime";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function loopbackHttpUrl(value: string): URL | undefined {
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  return url;
}

const routePath = (url: URL) => url.pathname.replace(/\/+$/, "");

async function readHealth(origin: string, fetcher: HealthFetcher, timeoutMs: number) {
  try {
    const response = await fetcher(new URL("/healthz", origin).href, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return undefined;
    }
    const text = await response.text();
    return text.length <= MAX_HEALTH_BYTES ? record(JSON.parse(text)) : undefined;
  } catch {
    return undefined;
  }
}

/** Proves `currentUrl` is a loopback gateway whose reachable upstream is the runtime at `managedUrl`. */
export async function verifyChainedCodexRoute(
  currentUrl: string,
  managedUrl: string,
  { fetcher = fetch as HealthFetcher, timeoutMs = 3_000 }: { fetcher?: HealthFetcher; timeoutMs?: number } = {},
): Promise<ChainedRouteProof | undefined> {
  const gatewayUrl = loopbackHttpUrl(currentUrl);
  const runtimeUrl = loopbackHttpUrl(managedUrl);
  if (!gatewayUrl || !runtimeUrl || gatewayUrl.origin === runtimeUrl.origin) return undefined;
  if (routePath(gatewayUrl) !== routePath(runtimeUrl)) return undefined;
  const [runtime, gateway] = await Promise.all([
    readHealth(runtimeUrl.origin, fetcher, timeoutMs),
    readHealth(gatewayUrl.origin, fetcher, timeoutMs),
  ]);
  if (runtime?.status !== "ok" || runtime.service !== RUNTIME_SERVICE || typeof runtime.version !== "string") {
    return undefined;
  }
  // Another runtime instance is not a gateway: its own /healthz has no upstream to vouch for.
  if (gateway?.status !== "ok" || gateway.service === RUNTIME_SERVICE) return undefined;
  const upstream = record(gateway.upstream);
  if (upstream?.reachable !== true || upstream.version !== runtime.version) return undefined;
  // Gateways that also echo the upstream identity must name exactly this runtime.
  if (upstream.instance_id !== undefined && upstream.instance_id !== runtime.instance_id) return undefined;
  if (upstream.origin !== undefined && upstream.origin !== runtimeUrl.origin) return undefined;
  return {
    url: currentUrl,
    upstreamUrl: managedUrl,
    upstreamVersion: runtime.version,
    ...(typeof gateway.version === "string" ? { gatewayVersion: gateway.version } : {}),
  };
}

/**
 * Status for an active route that also accepts a verified local gateway chain. Without proof the
 * original refusal is kept and explains what was checked; the user's openai_base_url is never changed.
 */
export async function inspectCodexIntegrationWithChain(
  options: { fetcher?: HealthFetcher; timeoutMs?: number } = {},
  inspect: typeof inspectCodexIntegration = inspectCodexIntegration,
): Promise<CodexIntegrationInspection & { chainedRoute?: ChainedRouteProof }> {
  const status = inspect();
  const changed = status.baseUrlChanged;
  if (!changed || !status.active || !status.routeUrl) return status;
  const proof = changed.current === undefined
    ? undefined
    : await verifyChainedCodexRoute(changed.current, status.routeUrl, options);
  if (!proof) {
    return {
      ...status,
      errors: status.errors.map(error => error === changed.error ? `${error} (${UNVERIFIED_CHAIN_DETAIL})` : error),
    };
  }
  const chained = inspect({ chainedBaseUrl: proof.url });
  return chained.errors.length === 0 ? { ...chained, chainedRoute: proof } : chained;
}
