import {expect,test} from 'bun:test';
import {createServer} from 'node:http';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createAgentToolsRoutes} from '../src/agent-tools/http';
import type {AgentToolsComposition} from '../src/agent-tools/composition';

test('exact missing Python backend closure reaches IPC while private errors and other actions stay redacted',async()=>{
  const {RuntimeSupervisor}=require('../launcher/electron/runtime-supervisor.cjs');
  const {registerAgentTools}=require('../launcher/electron/ipc/agent-tools.cjs');
  const home=realpathSync(mkdtempSync(join(tmpdir(),'neko-build-diagnostic-')));
  let reviews=0,privateFailure=false,forgeOtherAction=false,lastEnvelope:any;
  // Exercise the changed public error boundary without a local native VM bundle.
  const route=createAgentToolsRoutes({options:{authorize:()=>true},reviewPythonBuild(){reviews++;
    if(privateFailure)throw Error('python-build-backend-closure-missing /private/fixture-secret.py credential=sentinel');
    throw Error('python-build-backend-closure-missing');
  }} as unknown as AgentToolsComposition);
  const message='Python source build has no backend wheels. Set backendPath to the selected in-tree backend (for example ["."]) or select its backend wheels, then select and review again.';
  const server=createServer(async(req,res)=>{try{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const raw=Buffer.concat(chunks);
    const response=forgeOtherAction?Response.json({ok:false,error:'agent_tools_conflict',message},{status:409}):await route(new Request('http://127.0.0.1'+req.url,{method:'POST',body:raw}));
    if(!response){res.writeHead(404);res.end();return;}lastEnvelope=await response.json();res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify(lastEnvelope));
  }catch{res.destroy();}});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const config={host:'127.0.0.1',port:(server.address() as {port:number}).port,controlToken:'synthetic-control'};
  const supervisor=new RuntimeSupervisor({coreHome:home,app:{},logger:{}});
  supervisor.readConfig=()=>config;supervisor.ownedAgentRuntimeReady=async()=>true;
  const handlers=new Map<string,Function>();registerAgentTools({handle:(name:string,handler:Function)=>handlers.set(name,handler),runtimeHost:{supervisor}});
  const request=(body:unknown)=>handlers.get('launcher:agent-tools')!({},body);
  const review=()=>({action:'reviewPythonBuild',actionId:randomUUID(),selectionId:randomUUID(),scope:{taskId:randomUUID(),generation:1,toolCallId:'script-workspace-selection'},explicitUserAction:true});
  try{
    await expect(request(review())).rejects.toThrow(message);
    expect(lastEnvelope).toEqual({ok:false,error:'agent_tools_conflict',message});
    expect(reviews).toBe(1);
    privateFailure=true;await expect(request(review())).rejects.toThrow('HTTP 409');
    expect(lastEnvelope.message).toContain('Inspect the current saved configuration and receipt');
    expect(JSON.stringify(lastEnvelope)).not.toContain('/private/');expect(JSON.stringify(lastEnvelope)).not.toContain('sentinel');
    forgeOtherAction=true;await expect(request({action:'pythonBuildStatus'})).rejects.toThrow('HTTP 409');
    expect(reviews).toBe(2);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(home,{recursive:true,force:true});}
},5000);
