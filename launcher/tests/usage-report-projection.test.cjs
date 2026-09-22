const test = require('node:test');
const assert = require('node:assert/strict');
const { projectWebUsage, projectNativeUsage } = require('../electron/usage-report.cjs');
const { emptyGroup, emptyNativeGroup, rowKey, nativeRowKey } = require('../electron/usage-schema.cjs');
function freeze(value) { Object.freeze(value); for(const child of Object.values(value)) if(child && typeof child === 'object') freeze(child); return value; }
const now = new Date(2026,8,22,23,59,45).getTime();
const health={error:null,recovered:true,backupAvailable:false};
test('Web projection preserves unknown lifetime and detached rows without touching future receipts',()=>{
  const row={day:'2026-09-22',...emptyGroup({accountId:'default',effort:'high',modelVersion:'6',modelVersionSource:'observed',mode:'automatic',messageKind:'task'}),accepted:1,completed:1};
  const future={...row,day:'2026-09-23'};
  const state=freeze({startedAt:now,rows:{[rowKey(row)]:row,[rowKey(future)]:future},receipts:{one:{key:rowKey(row),owner:'owner',outcome:'completed',durationMs:100}},lifetimeGroups:{one:{...row,accepted:2,completed:2}},lifetimeUnclassified:3});
  const before=JSON.stringify(state), result=projectWebUsage(state,{days:1,accountId:null},[{id:'default',label:'Default'}],now,health);
  assert.equal(result.metrics.total,1); assert.equal(result.lifetime,5); assert.equal(result.calendar[0].day,'2026-09-22'); assert.equal(result.durations.medianMs,100);
  result.rows[0].accepted=90; assert.equal(JSON.stringify(state),before);
  assert.equal(projectWebUsage(state,{days:1,accountId:null},[],now,{...health,error:'unavailable'}).available,false);
});
test('Native projection distinguishes optional token unknown from measured zero and excludes future rows',()=>{
  const row={day:'2026-09-22',...emptyNativeGroup({endpoint:'responses',modelId:'gpt-6',modelIdSource:'reported'}),accepted:1,completed:1,reportedSamples:1,httpStatuses:{200:1}};
  const future={...row,day:'2026-09-23'};
  const state=freeze({startedAt:now,native:{rows:{[nativeRowKey(row)]:row,[nativeRowKey(future)]:future},receipts:{},lifetime:2,lifetimeGroups:{one:{...row,accepted:2,completed:2}}}});
  const before=JSON.stringify(state), result=projectNativeUsage(state,1,now,health);
  assert.equal(result.metrics.total,1); assert.equal(result.lifetime,2); assert.equal(result.tokens.inputTokens,0); assert.equal(result.tokens.cachedInputTokens,null);
  result.rows[0].httpStatuses[200]=99; assert.equal(JSON.stringify(state),before);
  const measured=structuredClone(state); measured.native.rows[nativeRowKey(row)].cachedInputReportedSamples=1;
  assert.equal(projectNativeUsage(measured,1,now,health).tokens.cachedInputTokens,0);
});
