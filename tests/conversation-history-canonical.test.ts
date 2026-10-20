import {expect,test} from 'bun:test';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexClientControl} from '../launcher/electron/codex-client-control.cjs';
import {createCanonicalNativeHistoryRecorder} from '../launcher/electron/canonical-native-history.cjs';
import {ConversationHistoryStore} from '../src/conversation-history';
import {conversationHistoryRequest} from '../src/conversation-history/http';
const THREAD='0199a001-0000-7000-8000-000000000001',SOURCE='a'.repeat(64);
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

test('owned canonical RPC producer records selected partial text, edits/revisions and privacy exclusions; exact consent/global epochs block late capture',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nekodex-canonical-history-synthetic-')),store=new ConversationHistoryStore({coreHome:home});
 const child:any=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.exitCode=null;
 const methods:string[]=[],launches:unknown[]=[];let stdin='',agentText='Original assistant answer',held:undefined|(()=>void),hold=false,started=deferred(),gets=0;
 const respond=(rpc:any,value:unknown)=>child.stdout.write(JSON.stringify({id:rpc.id,result:value})+'\n');
 const rows=()=>[
  {turnId:'turn-canonical',startedAtMs:1000,completedAtMs:2000,item:{type:'agentMessage',id:'assistant-message',text:agentText}},
  {turnId:'turn-canonical',startedAtMs:1000,completedAtMs:2000,item:{type:'userMessage',id:'credential-message',content:[{type:'text',text:'password=synthetic-sensitive-credential'}]}},
  {turnId:'turn-canonical',startedAtMs:1000,completedAtMs:2000,item:{type:'userMessage',id:'generated-message',content:[{type:'text',text:'<INSTRUCTIONS>synthetic generated system context</INSTRUCTIONS>'}]}},
  {turnId:'turn-canonical',startedAtMs:1000,completedAtMs:2000,item:{type:'functionCallOutput',id:'tool-message',output:'synthetic raw tool payload must never persist'}},
  {turnId:'turn-canonical',startedAtMs:1000,completedAtMs:2000,item:{type:'hookPrompt',id:'hook-message',fragments:[{text:'synthetic hook instructions must never persist'}]}},
  {turnId:'turn-canonical',startedAtMs:1000,completedAtMs:2000,item:{type:'reasoning',id:'reasoning-message',content:['synthetic reasoning must never persist']}},
  {turnId:'turn-canonical',startedAtMs:1000,completedAtMs:2000,item:{type:'userMessage',id:'user-message',clientId:null,content:[{type:'text',text:'Plain canonical user question'},{type:'image',url:'synthetic attachment must not persist'}]}},
 ];
 child.stdin=new Writable({write(chunk,_encoding,done){stdin+=String(chunk);for(;;){const newline=stdin.indexOf('\n');if(newline<0)break;const rpc=JSON.parse(stdin.slice(0,newline));stdin=stdin.slice(newline+1);methods.push(rpc.method);if(rpc.method==='initialize')queueMicrotask(()=>respond(rpc,{userAgent:'codex-cli/0.163.0',codexHome:home}));if(rpc.method==='thread/list')queueMicrotask(()=>respond(rpc,{data:[{id:THREAD,name:'Synthetic selected native task',status:{type:'notLoaded'}}],nextCursor:null}));if(rpc.method==='thread/read')queueMicrotask(()=>respond(rpc,{thread:{id:THREAD,status:{type:'notLoaded'}}}));if(rpc.method==='thread/items/list'){expect(rpc.params.sortDirection).toBe('desc');const reply=()=>respond(rpc,{data:rows(),nextCursor:'opaque-older-page',backwardsCursor:null});if(hold){held=reply;started.resolve();}else queueMicrotask(reply);}}done();}});
 child.stdin.on('finish',()=>{child.exitCode=0;child.emit('close',0,null);});
 const client=createCodexClientControl({executable:'/synthetic/codex',codexHome:home,cwd:home,environment:{PATH:'/synthetic/bin'},requestTimeoutMs:1000,stopGraceMs:10,spawnProcess:(...args:any[])=>{launches.push(args);return child;},terminateProcess:()=>{child.exitCode=0;child.emit('close',0,null);}});
 const backend=async(body:Record<string,unknown>)=>{const response=await conversationHistoryRequest(new Request('http://127.0.0.1/admin/conversation-history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),()=>store);const receipt=await response.json();if(!receipt.ok)throw new Error(receipt.error);return receipt.value;};
 const recorder=createCanonicalNativeHistoryRecorder({sourceId:SOURCE,getClient:()=>{gets++;return client;},requestHistory:backend});
 const {registerConversationHistory}=await import('../launcher/electron/ipc/conversation-history.cjs');
 const handlers=new Map<string,Function>();registerConversationHistory({handle:(name:string,fn:Function)=>handlers.set(name,fn),runtimeHost:{supervisor:{readConfig:()=>({}),ownedRuntimeReady:async()=>true,control:async(_config:unknown,_action:string,{body}:any)=>({ok:true,value:await backend(body)})}},clipboard:{writeText(){}},dialog:{showSaveDialog:async()=>({canceled:true})},canonicalRecorder:recorder});
 const api=(body:Record<string,unknown>)=>handlers.get('launcher:conversation-history')!({},body);
 try{
  expect((await api({action:'canonical-status',threadId:THREAD})).enabled).toBe(false);
  expect((await api({action:'canonical-refresh',threadId:THREAD})).outcome).toBe('disabled');expect(gets).toBe(0);expect(launches).toHaveLength(0);
  await expect(api({action:'canonical-consent',threadId:THREAD,enabled:true,consent:true,acknowledgeUnknownSecrets:true})).rejects.toThrow('Global opt-in');
  store.setRecordingEnabled(true);
  await expect(api({action:'canonical-consent',threadId:THREAD,enabled:true,consent:true,acknowledgeUnknownSecrets:false})).rejects.toThrow('acknowledgement');
  await api({action:'canonical-consent',threadId:THREAD,enabled:true,consent:true,acknowledgeUnknownSecrets:true});
  const listing=await api({action:'canonical-list'});expect(listing.items[0]).toMatchObject({threadId:THREAD,name:'Synthetic selected native task'});
  const first=await api({action:'canonical-refresh',threadId:THREAD});expect(first).toMatchObject({outcome:'captured',recorded:2,rejected:2,sourceExcluded:3});
  const identity={clientId:`codex-app-server:${SOURCE}`,threadId:THREAD,messageId:'assistant-message'};
  const original=store.getMessage(identity)!;expect(original).toMatchObject({author:'unknown',source:'native',coverage:'partial',capturePolicy:'canonical-thread-text-v1',sensitivity:'known-pattern-filtered',compactionId:null});
  expect(store.getMessage({...identity,messageId:'credential-message'})).toMatchObject({text:null,coverage:'rejected',coverageReason:'known-secret-content'});
  expect(store.getMessage({...identity,messageId:'generated-message'})).toMatchObject({text:null,coverageReason:'generated-instructions-or-schema'});
  for(const marker of ['synthetic-sensitive-credential','synthetic raw tool payload','synthetic generated system context','synthetic reasoning','synthetic hook instructions','synthetic attachment'])expect(readFileSync(store.path).includes(Buffer.from(marker))).toBe(false);
  const before=store.status().revisions;agentText='Edited assistant answer';
  await api({action:'canonical-refresh',threadId:THREAD});expect(store.getMessage(identity)?.revisionNumber).toBe(2);expect(store.getMessage({...identity,revisionId:original.revisionId})?.text).toBe('Original assistant answer');expect(store.search({query:'Original assistant'}).total).toBe(0);
  await api({action:'canonical-refresh',threadId:THREAD});expect(store.status().revisions).toBe(before+1);
  const edited=store.getMessage(identity)!;agentText='';
  await api({action:'canonical-refresh',threadId:THREAD});
  expect(store.getMessage(identity)).toMatchObject({text:'',revisionNumber:3,originalBytes:0});
  expect(store.search({query:'Edited assistant answer'}).total).toBe(0);
  expect(store.getMessage({...identity,revisionId:edited.revisionId})?.text).toBe('Edited assistant answer');
  hold=true;started=deferred();const pending=api({action:'canonical-refresh',threadId:THREAD});await started.promise;const count=store.status().revisions;
  await api({action:'canonical-consent',threadId:THREAD,enabled:false});agentText='Late read after revoke must not persist';held!();expect((await pending).outcome).toBe('revoked');expect(store.status().revisions).toBe(count);
  await api({action:'canonical-consent',threadId:THREAD,enabled:true,consent:true,acknowledgeUnknownSecrets:true});started=deferred();const oldGlobal=api({action:'canonical-refresh',threadId:THREAD});await started.promise;
  store.setRecordingEnabled(false);store.setRecordingEnabled(true);agentText='Late read from older global epoch';held!();expect((await oldGlobal).outcome).toBe('revoked');expect(store.status().revisions).toBe(count);
  hold=false;agentText='Fresh authorized next page';await api({action:'canonical-refresh',threadId:THREAD});expect(store.getMessage(identity)?.text).toBe(agentText);
  await api({action:'canonical-consent',threadId:THREAD,enabled:false});const oldGets=gets;expect((await api({action:'canonical-refresh',threadId:THREAD})).outcome).toBe('disabled');expect(gets).toBe(oldGets);
  await expect(api({action:'canonical-record',lease:{},page:{}})).rejects.toThrow('Invalid history request');
  await expect(api({action:'canonical-lease',sourceId:SOURCE,threadId:THREAD})).rejects.toThrow('Invalid history request');
  await expect(api({action:'canonical-refresh',threadId:THREAD,sourceId:'forged'})).rejects.toThrow('exact selected-thread');
  expect(launches).toHaveLength(1);expect(methods.filter(method=>!['initialize','initialized','thread/list','thread/read','thread/items/list'].includes(method))).toEqual([]);
 }finally{await client.destroy();store.close();rmSync(home,{recursive:true,force:true});}
},10000);
