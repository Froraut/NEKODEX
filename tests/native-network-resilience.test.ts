import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAUNCHER_BROWSER_IDLE_URL } from '../src/launcher-browser-host';

test('native transport continues on its verified proxy during a hung GUI check and blocks after rejection', async () => {
 const dir=mkdtempSync(join(tmpdir(),'nekodex-native-route-'));
 const keys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','CODEX_CHATGPT_WEB_NATIVE_PROXY','CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY','CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR'];
 const saved=keys.map(k=>[k,process.env[k]] as const); const originalFetch=globalThis.fetch;
 const descriptor=join(dir,'launcher-browser.json');
 writeFileSync(descriptor,JSON.stringify({version:3,kind:'codex-web-gpt-launcher',profile:'production',pid:process.pid,
 endpoint:'http://127.0.0.1:48125',control:{endpoint:'http://127.0.0.1:48125',token:'t'.repeat(48)},
 helper:{executable:process.execPath,script:import.meta.path},partition:'persist:codex-web-gpt-chatgpt',
 idleUrl:LAUNCHER_BROWSER_IDLE_URL,surfaceId:'s'.repeat(32),surfaceTargets:{},createdAt:new Date().toISOString()}),{mode:0o600});
 for(const key of keys) delete process.env[key];
 process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR=descriptor;
 process.env.CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY='http://127.0.0.1:48123';
 let settle!: (response:Response)=>void; let controls=0; const proxies:unknown[]=[];
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit & {proxy?:string})=>{
  const url=input instanceof Request?input.url:String(input);
  if(url.startsWith('http://127.0.0.1:48125')) {controls++;return new Promise<Response>(r=>{settle=r;});}
  proxies.push(init?.proxy);return new Response('native reply');
 }) as typeof fetch;
 try {
  const network=await import(new URL('../src/native-network.ts?resilience',import.meta.url).href);
  const request=()=>new Request('https://chatgpt.com/backend-api/codex/responses',{method:'POST',body:'{}'});
  expect(await (await network.fetchNativeCodex(request())).text()).toBe('native reply');
  expect(await (await network.fetchNativeCodex(request())).text()).toBe('native reply');
  expect(controls).toBe(1);expect(proxies).toEqual(['http://127.0.0.1:48123','http://127.0.0.1:48123']);
  settle(new Response('',{status:403})); await Bun.sleep(0);
  await expect(network.fetchNativeCodex(request())).rejects.toThrow('HTTP 403');
  expect(network.nativeNetworkBackgroundReady()).toBe(false);
  expect(proxies.length).toBe(2);
 } finally {
  globalThis.fetch=originalFetch;
  for(const [k,v] of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  rmSync(dir,{recursive:true,force:true});
 }
});
