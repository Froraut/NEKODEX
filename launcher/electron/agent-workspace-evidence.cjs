'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createHmac,createHash,timingSafeEqual}=require('node:crypto');
const {createAgentWorkspaceGrantAuthority}=require('./agent-workspace-grant.cjs');
const {writePrivateFileAtomic}=require('./atomic-file.cjs');
const {relative,chain,assertChain,captureFile}=require('./workspace-file-capture.cjs');
const NS='nekodex:workspace-file-observation:v1';
const MAX_ATTEMPTS=256,MAX_REGISTRY_BYTES=4*1024*1024;
function fail(code,message){throw Object.assign(new Error(message),{code});}
function id(value){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>128||/[\u0000-\u001f]/u.test(value))fail('INVALID_EVIDENCE','Invalid workspace evidence identity.');return value;}
function scope(task,requirementId){
  id(task?.id);id(task?.familyId);id(requirementId);
  if(!Number.isSafeInteger(task.generation)||task.generation<1||!Number.isSafeInteger(task.revision)||task.revision<1||!Array.isArray(task.requirements)||!task.requirements.some(row=>row.id===requirementId))fail('EVIDENCE_SCOPE','Select a current requirement from the owned task.');
  return {taskId:task.id,familyId:task.familyId,generation:task.generation,revision:task.revision,requirementId};
}
function privateKey(keyPath,create=false){
  if(typeof keyPath!=='string'||!path.isAbsolute(keyPath))fail('EVIDENCE_KEY','Use the existing private workspace grant key.');
  if(create)createAgentWorkspaceGrantAuthority({keyPath});
  chain(path.dirname(keyPath));
  for(const [file,directory] of [[path.dirname(keyPath),true],[keyPath,false]]){
    const stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())||(process.getuid&&stat.uid!==process.getuid())||(process.platform!=='win32'&&(stat.mode&0o077)!==0)||!directory&&stat.size!==32)fail('EVIDENCE_KEY','Workspace observation key must remain private and owned.');
  }
  return fs.readFileSync(keyPath);
}
const mac=(key,value,kind='proof')=>createHmac('sha256',key).update(`${NS}:${kind}\0`).update(JSON.stringify(value)).digest('hex');
const unsigned=value=>{const {signature,...rest}=value;return rest;};
const matches=(value,expected)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value,'hex'),Buffer.from(expected,'hex'));
function registry(keyPath,key){
  const file=`${keyPath}.evidence.json`,stat=fs.lstatSync(file,{throwIfNoEntry:false});
  if(!stat)return {version:1,attempts:[]};
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_REGISTRY_BYTES||(process.getuid&&stat.uid!==process.getuid())||(process.platform!=='win32'&&(stat.mode&0o077)!==0))fail('EVIDENCE_STORAGE','Workspace evidence registry must be private and bounded.');
  const saved=JSON.parse(fs.readFileSync(file,'utf8')),payload=unsigned(saved);
  if(payload.version!==1||!Array.isArray(payload.attempts)||payload.attempts.length>MAX_ATTEMPTS||!matches(saved.signature,mac(key,payload,'journal')))fail('EVIDENCE_STORAGE','Workspace evidence registry integrity failed.');
  return payload;
}
function save(keyPath,key,value){const text=JSON.stringify({...value,signature:mac(key,value,'journal')});if(Buffer.byteLength(text)>MAX_REGISTRY_BYTES)fail('EVIDENCE_QUOTA','Workspace evidence history is full; existing records are preserved.');writePrivateFileAtomic(`${keyPath}.evidence.json`,text,{durable:true,protectDirectory:false});}
function captured(root,relativePath){
  const file=captureFile(root,relativePath);
  return {exists:file.bytes!==null,revision:file.revision,sha256:file.bytes===null?null:file.contentHash,size:file.bytes===null?0:Buffer.byteLength(file.bytes,'base64')};
}
function proofShape(proof){
  const fields='ancestry,capture,createdAt,expectedSha256,familyId,generation,id,namespace,property,relativePath,requirementId,revision,rootPath,signature,taskId,version,workspaceId';
  if(!proof||typeof proof!=='object'||Array.isArray(proof)||Object.keys(proof).sort().join(',')!==fields||proof.version!==1||proof.namespace!==NS||typeof proof.rootPath!=='string'||!path.isAbsolute(proof.rootPath)||typeof proof.createdAt!=='string'||!Number.isFinite(Date.parse(proof.createdAt))||Buffer.byteLength(JSON.stringify(proof))>32768)fail('INVALID_EVIDENCE','Invalid signed workspace observation.');
  for(const field of ['id','taskId','familyId','workspaceId','requirementId'])id(proof[field]);if(!/^[a-f0-9-]{36}$/.test(proof.id))fail('INVALID_EVIDENCE','Use a stable UUID observation action.');relative(proof.relativePath);
  if(!['file-exists','file-absent','file-sha256'].includes(proof.property)||!Number.isSafeInteger(proof.generation)||proof.generation<1||!Number.isSafeInteger(proof.revision)||proof.revision<1||(proof.property==='file-sha256'?!/^[a-f0-9]{64}$/.test(proof.expectedSha256):proof.expectedSha256!==null))fail('INVALID_EVIDENCE','Select an exact supported file property.');
  const c=proof.capture;
  if(!c||Object.keys(c).sort().join(',')!=='exists,revision,sha256,size'||typeof c.exists!=='boolean'||!Number.isSafeInteger(c.size)||c.size<0||c.size>256*1024||(c.exists?(!/^[a-f0-9]{64}$/.test(c.revision)||!/^[a-f0-9]{64}$/.test(c.sha256)):(c.revision!==null||c.sha256!==null||c.size!==0)))fail('INVALID_EVIDENCE','Invalid file observation identity.');
  if(!Array.isArray(proof.ancestry)||!proof.ancestry.length||proof.ancestry.length>256||proof.ancestry[0]?.[0]!==proof.rootPath||proof.ancestry.some((node,i)=>!Array.isArray(node)||node.length!==2||typeof node[0]!=='string'||typeof node[1]!=='string'||!/^\d+:\d+$/.test(node[1])||(i>0&&node[0]!==path.dirname(proof.ancestry[i-1][0])))||path.dirname(proof.ancestry.at(-1)[0])!==proof.ancestry.at(-1)[0])fail('INVALID_EVIDENCE','Invalid workspace root ancestry.');
}
function authenticateWorkspaceEvidenceProof({keyPath,proof,task}){
  proofShape(proof);const key=privateKey(keyPath),expectedScope=scope(task,proof.requirementId);
  if(!matches(proof.signature,mac(key,unsigned(proof)))||Object.entries(expectedScope).some(([name,value])=>proof[name]!==value))fail('EVIDENCE_SCOPE','Workspace observation does not match this task and current requirement scope.');
  const saved=registry(keyPath,key).attempts.find(row=>row.id===proof.id);
  if(!saved||saved.state!=='observed'||saved.proof?.signature!==proof.signature)fail('EVIDENCE_UNAVAILABLE','Workspace observation was not admitted by its trusted owner.');
  return structuredClone(proof);
}
function verifyWorkspaceEvidenceProof({keyPath,proof,task}){
  proof=authenticateWorkspaceEvidenceProof({keyPath,proof,task});
  assertChain(proof.ancestry);
  if(fs.realpathSync(proof.rootPath)!==proof.rootPath||JSON.stringify(chain(proof.rootPath))!==JSON.stringify(proof.ancestry))fail('EVIDENCE_ROOT_CHANGED','The observed workspace ancestry changed.');
  const current=captured(proof.rootPath,proof.relativePath);assertChain(proof.ancestry);
  if(JSON.stringify(current)!==JSON.stringify(proof.capture))fail('EVIDENCE_STALE','The selected file changed after observation; explicitly observe its current revision.');
  return structuredClone(proof);
}
/** Trusted main-only owner. Incoming paths are workspace-relative; roots come only
 * from the freshly validated picker registry dependency. No raw file content leaves capture. */
function createAgentWorkspaceEvidenceAuthority({keyPath,resolveWorkspace}){
  const key=privateKey(keyPath,true);registry(keyPath,key);
  return Object.freeze({observe(input){
    if(!timingSafeEqual(key,privateKey(keyPath)))fail('EVIDENCE_KEY','Workspace observation authority key changed; preserve its existing receipts.');
    const binding=scope(input.task,input.requirementId);id(input.observationId);if(!/^[a-f0-9-]{36}$/.test(input.observationId))fail('INVALID_EVIDENCE','Use a stable UUID observation action.');id(input.workspaceId);relative(input.relativePath);
    if(!['file-exists','file-absent','file-sha256'].includes(input.property)||(input.property==='file-sha256'?!/^[a-f0-9]{64}$/.test(input.expectedSha256):input.expectedSha256!==undefined))fail('INVALID_EVIDENCE','Select an explicit existence, absence or expected SHA-256 property.');
    const identity={id:input.observationId,...binding,workspaceId:input.workspaceId,relativePath:input.relativePath,property:input.property,expectedSha256:input.expectedSha256??null};
    const journal=registry(keyPath,key),old=journal.attempts.find(row=>row.id===input.observationId);
    if(old){if(JSON.stringify(old.identity)!==JSON.stringify(identity))fail('EVIDENCE_CONFLICT','Observation identity already belongs to different selected evidence.');if(old.state!=='observed')fail('EVIDENCE_RECOVERY','An unfinished or failed capture is retained; use a new explicit observation action.');const selected=resolveWorkspace(input.workspaceId);if(selected?.id!==input.workspaceId||selected.path!==old.proof?.rootPath)fail('EVIDENCE_ROOT','The selected picker workspace is no longer current.');return verifyWorkspaceEvidenceProof({keyPath,proof:old.proof,task:input.task});}
    if(journal.attempts.length>=MAX_ATTEMPTS)fail('EVIDENCE_QUOTA','Workspace evidence history is full; existing records are preserved.');
    const attempt={id:input.observationId,identity,state:'preparing'};journal.attempts.push(attempt);save(keyPath,key,journal);
    try{
      const root=resolveWorkspace(input.workspaceId);if(!root||root.id!==input.workspaceId||typeof root.path!=='string'||!path.isAbsolute(root.path)||fs.realpathSync(root.path)!==root.path)fail('EVIDENCE_ROOT','Select a current picker-owned workspace.');
      const ancestry=chain(root.path),capture=captured(root.path,input.relativePath),again=captured(root.path,input.relativePath);assertChain(ancestry);
      const revalidated=resolveWorkspace(input.workspaceId);if(revalidated?.id!==root.id||revalidated.path!==root.path||JSON.stringify(capture)!==JSON.stringify(again))fail('EVIDENCE_STALE','Selected file changed during observation.');
      const payload={version:1,namespace:NS,id:identity.id,...binding,workspaceId:root.id,rootPath:root.path,ancestry,relativePath:identity.relativePath,property:identity.property,expectedSha256:identity.expectedSha256,capture,createdAt:new Date().toISOString()};
      const proof={...payload,signature:mac(key,payload)};proofShape(proof);attempt.state='observed';attempt.proof=proof;save(keyPath,key,journal);return structuredClone(proof);
    }catch(error){attempt.state='failed';delete attempt.proof;attempt.failure='workspace_capture_failed';try{save(keyPath,key,journal);}catch{}throw error;}
  }});
}
module.exports={createAgentWorkspaceEvidenceAuthority,authenticateWorkspaceEvidenceProof,verifyWorkspaceEvidenceProof};
