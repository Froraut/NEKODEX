'use strict';
const {sanitizeCanonicalPage}=require('./canonical-history-policy.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function thread(value){if(typeof value!=='string'||!UUID.test(value))throw new Error('Select an exact native Codex thread UUID');return value;}
/** Trusted main-only composition. All persisted leases/data belong to the daemon.
 * One explicit refresh reads one native page; no timer, watcher, turn/resume/start or new transport. */
function createCanonicalNativeHistoryRecorder({sourceId,getClient,requestHistory,knownSecrets=()=>[]}){
  if(typeof sourceId!=='string'||!/^[a-f0-9]{64}$/.test(sourceId)||typeof getClient!=='function'||typeof requestHistory!=='function')throw new Error('Canonical history requires trusted main dependencies');
  const pending=new Set();
  return Object.freeze({
    async list({cursor=null,limit=30}={}) {
      if(!Number.isInteger(limit)||limit<1||limit>50||cursor!==null&&(typeof cursor!=='string'||Buffer.byteLength(cursor)>4096))throw new Error('Invalid native thread metadata list bounds');
      await requestHistory({action:'status'}); // Existing owned runtime readiness, no native auto-start on status.
      const result=await getClient().listThreads({cursor,limit});
      return {items:result.data.map(row=>({threadId:thread(row.id),name:typeof row.name==='string'?row.name.slice(0,256):null,nameTruncated:typeof row.name==='string'&&row.name.length>256})),nextCursor:result.nextCursor,statusScope:result.statusScope};
    },
    status(threadId){return requestHistory({action:'canonical-status',sourceId,threadId:thread(threadId)});},
    setConsent(threadId,input){
      if(!input||typeof input.enabled!=='boolean'||input.enabled&&(input.consent!==true||input.acknowledgeUnknownSecrets!==true))throw new Error('Selected-thread capture requires content consent and unknown-secret-risk acknowledgement');
      return requestHistory({action:'canonical-consent',sourceId,threadId:thread(threadId),enabled:input.enabled,consent:input.consent===true,acknowledgeUnknownSecrets:input.acknowledgeUnknownSecrets===true});
    },
    async refresh(threadId,{cursor=null,limit=50}={}){
      thread(threadId);if(!Number.isInteger(limit)||limit<1||limit>100||cursor!==null&&(typeof cursor!=='string'||Buffer.byteLength(cursor)>4096))throw new Error('Invalid canonical refresh bounds');
      if(pending.has(threadId))throw new Error('A selected-thread canonical refresh is already pending');
      pending.add(threadId);
      try{
        const admission=await requestHistory({action:'canonical-lease',sourceId,threadId});
        if(!admission?.lease)return {outcome:admission?.status?.quotaReached?'quota-reached':'disabled',status:admission?.status??null};
        const client=getClient();if(typeof client?.readThreadConversation!=='function')throw new Error('The installed native client does not expose canonical conversation reads');
        const page=await client.readThreadConversation(threadId,{cursor,limit});
        const sanitized=sanitizeCanonicalPage(page,{threadId,knownSecrets:knownSecrets()});
        const result=await requestHistory({action:'canonical-record',lease:admission.lease,page:sanitized});
        return {...result,nextCursor:page.nextCursor};
      }catch(reason){if(reason?.rpcCode===-32601)throw new Error('This installed native Codex server does not support canonical conversation reads; no fallback history was imported');throw reason;}finally{pending.delete(threadId);}
    },
  });
}
module.exports={createCanonicalNativeHistoryRecorder};
