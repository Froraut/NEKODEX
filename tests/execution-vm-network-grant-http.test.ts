import {expect,test} from 'bun:test';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentToolsComposition} from '../src/agent-tools/composition';
import type {VmNetworkGrantInput} from '../src/execution-environments/network';

test('actual HTTP grant refusal proves no admission; post-admission fault and lost ACK remain uncertain',async()=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'neko-grant-http-')));
  let externalSends=0,lostAckAdmissions=0;
  const composition=new AgentToolsComposition({home,authorize:()=>true,isScopeActive:()=>true,
    vmNetworkTransport:{async request(){externalSends++;throw new Error('This grant fixture must not send external HTTP');}}});
  const grant=(patch:Partial<VmNetworkGrantInput>={}):VmNetworkGrantInput=>({scope:{taskId:'exact-http-grant-task',generation:1,actionId:randomUUID()},destinations:[{origin:'https://example.invalid',addresses:['8.8.8.8'],methods:['GET']}],credentialOwner:'none',dns:'pinned-no-lookup',proxy:'none',maxRequests:1,maxRequestBytes:4096,maxResponseBytes:4096,maxRedirects:0,timeoutMs:1000,...patch});
  const server=createServer(async(req,res)=>{
    try{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const response=await composition.handle(new Request('http://127.0.0.1'+req.url,{method:'POST',body:Buffer.concat(chunks)}));
      if(!response){res.writeHead(404);res.end();return;}
      if(req.url?.endsWith('?loseAck')&&response.status===200){lostAckAdmissions++;res.destroy();return;}
      res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
    }catch{res.destroy();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=(server.address() as {port:number}).port;
  const post=(body:unknown,suffix='')=>new Promise<{status:number;body:any}>((resolve,reject)=>{
    const bytes=Buffer.from(JSON.stringify(body));const req=httpRequest(`http://127.0.0.1:${port}/admin/agent-tools${suffix}`,{method:'POST',headers:{'content-type':'application/json','content-length':bytes.length,connection:'close'}},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>{try{resolve({status:res.statusCode!,body:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});
    });req.once('error',reject);req.end(bytes);
  });
  const submit=(input:VmNetworkGrantInput,suffix='')=>post({action:'grantVmNetwork',input,explicitUserAction:true},suffix);
  const originalGrant=composition.grantVmNetwork.bind(composition);
  try{
    const refused=await submit(grant({destinations:[{origin:'https://example.invalid',addresses:['127.0.0.1'],methods:['GET']}]}));
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ok:false,error:'agent_tools_conflict',message:'vm-network-destination-invalid'});
    expect(composition.vmNetworkStatus().grants).toEqual([]);
    const wrongOrigin=await submit(grant({destinations:[{origin:'https://example.invalid/path',addresses:['8.8.8.8'],methods:['GET']}]}));
    expect(wrongOrigin.body.message).toBe('vm-network-origin-invalid');
    const wrongPin=await submit(grant({destinations:[{origin:'https://8.8.8.8',addresses:['1.1.1.1'],methods:['GET']}]}));
    expect(wrongPin.body.message).toBe('vm-network-address-mismatch');
    const credentials=await submit(grant({destinations:[{origin:'https://user:pass@example.invalid',addresses:['8.8.8.8'],methods:['GET']}]}));
    expect(credentials.body.message).toBe('vm-network-url-invalid');
    expect(composition.vmNetworkStatus().grants).toHaveLength(0);
    const accepted=await submit(grant());expect(accepted.status).toBe(200);expect(composition.vmNetworkStatus().grants).toHaveLength(1);
    composition.grantVmNetwork=(input,explicit)=>{originalGrant(input,explicit);throw new Error('vm-network-origin-invalid');};
    const postAdmission=await submit(grant());
    expect(postAdmission.status).toBe(409);expect(postAdmission.body.error).toBe('agent_tools_conflict');
    expect(postAdmission.body.message).not.toBe('vm-network-origin-invalid');
    expect(postAdmission.body.message).toContain('Inspect the current saved configuration and receipt');
    expect(composition.vmNetworkStatus().grants).toHaveLength(2);
    composition.grantVmNetwork=originalGrant;
    const exactLost=grant();await expect(submit(exactLost,'?loseAck')).rejects.toThrow();
    expect(lostAckAdmissions).toBe(1);
    const status=await post({action:'vmNetworkStatus'});
    expect(status.body.value.grants).toHaveLength(3);
    const retained=status.body.value.grants.filter((row:any)=>row.grant.scope.actionId===exactLost.scope.actionId);
    expect(retained).toHaveLength(1);const {id,...actualInput}=retained[0].grant;
    expect(typeof id).toBe('string');expect(actualInput).toEqual(exactLost);
    expect(externalSends).toBe(0);
  }finally{
    composition.grantVmNetwork=originalGrant;await composition.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(home,{recursive:true,force:true});
  }
},5000);

test('actual supervisor propagates only exact pre-grant refusals while post-admission and lost replies stay uncertain',async()=>{
  const {RuntimeSupervisor}=require('../launcher/electron/runtime-supervisor.cjs');
  const home=realpathSync(mkdtempSync(join(tmpdir(),'neko-grant-supervisor-')));
  const composition=new AgentToolsComposition({home,authorize:()=>true,isScopeActive:()=>true});
  const supervisor=new RuntimeSupervisor({coreHome:home,app:{},logger:{}});
  let loseAck=false,forgeStatus=false,requests=0;
  const server=createServer(async(req,res)=>{
    try{
      requests++;const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const raw=Buffer.concat(chunks),body=JSON.parse(raw.toString());
      if(forgeStatus&&body.action==='vmNetworkStatus'){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'agent_tools_conflict',message:'vm-network-origin-invalid'}));return;}
      const response=await composition.handle(new Request('http://127.0.0.1'+req.url,{method:'POST',body:raw}));
      if(!response){res.writeHead(404);res.end();return;}
      if(loseAck&&response.status===200){res.destroy();return;}
      res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
    }catch{res.destroy();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const config={host:'127.0.0.1',port:(server.address() as {port:number}).port,controlToken:'synthetic-core-control'};
  const input=():VmNetworkGrantInput=>({scope:{taskId:'supervisor-grant-task',generation:1,actionId:randomUUID()},destinations:[{origin:'https://example.invalid',addresses:['8.8.8.8'],methods:['GET']}],credentialOwner:'none',dns:'pinned-no-lookup',proxy:'none',maxRequests:1,maxRequestBytes:4096,maxResponseBytes:4096,maxRedirects:0,timeoutMs:1000});
  const grantBody=(value:VmNetworkGrantInput)=>({action:'grantVmNetwork',input:value,explicitUserAction:true});
  const original=composition.grantVmNetwork.bind(composition);
  try{
    const bad=input();bad.destinations[0]!.addresses=['127.0.0.1'];
    const refusal=await supervisor.control(config,'agent-tools',{body:grantBody(bad)});
    expect(refusal).toEqual({ok:false,error:'agent_tools_conflict',message:'vm-network-destination-invalid'});
    expect(composition.vmNetworkStatus().grants).toHaveLength(0);
    forgeStatus=true;
    await expect(supervisor.control(config,'agent-tools',{body:{action:'vmNetworkStatus'}})).rejects.toThrow('HTTP 409');
    forgeStatus=false;
    composition.grantVmNetwork=(value,explicit)=>{original(value,explicit);throw new Error('vm-network-origin-invalid');};
    await expect(supervisor.control(config,'agent-tools',{body:grantBody(input())})).rejects.toThrow('HTTP 409');
    expect(composition.vmNetworkStatus().grants).toHaveLength(1);
    composition.grantVmNetwork=original;loseAck=true;
    const lost=input(),before=requests;
    let lostReply:unknown,lostError:unknown;
    try {lostReply=await supervisor.control(config,'agent-tools',{body:grantBody(lost),timeoutMs:1000});} catch(error) {lostError=error;}
    expect({lostReply,lostError:Boolean(lostError),requests:requests-before}).toEqual({lostReply:undefined,lostError:true,requests:1});
    expect(requests-before).toBe(1);
    expect(composition.vmNetworkStatus().grants.filter(row=>row.grant.scope.actionId===lost.scope.actionId)).toHaveLength(1);
    expect(composition.vmNetworkStatus().grants).toHaveLength(2);
  }finally{
    composition.grantVmNetwork=original;await composition.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(home,{recursive:true,force:true});
  }
},5000);
