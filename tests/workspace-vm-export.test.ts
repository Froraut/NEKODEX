import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
const {createLocalWorkspaceService}=require('../launcher/electron/local-workspace.cjs');
const {createWorkspaceVmExportService}=require('../launcher/electron/workspace-vm-export.cjs');
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function fixture(bytes=Buffer.from([0,255,128,13,10])){
  const base=realpathSync(mkdtempSync(join(tmpdir(),'nekodex-vm-export-')));chmodSync(base,0o700);
  const root=join(base,'workspace');mkdirSync(root,{mode:0o700});const protectedRoot=join(root,'private-profile');mkdirSync(protectedRoot,{mode:0o700});
  let pickerRoot=root;const workspace=createLocalWorkspaceService({pickDirectory:async()=>pickerRoot});const selected=await workspace.pickRoot();
  const taskId=randomUUID(),familyId=randomUUID(),operationId=randomUUID();let generation=1,approved=false,publishes=0,reads=0,loseReply=false;
  const wrapped={...workspace,publishBinary(...args:unknown[]){publishes++;const result=workspace.publishBinary(...args);if(loseReply)throw new Error('lost after exact filesystem settlement');return result;}};
  const options={home:join(base,'exports'),workspaceService:wrapped,protectedRoots:[protectedRoot],
    async validateScope(s:{taskId:string;generation:number}){if(s.taskId!==taskId||s.generation!==generation)throw new Error('stale task');return{id:taskId,familyId,generation};},
    async validateIntent(){if(!approved)throw new Error('journal not approved');},
    async readCandidate(input:{operationId:string;sha256:string;scope:{taskId:string;familyId:string;generation:number}}){reads++;if(input.operationId!==operationId||input.sha256!==sha(bytes)||input.scope.taskId!==taskId||input.scope.familyId!==familyId||input.scope.generation!==1)throw new Error('candidate ownership mismatch');return bytes;}};
  const service=createWorkspaceVmExportService(options);
  const prepare=(destinationPath='result.bin',workspaceId=selected.id)=>service.prepare({scope:{taskId,generation},workspaceId,destinationPath,operationId,candidatePath:'output/result.bin',candidateSha256:sha(bytes),explicitUserAction:true});
  const request=(review:any)=>({scope:{taskId,generation:1,toolCallId:'export-'+randomUUID()},tool:'vm-shell/export',arguments:{reviewId:review.reviewId,reviewDigest:review.reviewDigest},idempotencyKey:randomUUID()});
  return{base,root,workspace,selected,service,options,prepare,request,taskId,bytes,async pickNested(){pickerRoot=join(root,'sub');mkdirSync(pickerRoot,{mode:0o700});return workspace.pickRoot();},approve(){approved=true;},advance(){generation++;},loseReply(){loseReply=true;},counts(){return{publishes,reads};},async close(){await service.destroy();rmSync(base,{recursive:true,force:true});}};
}
const mac=process.platform==='darwin'?describe:describe.skip;
mac('main-owned VM candidate export',()=>{
  test('effect admission is rechecked after an awaited candidate read even when task review remains available',async()=>{
    const f=await fixture();let current=true;const review=await f.prepare();
    const guarded=createWorkspaceVmExportService({...f.options,async validateIntent(){if(!current)throw new Error('pending export no longer active');},async readCandidate(input:Parameters<typeof f.options.readCandidate>[0]){const bytes=await f.options.readCandidate(input);current=false;return bytes;}});
    try{const result=await guarded.execute(f.request(review));expect(result.state).toBe('failed');expect(result.reason).toBe('vm-export-prepublication-refused');expect(f.counts().publishes).toBe(0);expect(existsSync(join(f.root,'result.bin'))).toBe(false);}
    finally{await guarded.destroy();await f.close();}
  });
  test('explicit approved export publishes the full 16MiB binary through the existing workspace owner, then duplicates only read receipts',async()=>{
    const bytes=Buffer.alloc(16*1024*1024,0xa5);bytes[0]=0;bytes[1]=255;const f=await fixture(bytes);
    try{const review=await f.prepare();expect(existsSync(join(f.root,'result.bin'))).toBe(false);expect(review.bytes).toBe(bytes.length);expect(JSON.stringify(review)).not.toContain(f.base);
      const request=f.request(review);await expect(f.service.execute(request)).rejects.toThrow();expect(f.counts().publishes).toBe(0);expect(existsSync(join(f.root,'result.bin'))).toBe(false);
      f.approve();const result=await f.service.execute(request);expect(result.state).toBe('completed');expect(result.result.sha256).toBe(sha(bytes));expect(readFileSync(join(f.root,'result.bin')).equals(bytes)).toBe(true);
      const inode=lstatSync(join(f.root,'result.bin')).ino;expect(await f.service.execute(request)).toEqual(result);expect(f.service.inspect(request)).toEqual(result);expect(f.counts().publishes).toBe(1);expect(lstatSync(join(f.root,'result.bin')).ino).toBe(inode);
      expect(f.service.currentOperation()).toBeNull();
    }finally{await f.close();}
  });
  test('concurrent edit and retained editor draft refuse export without overwriting either bytes or candidate',async()=>{
    const f=await fixture();try{const target=join(f.root,'existing.bin');writeFileSync(target,Buffer.from([0,1,2]));const review=await f.prepare('existing.bin');writeFileSync(target,Buffer.from([9,8,7]));f.approve();const request=f.request(review);
      expect((await f.service.execute(request)).state).toBe('failed');expect(readFileSync(target)).toEqual(Buffer.from([9,8,7]));expect(f.counts().publishes).toBe(0);expect(f.service.inspect(request)?.state).toBe('failed');expect(await f.service.execute(request)).toEqual(f.service.inspect(request));
      writeFileSync(join(f.root,'draft.txt'),'current');const opened=f.workspace.preview(f.selected.id,'draft.txt');const draft=f.workspace.retainDraft(f.selected.id,{path:'draft.txt',expectedRevision:opened.revision,text:'unsaved user draft'});
      await expect(f.prepare('draft.txt')).rejects.toThrow();expect(f.workspace.listDrafts(f.selected.id)[0].id).toBe(draft.id);expect(readFileSync(join(f.root,'draft.txt'),'utf8')).toBe('current');expect(f.bytes).toEqual(Buffer.from([0,255,128,13,10]));
      const nested=await f.pickNested();writeFileSync(join(f.root,'sub/shared.txt'),'disk baseline');const baseline=f.workspace.preview(f.selected.id,'sub/shared.txt');const aliasDraft=f.workspace.retainDraft(f.selected.id,{path:'sub/shared.txt',expectedRevision:baseline.revision,text:'parent grant unsaved draft'});
      await expect(f.prepare('shared.txt',nested.id)).rejects.toThrow();expect(f.workspace.listDrafts(f.selected.id).some((d:any)=>d.id===aliasDraft.id)).toBe(true);expect(readFileSync(join(f.root,'sub/shared.txt'),'utf8')).toBe('disk baseline');
    }finally{await f.close();}
  });
  test('symlink, reserved metadata and trusted protected profile targets are refused before publication',async()=>{
    const f=await fixture();try{const outside=join(f.base,'outside.bin');writeFileSync(outside,'preserved');symlinkSync(outside,join(f.root,'alias.bin'));
      for(const destination of ['alias.bin','.git/config','.execution-owner','private-profile/auth.json'])await expect(f.prepare(destination)).rejects.toThrow();
      expect(readFileSync(outside,'utf8')).toBe('preserved');expect(existsSync(join(f.root,'private-profile/auth.json'))).toBe(false);expect(f.counts().publishes).toBe(0);
    }finally{await f.close();}
  });
  test('lost publication response stays unknown and no duplicate reexports; explicit historical reconciliation proves the same written inode',async()=>{
    const f=await fixture();try{const review=await f.prepare(),request=f.request(review);f.approve();f.loseReply();const first=await f.service.execute(request);
      expect(first.state).toBe('outcome_unknown');expect(first.result.ownerHeld).toBe(true);expect(readFileSync(join(f.root,'result.bin')).equals(f.bytes)).toBe(true);const inode=lstatSync(join(f.root,'result.bin')).ino;
      expect(f.service.hasRetainedState(f.selected.id)).toBe(true);expect(f.service.hasRetainedState(randomUUID())).toBe(false);
      expect(await f.service.execute(request)).toEqual(first);expect(f.service.inspect(request)).toEqual(first);expect(f.counts().publishes).toBe(1);await expect(f.prepare('another.bin')).rejects.toThrow();
      f.advance();const restarted=createWorkspaceVmExportService({...f.options,workspaceService:f.workspace});const reads=f.counts().reads;
      try{expect(restarted.inspect(request).state).toBe('outcome_unknown');expect(restarted.hasRetainedState(f.selected.id)).toBe(true);const settled=await restarted.reconcile(request);expect(settled.state).toBe('completed');expect(settled.result.reconciled).toBe(true);expect(restarted.inspect(request)).toEqual(settled);expect(restarted.hasRetainedState(f.selected.id)).toBe(false);expect(f.counts().reads).toBe(reads);expect(f.counts().publishes).toBe(1);expect(lstatSync(join(f.root,'result.bin')).ino).toBe(inode);}finally{await restarted.destroy();}
    }finally{await f.close();}
  });
});
