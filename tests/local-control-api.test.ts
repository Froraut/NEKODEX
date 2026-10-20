import {afterEach,expect,test} from 'bun:test';
import {existsSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalControlApiPolicy,createLocalControlApiRoutes} from '../src/local-control-api';
import {ConversationHistoryStore} from '../src/conversation-history';
const roots:string[]=[],historyStores:ConversationHistoryStore[]=[];
afterEach(()=>{for(const history of historyStores.splice(0))history.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'nekodex-local-control-synthetic-'));roots.push(root);return root;}
test('disabled-by-default hash-only policy, one-time mint/rotation, immediate revocation and separate content consent',()=>{
  const root=fixture(),policy=new LocalControlApiPolicy(root);
  expect(policy.status()).toMatchObject({enabled:false,historyContent:false,credentialConfigured:false});expect(existsSync(policy.path)).toBe(false);
  expect(()=>policy.change('enable')).toThrow('consent');
  const first=policy.change('enable',{consent:true});expect(first.readToken).toMatch(/^nk-read-[a-f0-9]{64}$/);
  expect(policy.authenticate(first.readToken!)).toBe(true);
  expect(readFileSync(policy.path,'utf8')).not.toContain(first.readToken!);
  expect(statSync(policy.path).mode&0o777).toBe(0o600);
  expect(statSync(join(root,'local-control-api')).mode&0o777).toBe(0o700);
  expect(policy.change('enable',{consent:true}).readToken).toBeUndefined();
  expect(()=>policy.change('history-consent',{enabled:true})).toThrow('consent');
  policy.change('history-consent',{enabled:true,consent:true});expect(policy.status().historyContent).toBe(true);
  const rotated=policy.change('rotate',{consent:true});expect(policy.authenticate(first.readToken!)).toBe(false);expect(policy.authenticate(rotated.readToken!)).toBe(true);
  policy.change('disable');expect(policy.status()).toMatchObject({enabled:false,historyContent:false});expect(policy.authenticate(rotated.readToken!)).toBe(false);
  expect(new LocalControlApiPolicy(root).status().enabled).toBe(false);
});
test('actual HTTP read credential has bounded metadata-only routes, exact local guards, separate history access and no action upgrade',async()=>{
  const root=fixture(),history=new ConversationHistoryStore({coreHome:root});historyStores.push(history);history.setRecordingEnabled(true);
  history.record({clientId:'synthetic-client',threadId:'synthetic-thread',messageId:'synthetic-msg',revisionId:'r1',revisionNumber:1,turnId:null,compactionId:null,role:'user',author:'unknown',source:'manual-import',text:'Synthetic private conversation',timestamp:1000,coverage:'partial',coverageReason:'selected-text',sensitivity:'caller-validated',capturePolicy:'user-assistant-text-v1'});
  let sourceCalls=0,actionCalls=0;
  const admin='fixture-admin-credential-distinct-from-read';
  let server:Bun.Server<undefined>;
  const routes=createLocalControlApiRoutes({coreHome:root,authorizeAdmin:req=>req.headers.get('authorization')===`Bearer ${admin}`,port:()=>server.port!,peerAddress:req=>server.requestIP(req)?.address,
    localGuard:(req,url,port)=>{const host=req.headers.get('host');return host!==`127.0.0.1:${port}`||req.headers.has('origin')&&req.headers.get('origin')!==`http://${host}`?new Response('Forbidden',{status:403}):undefined;},
    sources:{status:()=>({version:'synthetic-v1',ready:true}),tasks:()=>{sourceCalls++;return [{id:'synthetic-task',state:'ready',kind:'native',secret:'MUST NOT LEAK',originalRequest:'MUST NOT LEAK'} as any];},agentTasks:()=>undefined,history:()=>history},agentAction:input=>{actionCalls++;return {actionId:input.actionId};}});
  server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async req=>await routes(req)??new Response('Unrelated route',{status:404})});
  const base=`http://127.0.0.1:${server.port}`;
  const call=(path:string,token:string,body?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  try{
    expect((await call('/api/v1/tasks','wrong')).status).toBe(404);expect(sourceCalls).toBe(0);
    const minted=await(await call('/admin/local-control-api',admin,{action:'enable',consent:true})).json();const token=minted.value.readToken as string;
    expect((await call('/api/v1/status','wrong')).status).toBe(401);
    expect((await call('/api/v1/tasks',token,undefined,{origin:'https://untrusted.example'})).status).toBe(403);
    const tasks=await(await call('/api/v1/tasks?limit=1&offset=0',token)).json();expect(tasks.value).toMatchObject({total:1,content:'metadata-only',limit:1});expect(JSON.stringify(tasks)).not.toContain('MUST NOT LEAK');
    expect((await call('/api/v1/agent-tasks',token)).status).toBe(503);
    expect((await call('/api/v1/tasks?limit=101',token)).status).toBe(400);
    expect((await call('/api/v1/tasks?arbitrary=http://external',token)).status).toBe(400);
    const coverage=await(await call('/api/v1/history',token)).json();expect(coverage.value).toMatchObject({totalMessages:1,contentAccess:false});expect(JSON.stringify(coverage)).not.toContain('synthetic-thread');
    expect((await call('/api/v1/history?view=threads',token)).status).toBe(403);
    expect((await call('/admin/local-control-api',token,{action:'history-consent',enabled:true,consent:true})).status).toBe(403);
    expect((await call('/admin/agent-mode',token,{action:'step'})).status).toBe(403);
    expect((await call('/api/v1/tasks',token,{action:'step'})).status).toBe(403);expect(actionCalls).toBe(0);
    await call('/admin/local-control-api',admin,{action:'history-consent',enabled:true,consent:true});
    const text=await(await call('/api/v1/history?view=messages&clientId=synthetic-client&threadId=synthetic-thread',token)).json();expect(text.value.items[0].text).toBe('Synthetic private conversation');
    for(let i=0;i<5;i++)history.record({clientId:'synthetic-client',threadId:'large-synthetic-thread',messageId:`large-${i}`,revisionId:'r1',revisionNumber:1,turnId:null,compactionId:null,role:'assistant',author:'assistant',source:'manual-import',text:'z'.repeat(450000),timestamp:2000+i,coverage:'partial',coverageReason:'selected-text',sensitivity:'caller-validated',capturePolicy:'user-assistant-text-v1'});
    expect((await call('/api/v1/history?view=messages&clientId=synthetic-client&threadId=large-synthetic-thread&limit=100',token)).status).toBe(413);
    expect((await call('/api/v1/history?view=messages&clientId=synthetic-client&threadId=large-synthetic-thread&limit=1',token)).status).toBe(200);
    const action={taskId:'task',actionId:'stable-id',familyId:'family',generation:1,revision:1,operation:'pause',explicitUserAction:true};
    expect((await call('/admin/local-control-api-action',admin,action)).status).toBe(202);expect(actionCalls).toBe(1);
    expect((await call('/admin/local-control-api-action',admin,{...action,explicitUserAction:false})).status).toBe(400);expect(actionCalls).toBe(1);
    expect((await call('/admin/local-control-api-action',admin,{...action,operation:'shell',command:'arbitrary'})).status).toBe(400);expect(actionCalls).toBe(1);
    await call('/admin/local-control-api',admin,{action:'disable'});expect((await call('/api/v1/status',token)).status).toBe(404);
  }finally{await server.stop(true);}
});
test('read credentials are rejected for nonloopback peer, and Electron consumes one-time raw copy without renderer exposure',async()=>{
  const root=fixture(),policy=new LocalControlApiPolicy(root),minted=policy.change('enable',{consent:true});
  const route=createLocalControlApiRoutes({coreHome:root,authorizeAdmin:()=>false,localGuard:()=>undefined,port:()=>11111,peerAddress:()=>undefined,sources:{status:()=>({version:'test',ready:true})}});
  expect((await route(new Request('http://127.0.0.1:11111/api/v1/status',{headers:{authorization:`Bearer ${minted.readToken}`}})))?.status).toBe(403);
  const {registerLocalControlApi}=await import('../launcher/electron/ipc/local-control-api.cjs');
  const handlers=new Map<string,Function>();let copied='';
  registerLocalControlApi({handle:(name:string,fn:Function)=>handlers.set(name,fn),runtimeHost:{supervisor:{readConfig:()=>({}),ownedRuntimeReady:async()=>true,control:async()=>({ok:true,value:minted})}},clipboard:{writeText:(value:string)=>{copied=value;}}});
  const received=await handlers.get('launcher:local-control-api')!({}, {action:'enable',consent:true});expect(received.tokenCopied).toBe(true);expect(copied).toBe(minted.readToken!);expect(JSON.stringify(received)).not.toContain(minted.readToken!);
});
