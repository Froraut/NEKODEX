import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
      const refused=f.request(review);expect((await f.service.execute(refused)).state).toBe('failed');expect(f.counts().publishes).toBe(0);expect(existsSync(join(f.root,'result.bin'))).toBe(false);
      f.approve();expect((await f.service.execute(refused)).state).toBe('failed');const request=f.request(review);const result=await f.service.execute(request);expect(result.state).toBe('completed');expect(result.result.sha256).toBe(sha(bytes));expect(readFileSync(join(f.root,'result.bin')).equals(bytes)).toBe(true);
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
      expect(first.state).toBe('outcome_unknown');expect(f.service.activeCount).toBe(0);expect(f.service.currentOperation()).toBeNull();await f.service.destroy();expect(first.result.ownerHeld).toBe(true);expect(readFileSync(join(f.root,'result.bin')).equals(f.bytes)).toBe(true);const inode=lstatSync(join(f.root,'result.bin')).ino;
      expect(f.service.hasRetainedState(f.selected.id)).toBe(true);expect(f.service.hasRetainedState(randomUUID())).toBe(false);
      expect(await f.service.execute(request)).toEqual(first);expect(f.service.inspect(request)).toEqual(first);expect(f.counts().publishes).toBe(1);await expect(f.prepare('another.bin')).rejects.toThrow();
      f.advance();expect(f.service.list({taskId:f.taskId,generation:2}).receipts[0]?.request).toEqual(request);expect(f.service.list({taskId:f.taskId,generation:2}).reviews).toEqual([]);const restarted=createWorkspaceVmExportService({...f.options,workspaceService:f.workspace});const reads=f.counts().reads;
      try{expect(restarted.inspect(request).state).toBe('outcome_unknown');expect(restarted.hasRetainedState(f.selected.id)).toBe(true);const settled=await restarted.reconcile(request);expect(settled.state).toBe('completed');expect(settled.result.reconciled).toBe(true);expect(restarted.inspect(request)).toEqual(settled);expect(restarted.hasRetainedState(f.selected.id)).toBe(false);expect(f.counts().reads).toBe(reads);expect(f.counts().publishes).toBe(1);expect(lstatSync(join(f.root,'result.bin')).ino).toBe(inode);}finally{await restarted.destroy();}
    }finally{await f.close();}
  });
  test('queued review and reconcile wait for the live export; an independent owner cannot infer failure while it holds the lock', async () => {
    const f = await fixture(); const review = await f.prepare(); f.approve();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let block = true;
    const owner = createWorkspaceVmExportService({ ...f.options, async readCandidate(input: Parameters<typeof f.options.readCandidate>[0]) {
      if (block) { block = false; entered(); await gate; }
      return f.options.readCandidate(input);
    } });
    const other = createWorkspaceVmExportService(f.options), request = f.request(review);
    try {
      const exporting = owner.execute(request); await started;
      const preview = owner.prepare({ scope: { taskId: f.taskId, generation: 1 }, workspaceId: f.selected.id,
        destinationPath: 'second.bin', operationId: review.operationId, candidatePath: review.candidatePath,
        candidateSha256: review.candidateSha256, explicitUserAction: true });
      const receipt = owner.reconcile(request);
      expect(owner.currentOperation()).toBe('VM candidate export');
      await expect(other.reconcile(request)).rejects.toThrow();
      expect(owner.inspect(request)?.state).toBe('outcome_unknown');
      release();
      expect((await exporting).state).toBe('completed');
      expect((await preview).destinationPath).toBe('second.bin');
      expect((await receipt).state).toBe('completed');
      expect(f.counts().publishes).toBe(1); expect(owner.activeCount).toBe(0);
    } finally { release(); await owner.destroy(); await other.destroy(); await f.close(); }
  }, 5000);

  test('exclusive reconciliation signs missing intent and pre-publication interruption as terminal without publishing', async () => {
    const f = await fixture(); const review = await f.prepare(); f.approve();
    const absent = f.request(review), key = createHash('sha256').update(absent.idempotencyKey).digest('hex');
    mkdirSync(join(f.base, 'exports', 'actions', key), { mode: 0o700 });
    try {
      expect((await f.service.reconcile(absent)).state).toBe('failed');
      expect(f.service.inspect(absent)?.state).toBe('failed');
      expect((await f.service.execute(absent)).state).toBe('failed');
      let checks = 0;
      const stopped = createWorkspaceVmExportService({ ...f.options, async validateIntent() { if (++checks > 1) throw new Error('approval changed'); } });
      const request = f.request(review);
      try {
        expect((await stopped.execute(request)).state).toBe('failed');
        const action = createHash('sha256').update(request.idempotencyKey).digest('hex');
        unlinkSync(join(f.base, 'exports', 'actions', action, 'terminal.json'));
        expect((await stopped.reconcile(request)).reason).toBe('vm-export-publication-not-started');
        expect(f.counts().publishes).toBe(0); expect(existsSync(join(f.root, 'result.bin'))).toBe(false);
        const directory = join(f.base, 'exports', 'actions', action), terminal = readFileSync(join(directory, 'terminal.json'));
        unlinkSync(join(directory, 'intent.json'));
        expect((await stopped.reconcile(request)).state).toBe('outcome_unknown');
        expect(readFileSync(join(directory, 'terminal.json'))).toEqual(terminal);
        expect(existsSync(join(directory, 'intent.json'))).toBe(false);
      } finally { await stopped.destroy(); }
    } finally { await f.close(); }
  });

  test('capacity compacts settled bytes while exact replay and consumed-review refusal survive a new owner', async () => {
    const f = await fixture(); f.approve(); let firstRequest: any, firstReceipt: any, firstReview: any;
    try {
      for (let index = 0; index < 65; index++) {
        const review = await f.prepare('capacity-' + index + '.bin'), request = f.request(review);
        const receipt = await f.service.execute(request); expect(receipt.state).toBe('completed');
        if (!index) { firstRequest = request; firstReceipt = receipt; firstReview = review; }
      }
      const publishes = f.counts().publishes, reads = f.counts().reads;
      const restored = createWorkspaceVmExportService(f.options);
      try {
        expect(restored.inspect(firstRequest)).toEqual(firstReceipt);
        expect(await restored.execute(firstRequest)).toEqual(firstReceipt);
        expect(await restored.reconcile(firstRequest)).toEqual(firstReceipt);
        await expect(restored.execute({ ...firstRequest, arguments: { ...firstRequest.arguments, reviewDigest: '0'.repeat(64) } })).rejects.toThrow('action-conflict');
        expect((await restored.execute(f.request(firstReview))).state).toBe('failed');
        expect(restored.list({ taskId: f.taskId, generation: 1 }).reviews).toEqual([]);
        expect(f.counts()).toEqual({ publishes, reads });
      } finally { await restored.destroy(); }
    } finally { await f.close(); }
  }, 5000);

  test('a full set of unconsumed previews can execute its oldest exact review before safe eviction', async () => {
    const f = await fixture(); f.approve();
    try {
      const first = await f.prepare('preview-0.bin');
      for (let index = 1; index < 64; index++) await f.prepare('preview-' + index + '.bin');
      expect((await f.service.execute(f.request(first))).state).toBe('completed');
      const next = await f.prepare('preview-next.bin');
      const listed = f.service.list({ taskId: f.taskId, generation: 1 });
      expect(listed.reviews).toHaveLength(64);
      expect(listed.reviews.some((row: any) => row.reviewId === first.reviewId)).toBe(false);
      expect(listed.reviews.some((row: any) => row.reviewId === next.reviewId)).toBe(true);
    } finally { await f.close(); }
  }, 5000);

  test('uncommitted staging and legacy UUID directories never hide committed reviews or authorize export', async () => {
    const f = await fixture();
    try {
      const review = await f.prepare();
      mkdirSync(join(f.base, 'exports', 'reviews', '.pending-' + randomUUID()), { mode: 0o700 });
      // These old UUID-shaped rows lack the signed commit metadata. More than
      // 64 partial rows must not exhaust the capacity of committed previews.
      const incomplete = randomUUID();
      for (const id of [incomplete, ...Array.from({ length: 64 }, () => randomUUID())]) {
        const directory = join(f.base, 'exports', 'reviews', id);
        mkdirSync(directory, { mode: 0o700 });
        writeFileSync(join(directory, 'candidate.bin'), f.bytes, { mode: 0o400 });
      }
      const next = await f.prepare('next.bin');
      const ids = () => f.service.list({ taskId: f.taskId, generation: 1 }).reviews.map((row: any) => row.reviewId).sort();
      expect(ids()).toEqual([review.reviewId, next.reviewId].sort());
      f.approve();
      expect((await f.service.execute(f.request({ reviewId: incomplete, reviewDigest: 'a'.repeat(64) }))).state).toBe('failed');
      expect(ids()).toEqual([review.reviewId, next.reviewId].sort());
      expect(f.counts().publishes).toBe(0);
    } finally { await f.close(); }
  });

});
