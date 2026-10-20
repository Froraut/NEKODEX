import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VmNetworkBroker, isVmNetworkPublicAddress, type VmNetworkGrantInput, type VmNetworkHop, type VmNetworkHopResponse, type VmNetworkTransport } from '../src/execution-environments/network';
import { DirectVmNetworkTransport } from '../src/execution-environments/network-transport';
import { FileVmNetworkLedger } from '../src/execution-environments/network-ledger';
const scope = { taskId: 'task-1', generation: 1, actionId: 'action-1' };
const policy = (): VmNetworkGrantInput => ({ scope: { ...scope }, destinations: [{ origin: 'https://example.com', addresses: ['93.184.216.34'], methods: ['GET', 'POST'] }],
  credentialOwner: 'none', dns: 'pinned-no-lookup', proxy: 'none', maxRequests: 3, maxRequestBytes: 8192, maxResponseBytes: 1024, maxRedirects: 1, timeoutMs: 1000 });
function fixture(send: (hop: VmNetworkHop) => Promise<VmNetworkHopResponse>) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-network-')));
  const calls: VmNetworkHop[] = [], stops: unknown[] = [];
  let current = true;
  const ledger = new FileVmNetworkLedger(join(directory, 'ledger'));
  const transport: VmNetworkTransport = { request: async hop => { calls.push(hop); return send(hop); } };
  const owner = { assertCurrent: () => { if (!current) throw new Error('vm-network-stale-scope'); }, stop: async (s: unknown) => { stops.push(s); } };
  const broker = new VmNetworkBroker(ledger, transport, owner);
  return { broker, ledger, transport, owner, calls, stops, stale: () => { current = false; }, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const ok = async () => ({ statusCode: 200, body: new Uint8Array([1, 2, 3]) });
function input(grantId: string, requestId = 'request-1') { return { grantId, scope: { ...scope }, requestId, method: 'GET', url: 'https://example.com/data' }; }

describe('VM network authority (inert transport; no sockets or VM boot)', () => {
  test('offline admission, exact owner scope, destination/method/header/body and public pin checks precede transport', async () => {
    const f = fixture(ok);
    try {
      expect(() => f.broker.grant(policy(), false)).toThrow('explicit-grant');
      for (const address of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '100.64.1.1', '::1', '::ffff:127.0.0.1', '2001:db8::1']) {
        expect(isVmNetworkPublicAddress(address)).toBe(false);
        const p = policy(); p.destinations[0]!.addresses = [address]; expect(() => f.broker.grant(p, true)).toThrow('destination-invalid');
      }
      const grant = f.broker.grant(policy(), true);
      for (const patch of [{ scope: { ...scope, generation: 2 } }, { method: 'CONNECT' }, { url: 'https://other.example/x' },
        { headers: { authorization: 'secret' } }, { url: 'https://user:pass@example.com/' }, { body: new Uint8Array([1]) }]) {
        try { await f.broker.request({ ...input(grant.id), ...patch } as never); } catch { /* parser rejection */ }
      }
      expect(f.calls).toHaveLength(0);
      await expect(new DirectVmNetworkTransport().request({ url: new URL('https://example.com/'), address: '127.0.0.1', method: 'GET', headers: {}, body: new Uint8Array(), maxResponseBytes: 10, timeoutMs: 50, signal: new AbortController().signal })).rejects.toThrow('transport-input-denied');
      f.stale(); await expect(f.broker.request(input(grant.id, 'stale'))).rejects.toThrow('stale-scope');
    } finally { f.cleanup(); }
  });
  test('approved request snapshots bytes, pins IP, records durable response and never replays duplicate/conflicting identity', async () => {
    const f = fixture(ok);
    try {
      const grant = f.broker.grant(policy(), true);
      // Caller cannot widen stored authority after approval.
      grant.destinations[0]!.origin = 'https://other.example';
      const result = await f.broker.request(input(grant.id));
      expect(result.receipt.state).toBe('completed'); expect(result.response?.body).toEqual(new Uint8Array([1, 2, 3]));
      expect(f.calls[0]!.address).toBe('93.184.216.34'); expect(f.calls[0]!.headers.host).toBe('example.com');
      expect(result.receipt.requestBytes).toBeGreaterThan(3);
      const duplicate = await f.broker.request(input(grant.id)); expect(duplicate.receipt).toEqual(result.receipt); expect(duplicate.response).toBeUndefined();
      await expect(f.broker.request({ ...input(grant.id), url: 'https://example.com/changed' })).rejects.toThrow('request-conflict');
      expect(f.calls).toHaveLength(1);
      expect(f.broker.receipt(scope, 'request-1')).toEqual(result.receipt);
      await f.broker.close(); expect(() => f.broker.grant(policy(), true)).toThrow('broker-closed');
      await expect(f.broker.request(input(grant.id, 'after-close'))).rejects.toThrow('grant-revoked');
    } finally { f.cleanup(); }
  });
  test('redirect targets are re-authorized, failed/unknown effects stop exact VM and quarantine scope across broker restart', async () => {
    const f = fixture(async () => ({ statusCode: 302, location: 'http://169.254.169.254/credentials', body: new Uint8Array() }));
    try {
      const grant = f.broker.grant(policy(), true), result = await f.broker.request(input(grant.id));
      expect(result.receipt.state).toBe('unknown'); expect(f.calls).toHaveLength(1); expect(f.stops).toEqual([scope]);
      expect((await f.broker.request(input(grant.id))).receipt.state).toBe('unknown'); expect(f.calls).toHaveLength(1);
      const restarted = new VmNetworkBroker(f.ledger, f.transport, f.owner);
      expect(() => restarted.grant(policy(), true)).toThrow('ledger-invalid');
    } finally { f.cleanup(); }
  });
  test('request/byte budgets reject before next effect; write redirects cannot silently change semantics', async () => {
    const f = fixture(ok);
    try {
      const p = policy(); p.maxRequests = 1;
      const grant = f.broker.grant(p, true); await f.broker.request(input(grant.id));
      expect((await f.broker.request(input(grant.id, 'request-2'))).receipt.state).toBe('never-sent'); expect(f.calls).toHaveLength(1);
      const tiny = policy(); tiny.maxRequestBytes = 1;
      const noBytes = f.broker.grant(tiny, true); expect((await f.broker.request(input(noBytes.id, 'request-3'))).receipt.state).toBe('never-sent'); expect(f.calls).toHaveLength(1);
    } finally { f.cleanup(); }
    const r = fixture(async () => ({ statusCode: 302, location: '/new', body: new Uint8Array() }));
    try {
      const grant = r.broker.grant(policy(), true);
      const result = await r.broker.request({ ...input(grant.id), method: 'POST', body: new Uint8Array([42]) });
      expect(result.receipt.reason).toBe('vm-network-redirect-method-ambiguous'); expect(result.receipt.state).toBe('unknown'); expect(r.calls).toHaveLength(1);
    } finally { r.cleanup(); }
  });
  test('explicitly allowed redirects preserve write method/body and share budgets; oversized responses quarantine', async () => {
    let sequence = 0;
    const f = fixture(async () => ++sequence === 1 ? { statusCode: 307, location: 'https://redirect.example/data', body: new Uint8Array([9]) } : { statusCode: 200, body: new Uint8Array([8, 7]) });
    try {
      const p = policy(); p.destinations.push({ origin: 'https://redirect.example', addresses: ['1.1.1.1'], methods: ['POST'] }); p.maxResponseBytes = 3;
      const grant = f.broker.grant(p, true);
      const result = await f.broker.request({ ...input(grant.id), method: 'POST', body: new Uint8Array([42]) });
      expect(result.receipt.state).toBe('completed'); expect(result.receipt.requests).toBe(2); expect(result.receipt.responseBytes).toBe(3);
      expect(f.calls[1]!.address).toBe('1.1.1.1'); expect(f.calls[1]!.method).toBe('POST'); expect(f.calls[1]!.body).toEqual(new Uint8Array([42]));
      expect(f.calls.map(c => c.maxResponseBytes)).toEqual([3, 2]);
      expect((await f.broker.request(input(grant.id, 'after-body-cap'))).receipt.state).toBe('never-sent'); expect(f.calls).toHaveLength(2);
    } finally { f.cleanup(); }
    const overflow = fixture(async () => ({ statusCode: 200, body: new Uint8Array(9) }));
    try {
      const p = policy(); p.maxResponseBytes = 8; const grant = overflow.broker.grant(p, true);
      const result = await overflow.broker.request(input(grant.id)); expect(result.receipt.state).toBe('unknown'); expect(result.response).toBeUndefined();
      expect(overflow.stops).toEqual([scope]);
    } finally { overflow.cleanup(); }
  });
  test('revoke aborts in-flight request, invokes exact owner stop and retains unknown effect without replay', async () => {
    const f = fixture(hop => new Promise((_resolve, reject) => hop.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
    try {
      const competitor = new VmNetworkBroker(f.ledger, f.transport, f.owner), otherGrant = competitor.grant(policy(), true);
      const grant = f.broker.grant(policy(), true), pending = f.broker.request(input(grant.id));
      await expect(competitor.request(input(otherGrant.id, 'competing-request'))).rejects.toThrow('ledger-invalid');
      expect(f.calls).toHaveLength(1); await f.broker.revoke(scope, grant.id, true);
      const result = await pending; expect(result.receipt.state).toBe('unknown'); expect(f.calls[0]!.signal.aborted).toBe(true);
      expect(f.stops.every(s => JSON.stringify(s) === JSON.stringify(scope))).toBe(true);
      expect((await f.broker.request(input(grant.id))).receipt.state).toBe('unknown'); expect(f.calls).toHaveLength(1);
    } finally { f.cleanup(); }
  });
  test('ToolJournal abort signal prevents dispatch or aborts pending transport with retained unknown effect', async () => {
    const f = fixture(hop => new Promise((_resolve, reject) => hop.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
    try {
      const grant = f.broker.grant(policy(), true), alreadyCancelled = new AbortController(); alreadyCancelled.abort();
      await expect(f.broker.request(input(grant.id, 'never-dispatched'), { signal: alreadyCancelled.signal })).rejects.toThrow('cancelled-before-dispatch');
      expect(f.calls).toHaveLength(0);
      const cancellation = new AbortController(), pending = f.broker.request(input(grant.id), { signal: cancellation.signal });
      expect(f.calls).toHaveLength(1); cancellation.abort();
      const result = await pending; expect(result.receipt.state).toBe('unknown'); expect(f.calls[0]!.signal.aborted).toBe(true);
      expect(f.stops).toEqual([scope]); expect(f.broker.receipt(scope, 'request-1')?.state).toBe('unknown');
    } finally { f.cleanup(); }
  });
  test('durable reservation alone remains unknown after crash; failed receipt persistence never claims completed', async () => {
    const f = fixture(ok);
    try {
      const grant = f.broker.grant(policy(), true);
      f.ledger.finish = () => { throw new Error('disk unavailable'); };
      const result = await f.broker.request(input(grant.id)); expect(result.receipt.state).toBe('unknown'); expect(result.response).toBeUndefined();
      const restarted = new VmNetworkBroker(f.ledger, f.transport, f.owner);
      expect(() => restarted.grant(policy(), true)).toThrow('ledger-invalid');
      expect((await f.broker.request(input(grant.id))).receipt.state).toBe('unknown'); expect(f.calls).toHaveLength(1);
    } finally { f.cleanup(); }
  });
});
