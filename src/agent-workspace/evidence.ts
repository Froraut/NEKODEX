import {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {chmodSync,lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {chain,assertChain} from '../../launcher/electron/workspace-file-capture.cjs';
import {authenticateWorkspaceEvidenceProof,verifyWorkspaceEvidenceProof,type WorkspaceEvidenceProof,type WorkspaceEvidenceTask} from '../../launcher/electron/agent-workspace-evidence.cjs';
import type {OutcomeEvidence,AgentTask} from '../agent-mode/types';
import type {AgentEvidenceReference} from '../agent-mode/http';
export interface WorkspaceEvidenceOwnerTask extends WorkspaceEvidenceTask {evidence?:OutcomeEvidence[]}
export interface WorkspaceFileEvidenceReference extends AgentEvidenceReference {observedAt:string;actualSha256:string|null;exists:boolean}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const OBSERVER='workspace-file-observer-v1';
const owners=new Set<string>();
function fail(code:string,message:string):never{throw Object.assign(new Error(message),{code});}
function sourceId(proof:WorkspaceEvidenceProof){return `workspace-file:${proof.id}`;}
function projection(proof:WorkspaceEvidenceProof,supersedes:string[]=[]):{reference:WorkspaceFileEvidenceReference;evidence:OutcomeEvidence}{
  const subject=`workspace:${proof.workspaceId}/${proof.relativePath}`;
  const subjectRevision=proof.capture.revision??`absent:${hash(JSON.stringify([proof.rootPath,proof.ancestry,proof.relativePath]))}`;
  const property=proof.property==='file-sha256'?`file-sha256:${proof.expectedSha256}`:proof.property;
  const passed=proof.property==='file-exists'?proof.capture.exists:proof.property==='file-absent'?!proof.capture.exists:proof.capture.exists&&proof.capture.sha256===proof.expectedSha256;
  const reference={sourceEventId:sourceId(proof),requirementId:proof.requirementId,subject,subjectRevision,property,observedAt:proof.createdAt,actualSha256:proof.capture.sha256,exists:proof.capture.exists};
  return {reference,evidence:{id:`workspace-evidence:${proof.id}`,requirementId:reference.requirementId,taskRevision:proof.revision,sourceEventId:reference.sourceEventId,subject,subjectRevision,property,outcome:passed?'passed':'failed',observer:OBSERVER,...(supersedes.length?{supersedes}:{})}};
}
interface Row{id:string;digest:string;state:'preparing'|'observed'|'failed';proof:string;reference:string|null;evidence:string|null;storedBytes:number}
/** One Bun journal owner for trusted file-property facts. No file contents are
 * retained; reads never select a root or start work. Explicit file mapping proves
 * only its selected property, never every business meaning of a requirement. */
export function createAgentWorkspaceEvidence({storagePath,keyPath}:{storagePath:string;keyPath:string}){
  if(!isAbsolute(storagePath)||!isAbsolute(keyPath))fail('INVALID_STORAGE','Use trusted absolute evidence storage paths.');
  if(owners.has(storagePath))fail('EVIDENCE_OWNER','Workspace evidence journal already has a writer.');
  const directory=dirname(storagePath);let existing=directory;while(!lstatSync(existing,{throwIfNoEntry:false}))existing=dirname(existing);chain(existing);
  mkdirSync(directory,{recursive:true,mode:0o700});const directoryChain=chain(directory),dir=lstatSync(directory),file=lstatSync(storagePath,{throwIfNoEntry:false});
  if(realpathSync(directory)!==directory||(process.getuid&&dir.uid!==process.getuid())||(process.platform!=='win32'&&(dir.mode&0o077)!==0)||file&&(!file.isFile()||file.isSymbolicLink()||(process.getuid&&file.uid!==process.getuid())||(process.platform!=='win32'&&(file.mode&0o077)!==0)))fail('UNSAFE_STORAGE','Workspace evidence storage must remain private and owned.');
  const db=new Database(storagePath,{create:true,strict:true});
  try{if(process.platform!=='win32')chmodSync(storagePath,0o600);db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=100; PRAGMA locking_mode=EXCLUSIVE; PRAGMA max_page_count=4096;
    CREATE TABLE IF NOT EXISTS workspace_file_evidence(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,proof TEXT NOT NULL,reference TEXT,evidence TEXT,storedBytes INTEGER NOT NULL,failure TEXT);
    CREATE INDEX IF NOT EXISTS workspace_file_evidence_task ON workspace_file_evidence(taskId);`);owners.add(storagePath);}catch(error){db.close();throw error;}
  const node=lstatSync(storagePath);let closed=false;
  function assertStorage(){if(closed)fail('EVIDENCE_CLOSED','Workspace evidence owner is closed.');assertChain(directoryChain);const current=lstatSync(storagePath),currentDir=lstatSync(directory);if((process.getuid&&(current.uid!==process.getuid()||currentDir.uid!==process.getuid()))||(process.platform!=='win32'&&(currentDir.mode&0o077)!==0)||!current.isFile()||current.isSymbolicLink()||current.dev!==node.dev||current.ino!==node.ino||(process.platform!=='win32'&&(current.mode&0o077)!==0))fail('UNSAFE_STORAGE','Workspace evidence storage changed.');}
  function row(sourceEventId:string):Row{
    assertStorage();if(typeof sourceEventId!=='string'||!sourceEventId.startsWith('workspace-file:'))fail('EVIDENCE_UNKNOWN','Select an observed workspace file reference.');
    const found=db.query('SELECT * FROM workspace_file_evidence WHERE id=?').get(sourceEventId.slice('workspace-file:'.length)) as Row|null;
    if(!found||found.state!=='observed'||!found.reference||!found.evidence)fail('EVIDENCE_UNKNOWN','Selected workspace evidence is unavailable.');return found;
  }
  function current(task:WorkspaceEvidenceTask,found:Row){
    const proof=verifyWorkspaceEvidenceProof({keyPath,proof:JSON.parse(found.proof),task});
    const stored=JSON.parse(found.evidence!) as OutcomeEvidence;
    const expected=projection(proof,(stored as OutcomeEvidence & {supersedes?:string[]}).supersedes??[]);
    if(JSON.stringify(expected.reference)!==found.reference||JSON.stringify(expected.evidence)!==found.evidence)fail('EVIDENCE_INTEGRITY','Workspace evidence projection changed.');
    return expected;
  }
  function observe(task:WorkspaceEvidenceOwnerTask,untrustedProof:unknown){
    assertStorage();
    // HMAC/scope/current-root checks happen before accepting a new trusted fact.
    // A failed recapture of an already admitted fact remains in its journal.
    const serialized=JSON.stringify(untrustedProof);if(typeof serialized!=='string'||Buffer.byteLength(serialized)>32768)fail('INVALID_EVIDENCE','Workspace observation exceeds its bounded schema.');
    const candidate=untrustedProof as WorkspaceEvidenceProof;
    // Verify signed identity before writing any caller-selected value to the journal.
    // The main registry retains main-side failed/preparing captures as well.
    const proof=authenticateWorkspaceEvidenceProof({keyPath,proof:candidate,task});
    const proofJson=JSON.stringify(proof),digest=hash(proofJson),old=db.query('SELECT * FROM workspace_file_evidence WHERE id=?').get(proof.id) as Row|null;
    if(old){if(old.digest!==digest)fail('EVIDENCE_CONFLICT','Observation identity belongs to different evidence.');if(old.state!=='observed')fail('EVIDENCE_RECOVERY','A failed evidence capture is retained; use a new explicit observation.');return current(task,old);}
    const facts=task.evidence??[];
    const replaced=new Set(facts.flatMap(fact=>fact.supersedes??[]));
    const preliminary=projection(proof).evidence;
    const supersedes=facts.filter(fact=>!replaced.has(fact.id)&&fact.observer===OBSERVER&&fact.taskRevision===proof.revision&&fact.requirementId===preliminary.requirementId&&fact.subject===preliminary.subject&&fact.property===preliminary.property).map(fact=>fact.id);
    const result=projection(proof,supersedes),reference=JSON.stringify(result.reference),evidence=JSON.stringify(result.evidence),storedBytes=Buffer.byteLength(proofJson+reference+evidence)+512;
    db.transaction(()=>{const counts=db.query('SELECT COUNT(*) AS count,COALESCE(SUM(storedBytes),0) AS bytes FROM workspace_file_evidence').get() as {count:number;bytes:number};if(counts.count>=1024||counts.bytes+storedBytes>8*1024*1024)fail('EVIDENCE_QUOTA','Workspace evidence journal is full; existing facts were preserved.');db.query("INSERT INTO workspace_file_evidence(id,taskId,digest,state,proof,storedBytes) VALUES(?,?,?,'preparing',?,?)").run(proof.id,proof.taskId,digest,proofJson,storedBytes);}).immediate();
    try{
      verifyWorkspaceEvidenceProof({keyPath,proof,task});assertStorage();
      db.query("UPDATE workspace_file_evidence SET state='observed',reference=?,evidence=? WHERE id=? AND state='preparing'").run(reference,evidence,proof.id);
      return result;
    }catch(error){try{db.query("UPDATE workspace_file_evidence SET state='failed',failure='workspace_observation_changed' WHERE id=? AND state='preparing'").run(proof.id);}catch{}throw error;}
  }
  function resolve(task:WorkspaceEvidenceTask,reference:AgentEvidenceReference):OutcomeEvidence{
    const found=row(reference.sourceEventId),result=current(task,found);
    for(const field of ['sourceEventId','requirementId','subject','subjectRevision','property'] as const)if(reference[field]!==result.reference[field])fail('EVIDENCE_REFERENCE','Selected workspace reference does not match its observed file property.');
    return result.evidence;
  }
  function assertCurrent(task:AgentTask|WorkspaceEvidenceTask,evidence:OutcomeEvidence):void{
    if(evidence.observer!==OBSERVER)fail('EVIDENCE_OBSERVER','This is not a workspace file observation.');
    const result=current(task,row(evidence.sourceEventId));
    if(JSON.stringify(result.evidence)!==JSON.stringify(evidence))fail('EVIDENCE_REFERENCE','Workspace fact does not match its trusted observed outcome.');
  }
  return Object.freeze({observe,resolve,assertCurrent,listTask(taskId:string){assertStorage();return (db.query('SELECT id,state,reference,failure FROM workspace_file_evidence WHERE taskId=? ORDER BY rowid LIMIT 1024').all(taskId) as Array<{id:string;state:string;reference:string|null;failure:string|null}>).map(entry=>({id:entry.id,state:entry.state,reference:entry.reference?JSON.parse(entry.reference) as WorkspaceFileEvidenceReference:null,failure:entry.failure}));},close(){if(!closed){db.close();closed=true;owners.delete(storagePath);}}});
}
