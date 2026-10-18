import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationHistoryStore, captureValidatedNativeResponse } from "../src/conversation-history";
import { conversationHistoryRequest } from "../src/conversation-history/http";
const paths: string[] = [], stores: ConversationHistoryStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const path of paths.splice(0)) rmSync(path,{recursive:true,force:true}); });
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "nekodex-history-http-synthetic-")); paths.push(path);
  const store = new ConversationHistoryStore({coreHome:path}); stores.push(store);
  return {path,store};
}
function request(store: ConversationHistoryStore, body: Record<string,unknown>) {
  return conversationHistoryRequest(new Request("http://127.0.0.1/admin/conversation-history",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),()=>store);
}
test("admin action boundary requires explicit history and selected-text consent, labels manual provenance, deduplicates retries", async () => {
  const {store} = fixture();
  expect((await request(store,{action:"set-recording",enabled:true})).status).toBe(400);
  const enabled = await (await request(store,{action:"set-recording",enabled:true,consent:true})).json();
  expect(enabled.value).toMatchObject({recordingEnabled:true,captureMode:"explicit-selected-text",automaticCaptureAvailable:false});
  const selected = { action:"import-selected",clientId:"manual-selection",threadId:"synthetic selected task",messageId:"u1",revisionId:"u1-r1",revisionNumber:1,role:"user",author:"unknown",text:"Synthetic user text",timestamp:1000,sensitivityConfirmed:true,source:"native" };
  expect((await request(store,{...selected,sensitivityConfirmed:false})).status).toBe(400);
  expect((await (await request(store,selected)).json()).value.outcome).toBe("recorded");
  expect((await (await request(store,selected)).json()).value.outcome).toBe("duplicate");
  expect((await request(store,{...selected,messageId:"bad",role:"tool"})).status).toBe(400);
  expect(store.getMessage({clientId:"manual-selection",threadId:selected.threadId,messageId:"u1"})).toMatchObject({source:"manual-import",author:"unknown",coverage:"partial"});
  const exported = await (await request(store,{action:"export",clientId:"manual-selection",threadId:selected.threadId,messageRevisions:[{messageId:"u1",revisionId:"u1-r1"}]})).json();
  expect(exported.value.markdown).toContain("Synthetic user text");
  expect(exported.value.partial).toBe(true);
});
test("validated native producer adapter records explicit user and terminal assistant text only", () => {
  const {store}=fixture(); store.setRecordingEnabled(true);
  const input = {identity:{clientId:"synthetic-native-client",threadId:"verified-thread",turnId:"verified-turn",authority:"authenticated-native-producer" as const},sensitivity:"caller-validated" as const,timestamp:1000,
    userMessages:[{messageId:"human-u1",revisionId:"human-u1-r1",revisionNumber:1,text:"Plain selected user text",author:"agent" as const,sensitivity:"caller-validated" as const}],
    response:{status:"completed",output:[{type:"reasoning",text:"private reasoning"},{type:"function_call",arguments:"machine argument"},{type:"message",role:"system",id:"system",content:[{type:"output_text",text:"machine instruction"}]},{type:"message",role:"assistant",id:"assistant-m1",content:[{type:"output_text",text:"Plain assistant answer"}]}]}};
  expect(captureValidatedNativeResponse(store,input)).toHaveLength(2);
  expect(captureValidatedNativeResponse(store,input).every(result=>result.outcome==="duplicate")).toBe(true);
  expect(store.status()).toMatchObject({totalMessages:2,indexedMessages:2,incompleteMessages:2});
  expect(store.search({query:"private reasoning"}).total).toBe(0);
  expect(store.search({query:"machine"}).total).toBe(0);
  expect(store.search({query:"assistant"}).items[0]).toMatchObject({author:"assistant",source:"native",turnId:"verified-turn"});
  expect(()=>captureValidatedNativeResponse(store,{...input,identity:{...input.identity,authority:"body-claimed" as "authenticated-native-producer"}})).toThrow("authority");
});
test("Electron history registrar proxies only the owned runtime, copy and selected private export", async () => {
  const {path}=fixture();
  const {registerConversationHistory}=await import("../launcher/electron/ipc/conversation-history.cjs");
  const handles=new Map<string,Function>(); let ready=false; let copied=""; const calls:unknown[]=[];
  const destination=join(path,"selected.md");
  registerConversationHistory({handle:(name:string,fn:Function)=>handles.set(name,fn),runtimeHost:{supervisor:{readConfig:()=>({generation:"synthetic"}),ownedAgentRuntimeReady:async()=>ready,control:async(_config:unknown,action:string,options:unknown)=>{calls.push({action,options});return {ok:true,value:{recordingEnabled:false}};}}},clipboard:{writeText:(text:string)=>{copied=text;}},dialog:{showSaveDialog:async()=>({canceled:false,filePath:destination})}});
  await expect(handles.get("launcher:conversation-history")!({}, {action:"status"})).rejects.toThrow("current NEKODEX runtime");
  expect(calls).toHaveLength(0); ready=true;
  expect(await handles.get("launcher:conversation-history")!({}, {action:"status"})).toEqual({recordingEnabled:false});
  expect(calls).toEqual([{action:"conversation-history",options:{body:{action:"status"}}}]);
  await handles.get("launcher:conversation-history-copy")!({},"synthetic text"); expect(copied).toBe("synthetic text");
  expect(await handles.get("launcher:conversation-history-save")!({},"# Synthetic selected text")).toMatchObject({saved:true});
  expect(readFileSync(destination,"utf8")).toBe("# Synthetic selected text");
  expect(statSync(destination).mode & 0o777).toBe(0o600);
});
test.serial("actual server guards history with control token and releases its sole SQLite owner on stop", async () => {
  const path=mkdtempSync(join(tmpdir(),"nekodex-history-server-synthetic-")); paths.push(path);
  const previousHome=process.env.CODEX_CHATGPT_WEB_HOME;
  const previousDescriptor=process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  process.env.CODEX_CHATGPT_WEB_HOME=path;
  delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR;
  let server: {port:number|null;stop(close?:boolean):Promise<void>} | undefined;
  try {
    const {defaultConfig}=await import("../src/config");
    const {startServer}=await import("../src/server");
    const config={...defaultConfig(),port:0};
    server=startServer(config,{fetchUpstream:async()=>{throw new Error("Fixture must never call upstream");}});
    const endpoint=`http://127.0.0.1:${server.port}/admin/conversation-history`;
    const call=(token:string,body:unknown,origin?:string)=>fetch(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(origin?{origin}:{})},body:JSON.stringify(body)});
    expect((await call("wrong",{action:"status"})).status).toBe(401);
    expect((await call(config.controlToken,{action:"status"},"https://untrusted.example")).status).toBe(403);
    const status=await call(config.controlToken,{action:"status"});
    expect(status.status).toBe(200);
    expect((await status.json()).value.recordingEnabled).toBe(false);
    await call(config.controlToken,{action:"set-recording",enabled:true,consent:true});
    await server.stop(true); server=undefined;
    const reopened=new ConversationHistoryStore({coreHome:path}); stores.push(reopened);
    expect(reopened.status().recordingEnabled).toBe(true);
  } finally {
    await server?.stop(true);
    if(previousHome===undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME=previousHome;
    if(previousDescriptor===undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR; else process.env.CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR=previousDescriptor;
  }
});
