import {afterEach,expect,test} from 'bun:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,renameSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAgentWorkspaceEvidenceAuthority,verifyWorkspaceEvidenceProof,type WorkspaceEvidenceTask} from '../launcher/electron/agent-workspace-evidence.cjs';
import {createAgentWorkspaceGrantAuthority,verifyAgentWorkspaceGrant} from '../launcher/electron/agent-workspace-grant.cjs';
import {createAgentWorkspaceEvidence} from '../src/agent-workspace/evidence';
const roots:string[]=[],owners:ReturnType<typeof createAgentWorkspaceEvidence>[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const base=realpathSync(mkdtempSync(join(tmpdir(),'nekodex-business-observer-synthetic-')));roots.push(base);
 const root=join(base,'workspace');mkdirSync(root);writeFileSync(join(root,'result.txt'),'synthetic business artifact');
 const keyPath=join(base,'private','grant-key'),workspaceId=randomUUID();
 const task:WorkspaceEvidenceTask={id:randomUUID(),familyId:randomUUID(),generation:1,revision:1,requirements:[{id:'r1'}]};
 const authority=createAgentWorkspaceEvidenceAuthority({keyPath,resolveWorkspace:id=>{if(id!==workspaceId)throw new Error('not picker selected');return {id,path:root};}});
 const storagePath=join(base,'private','evidence.sqlite'),owner=createAgentWorkspaceEvidence({storagePath,keyPath});owners.push(owner);
 const observe=(property:'file-exists'|'file-absent'|'file-sha256'='file-exists',relativePath='result.txt',extra:Record<string,unknown>={})=>authority.observe({task,observationId:randomUUID(),workspaceId,relativePath,requirementId:'r1',property,...extra});
 return {base,root,keyPath,workspaceId,task,authority,owner,storagePath,observe};
}
test('real file observation binds signed actual property, retains no contents, and file drift blocks existing facts until explicit fresh observation',()=>{
 const f=fixture(),proof=f.observe(),record=f.owner.observe(f.task,proof);
 expect(record.evidence).toMatchObject({outcome:'passed',observer:'workspace-file-observer-v1',requirementId:'r1'});
 expect(record.reference).toMatchObject({exists:true,actualSha256:createHash('sha256').update('synthetic business artifact').digest('hex')});
 expect(JSON.stringify(proof)).not.toContain('synthetic business artifact');expect(readFileSync(f.storagePath).includes(Buffer.from('synthetic business artifact'))).toBe(false);
 expect(f.owner.resolve(f.task,record.reference)).toEqual(record.evidence);f.owner.assertCurrent(f.task,record.evidence);
 expect(f.owner.observe(f.task,proof)).toEqual(record);expect(f.owner.listTask(f.task.id)).toHaveLength(1);
 writeFileSync(join(f.root,'result.txt'),'changed actual artifact');
 expect(()=>f.owner.assertCurrent(f.task,record.evidence)).toThrow('changed after observation');
 expect(()=>f.owner.resolve(f.task,record.reference)).toThrow('changed after observation');
 expect(()=>f.authority.observe({task:f.task,observationId:proof.id,workspaceId:f.workspaceId,relativePath:'result.txt',requirementId:'r1',property:'file-exists'})).toThrow('changed after observation');
 const fresh=f.owner.observe(f.task,f.observe());expect(fresh.evidence.subject).toBe(record.evidence.subject);expect(fresh.evidence.property).toBe(record.evidence.property);expect(fresh.evidence.subjectRevision).not.toBe(record.evidence.subjectRevision);
 f.owner.assertCurrent(f.task,fresh.evidence);expect(f.owner.listTask(f.task.id)).toHaveLength(2);
});
test('only explicitly selected absence or exact expected SHA produces that property outcome; proof replay and cross-purpose grants are refused',()=>{
 const f=fixture(),absent=f.owner.observe(f.task,f.observe('file-absent','missing.txt'));
 expect(absent.evidence.outcome).toBe('passed');expect(absent.reference.exists).toBe(false);
 expect(f.owner.observe(f.task,f.observe('file-exists','missing.txt')).evidence.outcome).toBe('failed');
 const wanted=createHash('sha256').update('synthetic business artifact').digest('hex');
 expect(f.owner.observe(f.task,f.observe('file-sha256','result.txt',{expectedSha256:wanted})).evidence.outcome).toBe('passed');
 expect(f.owner.observe(f.task,f.observe('file-sha256','result.txt',{expectedSha256:'0'.repeat(64)})).evidence.outcome).toBe('failed');
 const proof=f.observe();
 for(const task of [{...f.task,id:randomUUID()},{...f.task,familyId:randomUUID()},{...f.task,generation:2},{...f.task,revision:2}])expect(()=>f.owner.observe(task,proof)).toThrow('scope');
 expect(()=>f.owner.observe(f.task,{...proof,capture:{...proof.capture,sha256:'0'.repeat(64)}})).toThrow('scope');
 const grants=createAgentWorkspaceGrantAuthority({keyPath:f.keyPath});const grant=grants.prepare({id:f.workspaceId,path:f.root},['result.txt'],{taskId:f.task.id,familyId:f.task.familyId,generation:1});
 expect(()=>f.owner.observe(f.task,grant)).toThrow('Invalid signed');
 expect(()=>verifyAgentWorkspaceGrant({keyPath:f.keyPath,grant:proof,taskId:f.task.id,familyId:f.task.familyId,generation:1})).toThrow();
 writeFileSync(join(f.root,'missing.txt'),'appeared');expect(()=>f.owner.assertCurrent(f.task,absent.evidence)).toThrow('changed after observation');
});
test('path escapes, symlinks and changed root ancestry fail closed; failed selected captures retain durable attempts',()=>{
 const f=fixture();
 for(const relativePath of ['../outside.txt','/absolute','nested/../result.txt','.git/config'])expect(()=>f.observe('file-exists',relativePath)).toThrow();
 writeFileSync(join(f.base,'outside.txt'),'outside private text');symlinkSync(join(f.base,'outside.txt'),join(f.root,'link.txt'));
 const failedId=randomUUID();
 expect(()=>f.authority.observe({task:f.task,observationId:failedId,workspaceId:f.workspaceId,relativePath:'link.txt',requirementId:'r1',property:'file-exists'})).toThrow();
 expect(()=>f.authority.observe({task:f.task,observationId:failedId,workspaceId:f.workspaceId,relativePath:'link.txt',requirementId:'r1',property:'file-exists'})).toThrow('failed capture');
 const proof=f.observe();renameSync(f.root,join(f.base,'old-workspace'));mkdirSync(f.root);writeFileSync(join(f.root,'result.txt'),'synthetic business artifact');
 expect(()=>verifyWorkspaceEvidenceProof({keyPath:f.keyPath,proof,task:f.task})).toThrow();
 expect(()=>f.owner.observe(f.task,proof)).toThrow();expect(f.owner.listTask(f.task.id)).toMatchObject([{state:'failed',failure:'workspace_observation_changed'}]);
});

test('fresh exact-hash facts explicitly supersede only the same selected property while immutable failed history remains',()=>{
 const f=fixture(),wanted=createHash('sha256').update('synthetic business artifact').digest('hex');
 const passed=f.owner.observe(f.task,f.observe('file-sha256','result.txt',{expectedSha256:wanted}));
 writeFileSync(join(f.root,'result.txt'),'different artifact');
 expect(()=>f.owner.assertCurrent(f.task,passed.evidence)).toThrow('changed after observation');
 const oldTask={...f.task,evidence:[passed.evidence]};
 const failed=f.owner.observe(oldTask,f.observe('file-sha256','result.txt',{expectedSha256:wanted}));
 expect(failed.evidence.outcome).toBe('failed');expect(failed.evidence.supersedes).toEqual([passed.evidence.id]);
 const unrelated=f.owner.observe(f.task,f.observe('file-absent'));
 writeFileSync(join(f.root,'result.txt'),'synthetic business artifact');
 const task={...f.task,evidence:[passed.evidence,failed.evidence,unrelated.evidence]};
 const proof=f.observe('file-sha256','result.txt',{expectedSha256:wanted});
 const fresh=f.owner.observe(task,proof);expect(fresh.evidence.outcome).toBe('passed');expect(fresh.evidence.supersedes).toEqual([failed.evidence.id]);
 expect(fresh.evidence.supersedes).not.toContain(unrelated.evidence.id);f.owner.assertCurrent(task,fresh.evidence);
 expect(f.owner.observe({...task,evidence:[...task.evidence,fresh.evidence]},proof)).toEqual(fresh);
 expect(f.owner.listTask(f.task.id)).toHaveLength(4);
});
