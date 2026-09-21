import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeUsageOutbox } from '../src/native-usage-outbox';
import { NativeRouteCache } from '../src/native-route-cache';
import type { NativeUsageTelemetryEvent } from '../src/native-usage-telemetry';

function event(at: number): NativeUsageTelemetryEvent {
 return { schemaVersion: 1, eventId: randomUUID(), source: 'native', endpoint: 'responses',
 requestedModelId: 'gpt-5', reportedModelId: null, startedAt: new Date(at).toISOString(), durationMs: 20,
 outcome: 'completed', httpStatus: 200, failureCategory: null, usageStatus: 'reported',
 usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
}

test('unacknowledged usage survives a new outbox owner; acknowledged ids disappear', () => {
 const dir = mkdtempSync(join(tmpdir(), 'nekodex-outbox-'));
 try {
  let now = Date.now(); const e = event(now);
  const first = new NativeUsageOutbox(dir, () => now);
  first.put(e); first.put(e);
  const successor = new NativeUsageOutbox(dir, () => now);
  expect(successor.pending()).toEqual([e]);
  expect(statSync(join(dir, `${e.eventId}.json`)).mode & 0o777).toBe(0o600);
  successor.acknowledge(e.eventId);
  expect(first.pending()).toEqual([]);
  first.put(event(now)); now += 24 * 3600_000;
  expect(successor.pending()).toEqual([]);
 } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('outbox refuses extra payload fields and credential-shaped model identifiers', () => {
 const dir = mkdtempSync(join(tmpdir(), 'nekodex-outbox-'));
 try {
  const outbox = new NativeUsageOutbox(dir);
  expect(() => outbox.put({...event(Date.now()), prompt:'private'} as NativeUsageTelemetryEvent)).toThrow();
  expect(() => outbox.put({...event(Date.now()), requestedModelId:'https://private'})).toThrow();
  expect(outbox.pending()).toEqual([]);
 } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('warm native route serves while a shared refresh is hung, then adopts verified change', async () => {
 let now = 1000, calls = 0;
 const routes = new NativeRouteCache(() => now);
 routes.seed('responses', 'http://old:80');
 let resolve!: (proxy:string)=>void;
 const refresh = () => { calls++; return new Promise<string>(r => {resolve=r;}); };
 expect(await routes.resolve('responses', refresh, () => true)).toBe('http://old:80');
 expect(await routes.resolve('responses', refresh, () => true)).toBe('http://old:80');
 expect(calls).toBe(1);
 resolve('http://new:80'); await Promise.resolve(); await Promise.resolve();
 expect(await routes.resolve('responses', refresh, () => true)).toBe('http://new:80');
 now += 301_000;
 const expired = routes.resolve('responses', async () => {throw new Error('timeout');}, () => true);
 await expect(expired).rejects.toThrow('timeout');
});

test('explicit route rejection fails closed and endpoint routes stay separate', async () => {
 const routes = new NativeRouteCache(() => 1000);
 routes.seed('responses', 'http://proxy:80');
 expect(await routes.resolve('responses', async () => {throw new Error('rejected');}, () => false)).toBe('http://proxy:80');
 await Promise.resolve(); await Promise.resolve();
 await expect(routes.resolve('responses', async () => '', () => false)).rejects.toThrow('rejected');
 await expect(routes.resolve('compact', async () => {throw new Error('unavailable');}, () => true)).rejects.toThrow('unavailable');
});
