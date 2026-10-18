import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createNativeAccountInventoryService } = require('../launcher/electron/native-account-inventory.cjs');
const { digest } = require('../launcher/electron/owned-native-admission.cjs');
const actualBootstrap = resolve(import.meta.dir, '../launcher/native/owned-worker/build/aarch64-apple-darwin/official-bootstrap-models.json');

test.skipIf(process.platform !== 'darwin' || !existsSync(actualBootstrap))('staged owned inventory (requires reviewed local DEV bootstrap) closes each owner, permits only metadata RPCs, reads complete cache after close and retains uncertain races without replay', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-inventory-')));
  try {
    const p: any = { profileId: randomUUID(), epoch: randomUUID(), root: join(root,'profile'), home: join(root,'profile','home'),
      codexHome: join(root,'profile','codex'), sqliteHome: join(root,'profile','sqlite'), cwd: join(root,'profile','home','work'),
      tmp: join(root,'profile','home','tmp'), config: join(root,'profile','codex','config.toml') };
    for (const dir of [p.root,p.home,p.codexHome,p.sqliteHome,p.cwd,p.tmp]) mkdirSync(dir,{recursive:true,mode:0o700});
    writeFileSync(join(p.codexHome,'auth.json'), 'never read by inventory', { mode:0o600 });
    writeFileSync(p.config,'model_provider = "openai"\n', { mode:0o600 });
    const sourceRoot = join(root,'wrapper'), output = join(sourceRoot,'build','aarch64-apple-darwin');
    mkdirSync(output,{recursive:true,mode:0o700});
    const executable = join(output,'nekodex-owned-native-worker'); writeFileSync(executable,'fake executable',{mode:0o700});
    const bootstrap = join(output,'official-bootstrap-models.json'); copyFileSync(actualBootstrap,bootstrap);
    const lease = {}, events: string[] = [], requests: string[] = []; let held = false, children = 0, releaseCount = 0, mutateAuth: false | 'during' | 'outside' = false;
    const authority = {
      resolveProfile(id:string, epoch:string, owner:any) { expect(id).toBe(p.profileId); expect(epoch).toBe(p.epoch); expect(owner).toBe(lease);
        return {...p, configSha256:digest(readFileSync(p.config))}; },
      publishProfileConfig(input:any) { expect(input.profileOwner).toBe(lease); expect(children).toBe(0);
        expect(input.expectedConfigSha256).toBe(digest(readFileSync(p.config))); writeFileSync(p.config,input.configText,{mode:0o600});
        events.push('publish'); return {configSha256:digest(input.configText)}; },
      releaseProfileOwner(owner:any) { expect(owner).toBe(lease); expect(children).toBe(0); held=false; releaseCount++; },
    };
    const pin = { executable, executableSha256:digest('fake executable'), wrapperBuildPin:{sourceRoot}, target:'aarch64-apple-darwin',
      officialBootstrapCatalog:{path:bootstrap,sha256:digest(readFileSync(bootstrap))} };
    let stage = 0;
    const spawnProcess = (_exe:string, args:string[], options:any) => {
      expect(held).toBe(true); expect(children).toBe(0); children++; stage++; const n=stage, classifier=args.includes('--account-info'), online=!classifier && Bun.TOML.parse(readFileSync(p.config,'utf8')).model_catalog_json === undefined;
      expect(options.env.CODEX_HOME).toBe(p.codexHome); expect(options.env.OPENAI_API_KEY).toBeUndefined();
      const c:any = new EventEmitter(); c.stdout=new PassThrough(); c.stderr=new PassThrough();
      const close = () => { if(c.closed)return; c.closed=true; children--; events.push('close'+n);
        // A cache file intentionally doesn't exist until exact online-owner close.
        if(online) writeFileSync(join(p.codexHome,'models_cache.json'), JSON.stringify({fetched_at:new Date().toISOString(),client_version:'0.163.0',identity:'a'.repeat(64),etag:'actual-fixture-etag',models:[{
          slug:'actual-fixture-model',display_name:'Actual fixture model',model_messages:{instructions_template:'actual provider instructions'},shell_type:'default',apply_patch_tool_type:'freeform',tool_mode:'direct',experimental_supported_tools:[]
        }]}), {mode:0o644});
        c.emit('close',0,null); if(classifier && mutateAuth==='outside') writeFileSync(join(p.codexHome,'auth.json'),'outside change '+n,{mode:0o600}); };
      let buffer=''; c.stdin = new Writable({write(chunk,_enc,done){ buffer+=chunk.toString();
        while(buffer.includes('\n')) { const end=buffer.indexOf('\n'), msg=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
          if(msg.method==='initialized')continue; requests.push(msg.method);
          let result:any;
          if(msg.method==='initialize')result={codexHome:p.codexHome,userAgent:'owned fixture'};
          else if(msg.method==='config/read'){const config=Bun.TOML.parse(readFileSync(p.config,'utf8'));result={config,layers:[{name:{type:'user',file:p.config},config}]};}
          else if(msg.method==='configRequirements/read')result={requirements:null};
          else if(msg.method==='account/read')result={account:{type:'chatgpt',email:'fixture@example.test',planType:'pro'}};
          else if(msg.method==='account/rateLimits/read')result={ordinaryUsageAllowed:true,accountId:'owned-account',rateLimits:null,rateLimitsByLimitId:null};
          else if(msg.method==='model/list'){result={data:[{id:'actual-fixture-model'}],nextCursor:null};if(mutateAuth==='during') writeFileSync(join(p.codexHome,'auth.json'),'changed',{mode:0o600});}
          else throw new Error('unowned RPC '+msg.method);
          queueMicrotask(()=>c.stdout.write(JSON.stringify({id:msg.id,result})+'\n'));
        } done(); }}); c.stdin.on('finish',close); c.kill=close;
      if(args.includes('--account-info')) { expect(_exe).toBe('/usr/bin/sandbox-exec'); expect(args[1]).toContain('(deny network*)'); expect(args[1]).toContain('(deny process-fork)');
        queueMicrotask(()=>{c.stdout.write(JSON.stringify({schemaVersion:1,type:'chatgpt',planType:'pro',usesCodexBackend:true,classification:'personal-pro'}));close();}); }
      else { expect(args).toEqual(['--stdio']); expect(Bun.TOML.parse(readFileSync(p.config,'utf8')).model_catalog_json !== undefined).toBe(!online); }
      return c;
    };
    const service=createNativeAccountInventoryService({authority,getWrapperPin:()=>pin,acquireProfileOwner:()=>{expect(held).toBe(false);held=true;return lease;},
      storageRoot:join(root,'receipts'),requestTimeoutMs:100,stopGraceMs:5,testHooks:{verifyWrapper:()=>{},probeManagedPreferences:()=>{},spawnProcess,terminateProcess:(c:any)=>c.kill()}});
    const actionId=randomUUID(); const receipt=await service.run({actionId,profileId:p.profileId,epoch:p.epoch,explicitUserAction:true});
    expect(statSync(join(p.codexHome,'models_cache.json')).mode & 0o777).toBe(0o600);
    expect(receipt.state).toBe('completed'); expect(receipt.ownerHeld).toBe(false); expect(children).toBe(0);expect(releaseCount).toBe(1);
    expect(events).toEqual(['close1','publish','close2','publish','close3']);
    expect(requests.every(m=>['initialize','config/read','configRequirements/read','account/read','account/rateLimits/read','model/list'].includes(m))).toBe(true);
    expect(service.inspect().models).toEqual([]);expect(service.inspect().executionAvailable).toBe(false);
    expect(service.trustedInventory(actionId).catalog.models[0].model_messages.instructions_template).toBe('actual provider instructions');
    await expect(service.run({actionId,profileId:p.profileId,epoch:p.epoch,explicitUserAction:true})).rejects.toMatchObject({code:'intent_already_recorded'});expect(stage).toBe(3);
    mutateAuth='outside'; const raceId=randomUUID();
    await expect(service.run({actionId:raceId,profileId:p.profileId,epoch:p.epoch,explicitUserAction:true})).rejects.toMatchObject({code:'profile_epoch_changed',actionRecorded:true});
    expect(service.inspect().receipts.find((r:any)=>r.actionId===raceId)).toMatchObject({state:'unknown',ownerHeld:false,reasonCode:'profile_epoch_changed'});
    expect(children).toBe(0);expect(releaseCount).toBe(2);expect(service.trustedInventory(raceId)).toBe(null);
    // A guarded native refresh is accepted only after identity bracket, exact close,
    // another no-network classifier, and stable post-classifier auth metadata.
    mutateAuth='during';const refreshId=randomUUID(), refreshStart=stage;
    const refreshed=await service.run({actionId:refreshId,profileId:p.profileId,epoch:p.epoch,explicitUserAction:true});
    expect(refreshed.state).toBe('completed');expect(stage-refreshStart).toBe(4);
    expect(service.trustedInventory(refreshId).usage.accountId).toBe('owned-account');
    expect(children).toBe(0);expect(releaseCount).toBe(3);
    await service.destroy();
  } finally { rmSync(root,{recursive:true,force:true}); }
}, 5000);
