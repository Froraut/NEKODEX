import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export interface VmNetworkScope { taskId: string; generation: number; actionId: string }
export interface VmNetworkDestination {
  /** Canonical http(s) origin, including any nondefault port. No wildcard. */
  origin: string;
  /** Explicit approved public addresses. The broker never performs DNS. */
  addresses: string[];
  methods: string[];
}
export interface VmNetworkGrantInput {
  scope: VmNetworkScope;
  destinations: VmNetworkDestination[];
  credentialOwner: 'none';
  dns: 'pinned-no-lookup';
  proxy: 'none';
  maxRequests: number;
  /** HTTP request line + broker generated headers + body, summed over all hops. */
  maxRequestBytes: number;
  /** Response body bytes, summed over all requests/hops. Headers separately bounded. */
  maxResponseBytes: number;
  maxRedirects: number;
  timeoutMs: number;
}
export interface VmNetworkGrant extends VmNetworkGrantInput { id: string }
export interface VmNetworkRequest {
  grantId: string; scope: VmNetworkScope; requestId: string; url: string; method: string;
  headers?: { accept?: string; 'content-type'?: string }; body?: Uint8Array;
}
export interface VmNetworkReceipt {
  version: 1; requestKey: string; grantId: string; scope: VmNetworkScope; requestId: string; fingerprint: string;
  state: 'unknown' | 'completed' | 'never-sent'; reason: string;
  requests: number; requestBytes: number; responseBytes: number;
  statusCode?: number; responseSha256?: string;
}
/** Trusted durable owner. reserve MUST atomically insert + fsync before returning;
 * finish MUST retain the reservation even on failure. A reservation is never
 * deleted/replayed. These methods must serialize writers across processes. */
export interface VmNetworkLedger {
  read(requestKey: string, scope: VmNetworkScope): VmNetworkReceipt | undefined;
  /** Reject a prior unfinished/unknown request in this exact action scope. */
  assertScopeClear(scope: VmNetworkScope): void;
  reserve(receipt: VmNetworkReceipt): void;
  finish(receipt: VmNetworkReceipt): void;
}
export interface VmNetworkHop {
  url: URL; address: string; method: string; headers: Readonly<Record<string, string>>;
  body: Uint8Array; maxResponseBytes: number; timeoutMs: number; signal: AbortSignal;
}
export interface VmNetworkHopResponse { statusCode: number; location?: string; body: Uint8Array }
/** Trusted host port, never supplied by guest/model. Must connect directly to
 * address, preserve URL hostname for TLS, disable automatic redirects/proxies,
 * credentials and retries, and enforce response limits while streaming. */
export interface VmNetworkTransport { request(hop: VmNetworkHop): Promise<VmNetworkHopResponse> }
export interface VmNetworkResult { receipt: VmNetworkReceipt; response?: { statusCode: number; body: Uint8Array } }
export interface VmNetworkOwnerPort {
  /** Throws when task generation/action is no longer current or not active. */
  assertCurrent(scope: Readonly<VmNetworkScope>): void;
  /** Exact VM owner cancellation; revoke never claims rollback of external work. */
  stop(scope: Readonly<VmNetworkScope>): void | Promise<void>;
}
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
function check(ok: unknown, why: string): asserts ok { if (!ok) throw new Error(why); }
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
function id(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v); }
function scopeValid(s: VmNetworkScope): void {
  check(s && id(s.taskId) && id(s.actionId) && Number.isSafeInteger(s.generation) && s.generation >= 1, 'vm-network-scope-invalid');
}
export function vmNetworkRequestKey(scope: VmNetworkScope, requestId: string): string {
  scopeValid(scope); check(id(requestId), 'vm-network-request-id-invalid');
  return hash(JSON.stringify([scope.taskId, scope.generation, scope.actionId, requestId]));
}
function sameScope(a: VmNetworkScope, b: VmNetworkScope): boolean {
  return a.taskId === b.taskId && a.generation === b.generation && a.actionId === b.actionId;
}
function limit(n: number, min: number, max: number): boolean { return Number.isSafeInteger(n) && n >= min && n <= max; }
/** Intentionally conservative: no private, link local, metadata, transition,
 * mapped IPv6, multicast, documentation or special-purpose destinations. */
export function isVmNetworkPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a !== undefined && b !== undefined && c !== undefined && a > 0 && a < 224
      && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0 || (b === 2 && c === 0) || (b === 88 && c === 99)))
      && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      && !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || address.includes('.') || address.includes('%')) return false;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  // Only global unicast; deny 2001 special ranges, 2002 6to4 and documentation.
  return /^[23]/.test(canonical) && !canonical.startsWith('2001:') && !canonical.startsWith('2002:') && !canonical.startsWith('3fff:');
}
function urlOf(raw: string): URL {
  check(typeof raw === 'string' && raw.length <= 8192 && !/[\u0000-\u0020\u007f\\]/.test(raw), 'vm-network-url-invalid');
  const url = new URL(raw);
  check(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
    && !url.hostname.endsWith('.') && !url.hostname.includes('%'), 'vm-network-url-invalid');
  return url;
}
function requestHeaders(url: URL, body: Uint8Array, input: VmNetworkRequest['headers']): Record<string, string> {
  const result: Record<string, string> = { host: url.host, connection: 'close', 'content-length': String(body.length) };
  if (input) for (const [key, value] of Object.entries(input)) {
    check((key === 'accept' || key === 'content-type') && typeof value === 'string' && value.length <= 1024
      && !/[^\x20-\x7e]/.test(value), 'vm-network-header-denied');
    result[key] = value;
  }
  return result;
}
function wireBytes(url: URL, method: string, headers: Record<string, string>, body: Uint8Array): number {
  return Buffer.byteLength(`${method} ${url.pathname}${url.search} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`) + body.length;
}
interface LiveGrant {
  grant: VmNetworkGrant; revoked: boolean; requests: number; requestBytes: number; responseBytes: number;
  active: Set<AbortController>;
}
/** No grant is loaded/restored automatically. Guest requests confer no authority.
 * Create only in the trusted host; root binds this port to the exact executor
 * owner/action and explicit user approval, never an arbitrary HTTP endpoint. */
export class VmNetworkBroker {
  private readonly grants = new Map<string, LiveGrant>();
  private closed = false;
  constructor(private readonly ledger: VmNetworkLedger, private readonly transport: VmNetworkTransport, private readonly owner: VmNetworkOwnerPort) {}
  grant(input: VmNetworkGrantInput, explicitUserAction: boolean): VmNetworkGrant {
    check(!this.closed, 'vm-network-broker-closed');
    check(explicitUserAction === true, 'vm-network-explicit-grant-required'); scopeValid(input.scope); this.owner.assertCurrent(input.scope); this.ledger.assertScopeClear(input.scope);
    check(input.credentialOwner === 'none' && input.dns === 'pinned-no-lookup' && input.proxy === 'none', 'vm-network-policy-unsupported');
    check(Array.isArray(input.destinations) && limit(input.destinations.length, 1, 16)
      && limit(input.maxRequests, 1, 100) && limit(input.maxRequestBytes, 1, 16 * 1024 * 1024)
      && limit(input.maxResponseBytes, 1, 16 * 1024 * 1024) && limit(input.maxRedirects, 0, 5)
      && limit(input.timeoutMs, 1, 60_000), 'vm-network-limits-invalid');
    const origins = new Set<string>();
    for (const d of input.destinations) {
      const u = urlOf(d.origin);
      check(u.origin === d.origin && !origins.has(d.origin), 'vm-network-origin-invalid'); origins.add(d.origin);
      check(Array.isArray(d.addresses) && limit(d.addresses.length, 1, 8) && d.addresses.every(isVmNetworkPublicAddress)
        && Array.isArray(d.methods) && limit(d.methods.length, 1, methods.size) && d.methods.every(m => methods.has(m)), 'vm-network-destination-invalid');
      const literal = u.hostname.replace(/^\[|\]$/g, '');
      check(!isIP(literal) || d.addresses.every(a => a === literal), 'vm-network-address-mismatch');
    }
    const grant: VmNetworkGrant = structuredClone({ ...input, id: randomUUID() });
    this.grants.set(grant.id, { grant, revoked: false, requests: 0, requestBytes: 0, responseBytes: 0, active: new Set() });
    return structuredClone(grant);
  }
  /** Passive exact historical receipt lookup for trusted ToolJournal projection.
   * No grant restoration, transport effect or uncertain operation replay. */
  receipt(scope: VmNetworkScope, requestId: string): VmNetworkReceipt | undefined {
    return structuredClone(this.ledger.read(vmNetworkRequestKey(scope, requestId), scope));
  }
  async revoke(scope: VmNetworkScope, grantId: string, explicitUserAction: boolean): Promise<void> {
    check(explicitUserAction === true, 'vm-network-explicit-revoke-required'); scopeValid(scope);
    const live = this.grants.get(grantId); check(live && sameScope(live.grant.scope, scope), 'vm-network-grant-mismatch');
    live.revoked = true;
    for (const controller of live.active) controller.abort();
    await this.owner.stop(structuredClone(scope));
  }
  /** Trusted task-generation retirement/cancellation hook; no new authority. */
  async cancelScope(scope: VmNetworkScope): Promise<void> {
    scopeValid(scope); let found = false;
    for (const live of this.grants.values()) if (sameScope(live.grant.scope, scope)) {
      found = true; live.revoked = true;
      for (const controller of live.active) controller.abort();
    }
    if (found) await this.owner.stop(structuredClone(scope));
  }
  async close(): Promise<void> {
    this.closed = true;
    const scopes = new Map<string, VmNetworkScope>();
    for (const live of this.grants.values()) scopes.set(JSON.stringify(live.grant.scope), live.grant.scope);
    const results = await Promise.allSettled([...scopes.values()].map(scope => this.cancelScope(scope)));
    if (results.some(result => result.status === 'rejected')) throw new Error('vm-network-owner-stop-unconfirmed');
  }
  async request(original: VmNetworkRequest, options?: { signal?: AbortSignal }): Promise<VmNetworkResult> {
    scopeValid(original.scope); check(id(original.requestId), 'vm-network-request-id-invalid');
    check(typeof original.method === 'string' && methods.has(original.method), 'vm-network-method-denied');
    check(!original.body || original.body instanceof Uint8Array, 'vm-network-body-invalid');
    check((original.body?.length ?? 0) <= 16 * 1024 * 1024, 'vm-network-body-limit');
    const input = { ...original, scope: { ...original.scope }, headers: original.headers ? { ...original.headers } : undefined, body: Uint8Array.from(original.body ?? []) };
    check(!['GET', 'HEAD'].includes(input.method) || input.body.length === 0, 'vm-network-body-denied');
    let url = urlOf(input.url); let method = input.method; let body = input.body;
    const headers = requestHeaders(url, body, input.headers);
    const requestKey = vmNetworkRequestKey(input.scope, input.requestId);
    const fingerprint = hash(JSON.stringify({ grantId: input.grantId, url: url.href, method, headers, body: hash(body) }));
    const live = this.grants.get(input.grantId);
    check(live && sameScope(live.grant.scope, input.scope), 'vm-network-grant-mismatch');
    this.owner.assertCurrent(input.scope);
    const prior = this.ledger.read(requestKey, input.scope);
    if (prior) { check(prior.fingerprint === fingerprint, 'vm-network-request-conflict'); return { receipt: structuredClone(prior) }; }
    check(!this.closed && !live.revoked, 'vm-network-grant-revoked');
    check(!options?.signal?.aborted, 'vm-network-cancelled-before-dispatch'); this.ledger.assertScopeClear(input.scope);
    const controller = new AbortController();
    let sent = false;
    let receipt: VmNetworkReceipt = { version: 1, requestKey, grantId: input.grantId, scope: input.scope, requestId: input.requestId, fingerprint,
      state: 'unknown', reason: 'vm-network-reserved-outcome-unknown', requests: 0, requestBytes: 0, responseBytes: 0 };
    // Global reservation precedes any await or transport effect and suppresses
    // duplicate request IDs even after process loss or uncertain ledger finish.
    this.ledger.reserve(structuredClone(receipt));
    live.active.add(controller);
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener('abort', onAbort, { once: true });
    if (options?.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), live.grant.timeoutMs);
    const finish = (next: VmNetworkReceipt): VmNetworkResult => {
      try { this.ledger.finish(structuredClone(next)); return { receipt: structuredClone(next) }; }
      catch { return { receipt: { ...receipt, state: 'unknown', reason: 'vm-network-receipt-persistence-unknown' } }; }
    };
    try {
      for (let redirects = 0;; redirects++) {
        this.owner.assertCurrent(input.scope);
        check(!live.revoked && !controller.signal.aborted, 'vm-network-revoked-or-cancelled');
        const destination = live.grant.destinations.find(d => d.origin === url.origin && d.methods.includes(method));
        check(destination, 'vm-network-destination-denied');
        const hopHeaders = requestHeaders(url, body, input.headers), bytes = wireBytes(url, method, hopHeaders, body);
        // Reserve all concurrent response allowance to one active request. This
        // prevents parallel hops from overspending the shared byte budget.
        check(live.active.size === 1, 'vm-network-grant-busy');
        check(live.requests < live.grant.maxRequests && live.requestBytes + bytes <= live.grant.maxRequestBytes
          && live.responseBytes < live.grant.maxResponseBytes, 'vm-network-budget-exhausted');
        live.requests++; live.requestBytes += bytes; receipt.requests++; receipt.requestBytes += bytes;
        sent = true;
        const response = await this.transport.request({ url: new URL(url.href), address: destination.addresses[0]!, method,
          headers: Object.freeze(hopHeaders), body: Uint8Array.from(body), maxResponseBytes: live.grant.maxResponseBytes - live.responseBytes,
          timeoutMs: live.grant.timeoutMs, signal: controller.signal });
        check(Number.isInteger(response.statusCode) && response.statusCode >= 100 && response.statusCode <= 599
          && response.body instanceof Uint8Array && response.body.length <= live.grant.maxResponseBytes - live.responseBytes, 'vm-network-response-invalid');
        live.responseBytes += response.body.length; receipt.responseBytes += response.body.length;
        this.owner.assertCurrent(input.scope); check(!live.revoked && !controller.signal.aborted, 'vm-network-revoked-or-cancelled');
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.location !== undefined) {
          check(redirects < live.grant.maxRedirects && typeof response.location === 'string' && response.location.length <= 8192, 'vm-network-redirect-denied');
          const next = urlOf(new URL(response.location, url).href);
          check(!(url.protocol === 'https:' && next.protocol !== 'https:'), 'vm-network-redirect-downgrade-denied');
          // Preserve semantics; only 303 explicitly changes a write to GET.
          if (response.statusCode === 303 && method !== 'HEAD') { method = 'GET'; body = new Uint8Array(); }
          if ((response.statusCode === 301 || response.statusCode === 302) && !['GET', 'HEAD'].includes(method)) throw new Error('vm-network-redirect-method-ambiguous');
          url = next; continue;
        }
        receipt = { ...receipt, state: 'completed', reason: 'vm-network-http-response-captured', statusCode: response.statusCode, responseSha256: hash(response.body) };
        const result = finish(receipt);
        if (result.receipt.state === 'completed') result.response = { statusCode: response.statusCode, body: Uint8Array.from(response.body) };
        else {
          live.revoked = true; controller.abort();
          try { await this.owner.stop(structuredClone(input.scope)); } catch { /* unresolved receipt remains authoritative */ }
        }
        return result;
      }
    } catch (error) {
      receipt = { ...receipt, state: sent ? 'unknown' : 'never-sent', reason: error instanceof Error && /^vm-network-[a-z-]+$/.test(error.message) ? error.message : 'vm-network-transport-outcome-unknown' };
      const result = finish(receipt);
      if (sent) {
        live.revoked = true; controller.abort();
        try { await this.owner.stop(structuredClone(input.scope)); } catch { /* durable unknown remains; no rollback or replay claim */ }
      }
      return result;
    } finally { clearTimeout(timer); options?.signal?.removeEventListener('abort', onAbort); live.active.delete(controller); }
  }
}
