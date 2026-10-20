import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExternalUsageService, estimateRecords, LIMITS, validateCatalog } from '../launcher/electron/external-usage.cjs';
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive:true, force:true }); });
function fixture(client: 'codex' | 'claude' = 'codex') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-external-usage-')); temporary.push(dir);
  const logs = path.join(dir, 'selected-logs');fs.mkdirSync(logs);
  const statePath = path.join(dir,'state','usage.json');
  let picks = 0;
  const make = () => createExternalUsageService({statePath,pickDirectory:async()=>{picks++;return logs;}});
  const service = make();
  const select = async (scope: 'unknown' | 'external-only' | 'may-overlap-nekodex' = 'unknown') => {
    const status=await service.selectRoot({client,accountPseudonym:'fixture-account',scope,consent:true});return status.sources[0]!.id;
  };
  return {dir,logs,statePath,service,make,select,picks:()=>picks};
}
const line = (value: unknown) => JSON.stringify(value)+'\n';
const meta = (session='session-a', version='0.135.0') => ({type:'session_meta',payload:{id:session,cli_version:version,source:'cli',cwd:'/private/not-retained',instructions:'private-sentinel'}});
const context = (turn='turn-a', model='test-model') => ({type:'turn_context',payload:{turn_id:turn,model,developer_instructions:'private-sentinel'}});
const usage = (input=100, output=20) => ({type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:input/2,cache_write_input_tokens:0,output_tokens:output,total_tokens:input+output},last_token_usage:{input_tokens:100,output_tokens:20}}}});
const claude = (id='msg-a', output=20, version='2.1.0') => ({type:'assistant',sessionId:'claude-session',uuid:'uuid-a',version,message:{id,model:'test-model',content:[{type:'text',text:'private-sentinel'},{type:'tool_use',input:{secret:'private-sentinel'}}],usage:{input_tokens:40,cache_read_input_tokens:50,cache_creation_input_tokens:10,output_tokens:output}}});
const catalog = {version:'fixture-prices-v1',effectiveDate:'2026-10-18',currency:'USD' as const,models:[{model:'test-model',priceModel:'priced-model',inputPerMillion:10,cachedInputPerMillion:1,cacheWritePerMillion:15,outputPerMillion:20}]};

describe('explicit metadata-only external usage', () => {
  test('does not read anything before picker consent; survives append/restart without retaining content', async () => {
    const f=fixture();fs.writeFileSync(path.join(f.logs,'rollout-fixture.jsonl'),line(meta())+line(context())+line(usage()));
    expect(f.service.snapshot().sources).toHaveLength(0);expect(f.picks()).toBe(0);
    await expect(f.service.selectRoot({client:'codex',accountPseudonym:'safe',scope:'unknown',consent:false} as never)).rejects.toThrow();expect(f.picks()).toBe(0);
    const id=await f.select();let result=await f.service.request({action:'import',sourceId:id});
    expect(result.sources[0]).toMatchObject({inputTokens:100,outputTokens:20,reportedRecords:1,unknownRecords:0});
    expect(fs.readFileSync(f.statePath,'utf8')).not.toContain('private-sentinel');expect(fs.readFileSync(f.statePath,'utf8')).not.toContain('/private/not-retained');
    const resumed=f.make();fs.appendFileSync(path.join(f.logs,'rollout-fixture.jsonl'),line(context('turn-b'))+line(usage(150,30)));
    result=await resumed.request({action:'import',sourceId:id});expect(result.sources[0]).toMatchObject({inputTokens:150,outputTokens:30,reportedRecords:2,unknownRecords:0});
    expect(result.aggregate.knownTokens).toBe(0);expect(result.aggregate.excludedSources).toBe(1);
    if(process.platform!=='win32') expect(fs.statSync(f.statePath).mode&0o077).toBe(0);
  });
  test('deduplicates cumulative rate-limit snapshots, rotation, same-inode rewrites and copied sessions', async () => {
    const f=fixture(),file=path.join(f.logs,'rollout-a.jsonl');
    const original=line(meta())+line(context())+line(usage())+line(usage());fs.writeFileSync(file,original);
    const id=await f.select('external-only');await f.service.request({action:'import',sourceId:id});
    fs.renameSync(file,path.join(f.logs,'rollout-b.jsonl'));fs.writeFileSync(file,original+line(context('turn-b'))+line(usage(200,40)));
    let result=await f.service.request({action:'import',sourceId:id});expect(result.sources[0]).toMatchObject({inputTokens:200,outputTokens:40,unknownRecords:0});
    fs.writeFileSync(file,line(meta('session-b'))+line(context())+line(usage()));
    result=await f.service.request({action:'import',sourceId:id});expect(result.sources[0]).toMatchObject({inputTokens:300,outputTokens:60});
    expect(result.aggregate.knownTokens).toBe(360);
  });
  test('handles partial appends and excludes out-of-scope symlinks', async () => {
    const f=fixture(),file=path.join(f.logs,'rollout-a.jsonl'),outside=path.join(f.dir,'outside.jsonl');
    fs.writeFileSync(outside,line(meta('outside'))+line(context())+line(usage(800,200)));
    fs.symlinkSync(outside,path.join(f.logs,'rollout-escape.jsonl'));
    fs.writeFileSync(file,line(meta())+line(context())+JSON.stringify(usage()));
    const id=await f.select();let result=await f.service.request({action:'import',sourceId:id});
    expect(result.sources[0]).toMatchObject({reportedRecords:0,unknownRecords:1});expect(result.sources[0]!.warnings).toContain('symlinks-excluded');
    fs.appendFileSync(file,'\n');result=await f.service.request({action:'import',sourceId:id});expect(result.sources[0]).toMatchObject({inputTokens:100,outputTokens:20,unknownRecords:0});
  });
  test('future versions and absent usage remain visible unknowns; paused imports do not read', async () => {
    const f=fixture('claude');const row=claude('future',20,'99.1.0');fs.writeFileSync(path.join(f.logs,'fixture.jsonl'),line(row)+line({...claude('missing'),message:{id:'missing',model:'test-model'}}));
    const id=await f.select();let result=await f.service.request({action:'import',sourceId:id});expect(result.sources[0]).toMatchObject({reportedRecords:0,unknownRecords:2});
    expect(result.sources[0]!.warnings).toContain('unsupported-client-version');expect(result.sources[0]!.estimate.amount).toBeNull();
    await f.service.request({action:'set-enabled',sourceId:id,enabled:false});await expect(f.service.request({action:'import',sourceId:id})).rejects.toThrow('Enable');
  });
  test('Claude streamed blocks and duplicate files count a message once and update final output', async () => {
    const f=fixture('claude'),file=path.join(f.logs,'fixture.jsonl');fs.writeFileSync(file,line(claude())+line({...claude(),uuid:'another-block'}));
    const id=await f.select();await f.service.request({action:'import',sourceId:id});fs.appendFileSync(file,line(claude('msg-a',30)));
    fs.writeFileSync(path.join(f.logs,'copy.jsonl'),line(claude()));
    const result=await f.service.request({action:'import',sourceId:id});expect(result.sources[0]).toMatchObject({inputTokens:100,outputTokens:30,reportedRecords:1});
  });
  test('bounded oversized line skipping recovers at the next complete event', async () => {
    const f=fixture(),file=path.join(f.logs,'rollout-a.jsonl');fs.writeFileSync(file,line(meta())+line({type:'response_item',payload:'x'.repeat(LIMITS.lineBytes!+100)})+line(context())+line(usage()));
    const id=await f.select();const result=await f.service.request({action:'import',sourceId:id});expect(result.sources[0]).toMatchObject({inputTokens:100,outputTokens:20});expect(result.sources[0]!.warnings).toContain('oversized-jsonl-line-excluded');
  });
  test('retains conflicting Native/forwarding scope outside the aggregate and clears only explicitly removed metadata', async () => {
    const f=fixture();const file=path.join(f.logs,'rollout-a.jsonl');fs.writeFileSync(file,line(meta())+line(context())+line(usage()));
    const id=await f.select('may-overlap-nekodex');let result=await f.service.request({action:'import',sourceId:id});
    expect(result.sources[0]!.inputTokens).toBe(100);expect(result.aggregate.knownTokens).toBe(0);
    result=await f.service.request({action:'set-scope',sourceId:id,scope:'external-only'});expect(result.aggregate.knownTokens).toBe(120);
    await f.service.request({action:'forget-source',sourceId:id});expect(fs.existsSync(file)).toBe(true);expect(f.service.snapshot().sources).toHaveLength(0);
    const again=await f.select();result=await f.service.request({action:'import',sourceId:again});expect(result.sources[0]!.inputTokens).toBe(100);
  });
});
describe('honest user-catalog API-equivalent estimates', () => {
  const record={model:'test-model',usage:{inputTokens:100,outputTokens:20,cachedInputTokens:50,cacheWriteTokens:10}};
  test('keeps uncatalogued and unknown cache/model tokens unpriced, without inventing a zero bill', () => {
    expect(estimateRecords([record],null)).toMatchObject({amount:null,knownTokens:120,unpricedTokens:120,complete:false});
    const priced=estimateRecords([record],catalog);expect(priced.amount).toBeCloseTo(0.001);expect(priced).toMatchObject({unpricedTokens:0,complete:true,catalogVersion:'fixture-prices-v1',effectiveDate:'2026-10-18'});
    const partial=estimateRecords([{...record,usage:{...record.usage,cachedInputTokens:null}},{model:null,usage:null}],catalog);
    expect(partial).toMatchObject({unpricedTokens:100,unknownRecords:1,pricedTokens:20,complete:false});expect(partial.amount).toBeCloseTo(0.0004);
    expect(estimateRecords([{...record,model:'unmapped-model'}],catalog).amount).toBeNull();
    expect(()=>validateCatalog({...catalog,models:[{...catalog.models[0],outputPerMillion:-1}]})).toThrow();
  });
});
