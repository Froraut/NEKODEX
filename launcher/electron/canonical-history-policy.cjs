'use strict';
const {createHash}=require('node:crypto');
const POLICY='known-pattern-filter-v1';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function id(value){if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>512||/[\u0000-\u001f]/u.test(value))throw new Error('Invalid canonical message identity');return value;}
function classify(text,knownSecrets=[]){
  if(knownSecrets.some(secret=>typeof secret==='string'&&secret.length>=8&&text.includes(secret)))return 'known-secret-content';
  if(/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-|svcacct-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[0-9A-Z]{16}|ya29\.[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{16,}|nk-read-[a-f0-9]{64})\b/iu.test(text)
    ||/\b(?:authorization\s*:\s*(?:bearer|basic)\s+\S+|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|passwd|private[_ -]?key)\s*[:=]\s*["']?[^\s"']{4,}|(?:password|api key|token|пароль|токен)\s+(?:is|was|это)\s+\S{4,}|(?:cookie|set-cookie)\s*:\s*\S+)/iu.test(text)
    ||/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/iu.test(text))return 'known-secret-content';
  if(/<\/?(?:environment_context|INSTRUCTIONS|system|developer|tool_result|tool_response|function_call_output|available_tools|permissions|collaboration_mode)\b|^\s*#\s*AGENTS\.md instructions\b|"type"\s*:\s*"(?:function_call|function_call_output|tool_result|tool_call)"|"parameters"\s*:\s*\{\s*"type"\s*:\s*"object"/imu.test(text))return 'generated-instructions-or-schema';
  return null;
}
/** Canonical roles establish message structure, not secret-free text. Matches
 * exclude the whole item; absence of a match is explicitly not exhaustive redaction. */
function sanitizeCanonicalPage(page,{threadId,knownSecrets=[]}={}){
  if(!uuid.test(threadId)||page?.threadId!==threadId||!Number.isSafeInteger(page.observedAt)||page.observedAt<0||!Array.isArray(page.messages)||page.messages.length>100||typeof page.complete!=='boolean'||!Number.isSafeInteger(page.excludedItems)||page.excludedItems<0||(page.nextCursor!==null&&(typeof page.nextCursor!=='string'||Buffer.byteLength(page.nextCursor)>4096)))throw new Error('Unsupported canonical native conversation page');
  if(!Array.isArray(knownSecrets)||knownSecrets.length>128)throw new Error('Invalid private canonical filter configuration');
  const identities=new Set(),messages=[];let policyExcluded=0,budgetExcluded=0;
  for(const item of page.messages){
    id(item?.messageId);if(item.turnId!==null)id(item.turnId);
    if(!['user','assistant'].includes(item.role)||typeof item.text!=='string'||item.compactionId!==null||!['complete','partial'].includes(item.coverage)||(item.timestampMs!==null&&(!Number.isSafeInteger(item.timestampMs)||item.timestampMs<0)))throw new Error('Unsupported canonical user/assistant item');
    if(identities.has(item.messageId))throw new Error('Duplicate canonical message identity');identities.add(item.messageId);
    const originalBytes=Buffer.byteLength(item.text),reason=originalBytes>128*1024?'source-item-size-limit':classify(item.text,knownSecrets);
    let projected={messageId:item.messageId,turnId:item.turnId,role:item.role,text:reason?'':item.text,timestampMs:item.timestampMs,compactionId:null,
      exclusionReason:reason,originalBytes,sourceCoverage:item.coverage};
    if(reason)policyExcluded++;
    if(Buffer.byteLength(JSON.stringify({...page,messages:[...messages,projected]}))>500000){projected={...projected,text:'',exclusionReason:'source-page-size-limit'};budgetExcluded++;}
    messages.push(projected);
  }
  const result={threadId,observedAt:page.observedAt,messages,complete:page.complete&&policyExcluded===0&&budgetExcluded===0,nextCursor:page.nextCursor,excludedItems:page.excludedItems,policyExcluded,budgetExcluded,policyVersion:POLICY};
  if(Buffer.byteLength(JSON.stringify(result))>550000)throw new Error('Canonical metadata page exceeds the private capture bound');
  return result;
}
function canonicalFingerprint(item){return createHash('sha256').update(JSON.stringify({messageId:item.messageId,turnId:item.turnId,role:item.role,text:item.text,exclusionReason:item.exclusionReason,originalBytes:item.originalBytes,sourceCoverage:item.sourceCoverage})).digest('hex');}
module.exports={CANONICAL_HISTORY_POLICY:POLICY,sanitizeCanonicalPage,canonicalFingerprint,classifyCanonicalText:classify};
