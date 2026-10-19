import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExternalUsageService } from '../launcher/electron/external-usage.cjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive:true,force:true}); });
const line = (value: unknown) => JSON.stringify(value) + '\n';
const header = {sessionId:'gemini-session',projectHash:'synthetic-project',summary:'private-transcript-marker'};
const message = (id='response-a', output=5) => ({id,type:'gemini',timestamp:'2026-10-19T09:00:00.000Z',model:'gemini-fixture',
  content:[{text:'private-transcript-marker'}],thoughts:[{text:'private-transcript-marker'}],toolCalls:[{args:{secret:'private-transcript-marker'}}],
  tokens:{input:100,output,cached:40,thoughts:3,tool:0,total:100+output+3}});
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nekodex-usage-formats-'));roots.push(root);
  const first=path.join(root,'selected'),second=path.join(root,'other-selected');fs.mkdirSync(first);fs.mkdirSync(second);
  let selection=first,picks=0;
  const statePath=path.join(root,'state','usage.json');
  const make=()=>createExternalUsageService({statePath,pickDirectory:async()=>{picks++;return selection;}});
  const service=make();
  const select=async(directory=first)=>{selection=directory;const result=await service.selectRoot({client:'gemini',scope:'external-only',accountPseudonym:'fixture',consent:true});return result.sources.at(-1)!.id;};
  return {root,first,second,statePath,make,service,select,picks:()=>picks};
}

test('Gemini session JSONL deduplicates updates, migration and restart without content retention',async()=>{
  const f=fixture(),file=path.join(f.first,'session-fixture.jsonl');
  fs.writeFileSync(file,line(header)+line(message())+line(message()));
  const id=await f.select();let result=await f.service.request({action:'import',sourceId:id});
  expect(result.sources[0]).toMatchObject({adapter:'gemini-session-v1',inputTokens:100,outputTokens:8,reportedRecords:1});
  fs.appendFileSync(file,line(message('response-a',9))+line({$rewindTo:'response-a'})+line({$patch:{id:'response-a',content:'private-transcript-marker'}}));
  fs.writeFileSync(path.join(f.first,'session-legacy.json'),JSON.stringify({...header,messages:[message('response-a',9)]},null,2));
  result=await f.make().request({action:'import',sourceId:id});
  expect(result.sources[0]).toMatchObject({inputTokens:100,outputTokens:12,reportedRecords:1});
  const bytes=fs.readFileSync(f.statePath,'utf8');expect(bytes).not.toContain('private-transcript-marker');expect(bytes).not.toContain('response-a');expect(bytes).not.toContain('gemini-session');
  result=await f.make().request({action:'import',sourceId:id});expect(result.aggregate.knownTokens).toBe(112);
});

test('Gemini incomplete token categories stay unknown and final message updates complete them',async()=>{
  const f=fixture(),file=path.join(f.first,'session-fixture.jsonl');
  const unknown={...message('unknown'),tokens:{...message().tokens,tool:7}};
  fs.writeFileSync(file,line(header)+line(unknown)+JSON.stringify(message('partial')));
  const id=await f.select();let result=await f.service.request({action:'import',sourceId:id});
  expect(result.sources[0]).toMatchObject({reportedRecords:0,unknownRecords:1});
  expect(result.sources[0]!.warnings).toContain('unsupported-gemini-tool-token-accounting');
  fs.appendFileSync(file,'\n'+line(message('unknown')));
  result=await f.make().request({action:'import',sourceId:id});
  expect(result.sources[0]).toMatchObject({inputTokens:200,outputTokens:16,reportedRecords:2,unknownRecords:0});
});

test('picker consent, nested-root exclusion and copied sessions preserve original attribution',async()=>{
  const f=fixture();
  await expect(f.service.selectRoot({client:'gemini',scope:'external-only',accountPseudonym:'fixture',consent:false} as never)).rejects.toThrow();expect(f.picks()).toBe(0);
  fs.writeFileSync(path.join(f.first,'session-a.json'),JSON.stringify({...header,messages:[message()]}));
  const id=await f.select();await f.service.request({action:'import',sourceId:id});
  const nested=path.join(f.first,'nested');fs.mkdirSync(nested);await expect(f.select(nested)).rejects.toThrow('Overlapping');
  fs.writeFileSync(path.join(f.second,'session-copy.jsonl'),line(header)+line(message())+line(message('response-b')));
  const secondId=await f.select(f.second);let result=await f.service.request({action:'import',sourceId:secondId});
  expect(result.sources[0]).toMatchObject({inputTokens:100,outputTokens:8});expect(result.sources[1]!.reportedRecords).toBe(0);expect(result.aggregate.knownTokens).toBe(108);
  expect(result.sources[1]!.warnings).toContain('duplicate-session-in-another-source: original attribution retained');
  await f.service.request({action:'set-enabled',sourceId:secondId,enabled:false});await expect(f.service.request({action:'import',sourceId:secondId})).rejects.toThrow('Enable');
  await f.service.request({action:'forget-source',sourceId:id});expect(fs.existsSync(path.join(f.first,'session-a.json'))).toBe(true);
});
