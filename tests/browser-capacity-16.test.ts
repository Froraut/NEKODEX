import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';

// Keep the historical default-capacity cases independent of the operator's saved setting.
const previousCapacity = process.env.CODEX_CHATGPT_WEB_BROWSER_CAPACITY;
process.env.CODEX_CHATGPT_WEB_BROWSER_CAPACITY = '16';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { ChatGptBrowserWorker } = await import(root + '/src/adapters/chatgpt-web/browser-worker.ts');
const { ChatGptTurnSessions, ChatGptTraceFeed, ChatGptTextFeed } = await import(root + '/src/adapters/chatgpt-web/turn-execution.ts');
if (previousCapacity === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_CAPACITY;
else process.env.CODEX_CHATGPT_WEB_BROWSER_CAPACITY = previousCapacity;

test('worker admits 16 distinct requests, rejects 17th, and reuses a released slot', async () => {
  const releases = new Map<string, () => void>();
  const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: {browserHost: 'managed-chrome'}, activeRuns: new Map(),
    runExclusive: (turn: any) => new Promise(resolve => releases.set(turn.traceId, () => resolve(turn.traceId))),
  });
  const turn = (id: string) => ({traceId: id});
  const active = Array.from({length: 16}, (_, i) => worker.run(turn('trace-' + i)));
  await Promise.resolve();
  expect(releases.size).toBe(16);
  await expect(worker.run(turn('overflow'))).rejects.toThrow('at most 16');
  await expect(worker.run(turn('trace-1'))).rejects.toThrow('Duplicate');
  releases.get('trace-0')!(); await active[0];
  const replacement = worker.run(turn('replacement')); await Promise.resolve();
  expect(worker.activeRuns.size).toBe(16);
  for (const release of releases.values()) release();
  const results = await Promise.all([...active, replacement]);
  expect(new Set(results).size).toBe(17);
  expect(worker.activeRuns.size).toBe(0);
});

test('registry separates 16 sessions and cancels only the selected native turn', async () => {
  const sessions = new ChatGptTurnSessions();
  const cancelled: string[] = [];
  const start = (id: string) => () => ({mode:'read-only', browser:new Promise(()=>{}),
    physicalSettlement:Promise.resolve(), trace:new ChatGptTraceFeed(), text:new ChatGptTextFeed(),
    cancel:()=>cancelled.push(id)});
  const active = Array.from({length:16}, (_,i)=>sessions.getOrCreate('key-'+i,start('key-'+i),'trace-'+i,'owner-'+i,'turn-'+i,'thread-'+i));
  expect(sessions.activeCount()).toBe(16);
  expect(()=>sessions.getOrCreate('overflow',start('overflow'))).toThrow('at most 16');
  expect(sessions.getOrCreate('key-7',()=>{throw Error('must reuse')})).toBe(active[7]);
  const stopped = sessions.cancelNativeTurn('thread-7','turn-7',Error('probe stop'));
  await stopped.settlement;
  expect(stopped.cancelled).toBe(1);
  expect(cancelled).toEqual(['key-7']);
  sessions.getOrCreate('replacement',start('replacement'));
  expect(sessions.activeCount()).toBe(16);
  sessions.clear();
});

test('launcher allocates ordinal 16, rejects 17th and reuses a free ordinal', async () => {
  const filename = root + '/launcher/electron/browser-host.cjs';
  const source = readFileSync(filename,'utf8');
  // Default remains 16; the launcher now accepts a persisted startup capacity.
  const patched = source;
  class View {
    webContents: any;
    constructor() {
      const c:any = new EventEmitter(); let url='about:blank';
      c.isDestroyed=()=>false; c.getURL=()=>url; c.loadURL=async(value:string)=>{url=value;};
      c.setZoomFactor=()=>{};c.stop=()=>{};this.webContents=c;
    }
  }
  const require = createRequire(filename); const module={exports:{}};
  runInNewContext(patched,{module,exports:module.exports,
    require:(name:string)=>name==='electron'?{WebContentsView:View}:require(name),
    Buffer,URL,console,process,setTimeout,clearTimeout,setInterval,clearInterval}, {filename});
  const {BrowserHost}:any=module.exports;
  const host:any=Object.assign(Object.create(BrowserHost.prototype),{
    partition:'probe-only',turnTabs:new Map(),state:{zoomFactor:1},
    window:{contentView:{addChildView(){}}},syncPowerSaveBlocker(){},presentTurnView(){},
    bindShellZoomShortcuts(){},bindTurnContents(){},markTurnTabSurface:async()=>{},
  });
  const tabs=[];
  for(let i=0;i<16;i++)tabs.push(await host.createTurnTab('trace-'+i,123,'conversation-'+i,'connector'));
  expect(new Set(tabs.map(t=>t.id)).size).toBe(16);
  expect(new Set(tabs.map(t=>t.surfaceId)).size).toBe(16);
  expect(new Set(tabs.map(t=>t.conversationKey)).size).toBe(16);
  expect(tabs.at(-1).ordinal).toBe(16);
  await expect(host.createTurnTab('overflow',123,'overflow','connector')).rejects.toThrow('16 browser tabs');
  host.turnTabs.delete(tabs[6].id);
  const replacement=await host.createTurnTab('replacement',123,'replacement','connector');
  expect(replacement.ordinal).toBe(7);
  expect(host.turnTabs.size).toBe(16);
});
