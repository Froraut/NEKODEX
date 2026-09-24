import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NativeUsageOutbox } from '../src/native-usage-outbox';
import { LAUNCHER_BROWSER_IDLE_URL } from '../src/launcher-browser-host';

test('a new runtime replays persisted usage; an uncommitted 200 never removes it; duplicate receipt does', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'nekodex-usage-replay-'));
 const outbox = new NativeUsageOutbox(join(dir, 'native-usage-outbox'));
 const event = { schemaVersion:1 as const, eventId:randomUUID(), source:'native' as const, endpoint:'responses' as const,
 requestedModelId:'gpt-5', reportedModelId:null, startedAt:new Date().toISOString(), durationMs:1,
 outcome:'completed' as const, httpStatus:200, failureCategory:null, usageStatus:'unreported' as const, usage:null };
 outbox.put(event);
 const { UsageStore } = require("../launcher/electron/usage-store.cjs");
 const store = new UsageStore(dir);
 let phase = 0; const seen: string[] = [];
 const server = Bun.serve({hostname:'127.0.0.1', port:0, async fetch(request) {
  const body = await request.json() as {eventId:string}; seen.push(body.eventId);
  const receipt = phase ? store.recordNative(body) : {recorded:false, duplicate:false};
  return Response.json(phase === 2 ? receipt : {recorded:false, duplicate:false});
 }});
 const descriptor = join(dir, 'launcher-browser.json');
 writeFileSync(descriptor, JSON.stringify({version:3,kind:'codex-web-gpt-launcher', profile:'production',pid:process.pid,
 endpoint:server.url.origin, control:{endpoint:server.url.origin,token:'t'.repeat(48)},
 helper:{executable:process.execPath,script:import.meta.path}, partition:'persist:codex-web-gpt-chatgpt',
 idleUrl:LAUNCHER_BROWSER_IDLE_URL,surfaceId:'s'.repeat(32),surfaceTargets:{},createdAt:new Date().toISOString()}),{mode:0o600});
 const modulePath = new URL('../src/native-usage-telemetry.ts',import.meta.url).pathname;
 async function runOwner() {
  const child = Bun.spawn([process.execPath,'-e',`import {startNativeUsageDelivery} from ${JSON.stringify(modulePath)}; startNativeUsageDelivery(); await Bun.sleep(500);`],
   {env:{...process.env,CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR:descriptor},stdout:'pipe',stderr:'pipe'});
  expect(await child.exited).toBe(0);
 }
 try {
  await runOwner(); expect(outbox.pending()).toEqual([event]);
  phase = 1; await runOwner(); expect(outbox.pending()).toEqual([event]);
  phase = 2; await runOwner(); expect(outbox.pending()).toEqual([]);
  expect(seen).toEqual([event.eventId,event.eventId,event.eventId]);
  expect(Object.keys(store.state.native.receipts).length).toBe(1);
 } finally {server.stop(true);rmSync(dir,{recursive:true,force:true});}
}, 5000);
