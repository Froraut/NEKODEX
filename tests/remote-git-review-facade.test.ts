import {expect,test} from 'bun:test';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,rmSync,statSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createRemoteWorkspaceService}=require('../launcher/electron/remote-workspace.cjs');
const {REMOTE_GIT_REVIEW_HELPER}=require('../launcher/electron/remote-git-review-helper.cjs');

test('main remote Git facade keeps signed action/receipt pairs across lost acknowledgement, restart and exact inspection',async()=>{
  const home=realpathSync(mkdtempSync(join(tmpdir(),'nekodex-remote-git-facade-'))),root=join(home,'repo'),storagePath=join(home,'registry.json'),template=join(home,'empty-template');
  mkdirSync(root,{mode:0o700});mkdirSync(template,{mode:0o700});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'});
  const git=(args:string[])=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-C',root,...args],{env,encoding:'utf8',timeout:5000});
  git(['init','-q','--template='+template]);git(['config','user.name','NEKODEX QA']);git(['config','user.email','qa@example.invalid']);
  writeFileSync(join(root,'hello.txt'),'baseline\n');git(['add','--','hello.txt']);git(['commit','-qm','baseline']);writeFileSync(join(root,'hello.txt'),'reviewed edit\n');
  let applies=0,drop=true,helperCalls=0;
  const options={storagePath,
    transportFactory:()=>({ready:Promise.resolve(),closed:false,close(){this.closed=true;},realpath:async(file:string)=>realpathSync(file),stat:async(file:string)=>{const s=statSync(file);return {size:s.size,mode:s.mode};}}),
    remoteGitReviewRunner:async(_host:unknown,request:any)=>{
      helperCalls++;
      if(request.action==='apply'){
        applies++;const saved=JSON.parse(readFileSync(storagePath,'utf8')),action=saved.gitReviewActions.find((x:any)=>x.actionId===request.payload.actionId),receipt=saved.receipts.find((x:any)=>x.id===action?.receiptId);
        expect(action).toMatchObject({state:'prepared',ownerHeld:true});expect(receipt).toMatchObject({actionId:action.actionId,state:'started',kind:'git-stage'});
      }
      const result=JSON.parse(execFileSync('/usr/bin/python3',['-c',REMOTE_GIT_REVIEW_HELPER],{input:JSON.stringify(request)+'\n',encoding:'utf8',env,...(request.action==='apply'?{}:{timeout:15000}),maxBuffer:1024*1024}));
      if(request.action==='apply'&&result.ok&&drop){drop=false;throw Error('Synthetic observation lost after helper terminal result');}
      return result;
    }};
  let service:any;
  try{
    writeFileSync(storagePath,JSON.stringify({version:1,hosts:[],drafts:[],receipts:[],worktrees:[],toolIntents:[]}),{mode:0o600});
    service=createRemoteWorkspaceService(options);const host=service.addHost({label:'Isolated Git facade QA',hostname:'fixture.invalid',username:userInfo().username,port:22,root});await service.connect(host.id);
    expect(JSON.parse(readFileSync(storagePath,'utf8')).version).toBe(2);
    const capture=await service.gitCapture(host.id,{}),actionId=randomUUID();const review=await service.gitPrepare(host.id,{actionId,captureId:capture.captureId,operation:'stage',paths:['hello.txt']});
    expect(review.state).toBe('reviewed');const uncertain=await service.gitApply(host.id,{actionId,reviewDigest:review.reviewDigest});expect(uncertain).toMatchObject({state:'unknown',ownerHeld:true,terminal:false});
    const unknownDisk=JSON.parse(readFileSync(storagePath,'utf8'));expect(unknownDisk.gitReviewActions[0]).toMatchObject({actionId,state:'unknown',receiptId:uncertain.receiptId});expect(unknownDisk.receipts.find((x:any)=>x.id===uncertain.receiptId).state).toBe('unknown');
    expect(()=>service.reconcile(host.id,uncertain.receiptId,'I inspected this operation.')).toThrow('exact Git action');
    expect(()=>service.gitPruneActions(host.id,[actionId])).toThrow();await service.destroy();service=undefined;
    service=createRemoteWorkspaceService(options);const before=helperCalls;expect(service.gitListActions(host.id)[0]).toMatchObject({actionId,state:'unknown',ownerHeld:true});expect(helperCalls).toBe(before);
    await service.connect(host.id);const reconciled=await service.gitInspectAction(host.id,actionId);expect(reconciled).toMatchObject({state:'completed',ownerHeld:false,terminal:true});
    const terminalDisk=JSON.parse(readFileSync(storagePath,'utf8'));expect(terminalDisk.gitReviewActions[0].state).toBe('completed');expect(terminalDisk.receipts.find((x:any)=>x.id===reconciled.receiptId).state).toBe('completed');
    expect(git(['show',':hello.txt'])).toBe('reviewed edit\n');await service.gitApply(host.id,{actionId,reviewDigest:review.reviewDigest});expect(applies).toBe(1);
    service.gitPruneActions(host.id,[actionId]);expect(service.gitListActions(host.id)).toEqual([]);expect(()=>service.gitApply(host.id,{actionId,reviewDigest:review.reviewDigest})).toThrow();expect(applies).toBe(1);
  }finally{await service?.destroy();rmSync(home,{recursive:true,force:true});}
},20000);
