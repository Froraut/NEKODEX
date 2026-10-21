'use strict';
const {sanitizeCanonicalPage}=require('./canonical-history-policy.cjs');
const MAX_BACKFILL_PAGES=100;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function thread(value){if(typeof value!=='string'||!UUID.test(value))throw new Error('Select an exact native Codex thread UUID');return value;}
/** Trusted main-only composition. All persisted leases/data belong to the daemon.
 * One explicit refresh reads one native page; an explicit full-history action reads bounded pages
 * in sequence. No timer, watcher, subscription, turn/resume/start or new transport. */
function createCanonicalNativeHistoryRecorder({sourceId,getClient,requestHistory,knownSecrets=()=>[]}){
  if(typeof sourceId!=='string'||!/^[a-f0-9]{64}$/.test(sourceId)||typeof getClient!=='function'||typeof requestHistory!=='function')throw new Error('Canonical history requires trusted main dependencies');
  const pending=new Set();
  const recorder=Object.freeze({
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
      try{return await page(threadId,cursor,limit);}finally{pending.delete(threadId);}
    },
    /** One explicit action that walks the selected thread's canonical pages newest→oldest.
     * Each page takes and revalidates its own lease, so revoke/disable/quota stops it between
     * pages. It ends at the native start (`reachedStart`), the page bound, or a repeated cursor. */
    async backfill(threadId,{maxPages=40,limit=100}={}){
      thread(threadId);if(!Number.isInteger(maxPages)||maxPages<1||maxPages>MAX_BACKFILL_PAGES||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid canonical history bounds');
      if(pending.has(threadId))throw new Error('A selected-thread canonical refresh is already pending');
      pending.add(threadId);
      const totals={recorded:0,duplicates:0,rejected:0,sourceExcluded:0,received:0},cursors=new Set();
      let cursor=null,pages=0,last=null,stop='page-limit';
      try{
        for(let attempts=0;attempts<maxPages;attempts++){
          last=await page(threadId,cursor,limit);if(last?.outcome==='captured')pages++;
          for(const key of Object.keys(totals))if(Number.isSafeInteger(last?.[key]))totals[key]+=last[key];
          if(last?.outcome!=='captured'){stop=last?.outcome||'stopped';break;}
          if(last.nextCursor===null){stop='reached-start';break;}
          if(typeof last.nextCursor!=='string'||cursors.has(last.nextCursor)){stop='cursor-repeated';break;}
          cursors.add(last.nextCursor);cursor=last.nextCursor;
        }
        return {outcome:last?.outcome??'stopped',stop,reachedStart:stop==='reached-start',pages,...totals,
          nextCursor:stop==='reached-start'?null:last?.nextCursor??cursor,status:last?.status??null};
      }finally{pending.delete(threadId);}
    },
  });
  return recorder;
  async function page(threadId,cursor,limit){
    try{
      const admission=await requestHistory({action:'canonical-lease',sourceId,threadId});
      if(!admission?.lease)return {outcome:admission?.status?.quotaReached?'quota-reached':'disabled',status:admission?.status??null};
      const client=getClient();if(typeof client?.readThreadConversation!=='function')throw new Error('The installed native client does not expose canonical conversation reads');
      const read=await client.readThreadConversation(threadId,{cursor,limit});
      const sanitized=sanitizeCanonicalPage(read,{threadId,knownSecrets:knownSecrets()});
      const result=await requestHistory({action:'canonical-record',lease:admission.lease,page:sanitized});
      return {...result,nextCursor:read.nextCursor};
    }catch(reason){if(reason?.rpcCode===-32601)throw new Error('This installed native Codex server does not support canonical conversation reads; no fallback history was imported');throw reason;}
  }
}
module.exports={createCanonicalNativeHistoryRecorder};
