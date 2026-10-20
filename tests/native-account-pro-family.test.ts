import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { createNativeAccountInventoryService } = require('../launcher/electron/native-account-inventory.cjs');
const { makeNativeAccountAdmission } = require('../launcher/electron/native-account-admission.cjs');
const { digest } = require('../launcher/electron/owned-native-admission.cjs');
const modelFixture = require('./fixtures/owned-native-model.cjs');
const bootstrapSource = resolve(import.meta.dir, '../launcher/native/owned-worker/build/aarch64-apple-darwin/official-bootstrap-models.json');

test.skipIf(process.platform !== 'darwin' || !existsSync(bootstrapSource))('personal Pro variants retain actual plan through fixed classifier, inventory and admission; other plans stay closed', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'neko-pro-family-')));
  try {
    for (const planType of ['promax', 'prolite', 'plus', 'team', 'self_serve_business_prolite', 'unknown']) {
      const scenario = join(root, planType); mkdirSync(scenario, {mode:0o700});
      const p:any = {profileId:randomUUID(),epoch:randomUUID(),root:join(scenario,'profile'),home:join(scenario,'profile','home'),codexHome:join(scenario,'profile','codex'),
        sqliteHome:join(scenario,'profile','sqlite'),cwd:join(scenario,'profile','home','work'),tmp:join(scenario,'profile','tmp'),config:join(scenario,'profile','codex','config.toml')};
      for (const dir of [p.root,p.home,p.codexHome,p.sqliteHome,p.cwd,p.tmp]) mkdirSync(dir,{recursive:true,mode:0o700});
      writeFileSync(p.config,'model_provider = "openai"\n',{mode:0o600});
      writeFileSync(join(p.codexHome,'auth.json'),'inert test auth bytes; no host read',{mode:0o600});
      const sourceRoot=join(scenario,'wrapper'), output=join(sourceRoot,'build','aarch64-apple-darwin');mkdirSync(output,{recursive:true,mode:0o700});
      const executable=join(output,'inert-wrapper');writeFileSync(executable,'inert test binary',{mode:0o700});
      const bootstrap=join(output,'official-bootstrap-models.json');copyFileSync(bootstrapSource,bootstrap);
      const pin={executable,executableSha256:digest('inert test binary'),target:'aarch64-apple-darwin',wrapperBuildPin:{sourceRoot},officialBootstrapCatalog:{path:bootstrap,sha256:digest(readFileSync(bootstrap))}};
      let lease:any={kind:'inventory'}, active=0, appServers=0, publications=0;
      const authority={
        resolveProfile(_id:string,_epoch:string,owner:any){expect(owner).toBe(lease);return {...p,configSha256:digest(readFileSync(p.config))};},
        publishProfileConfig(input:any){expect(active).toBe(0);expect(input.profileOwner).toBe(lease);expect(input.expectedConfigSha256).toBe(digest(readFileSync(p.config)));
          publications++;writeFileSync(p.config,input.configText,{mode:0o600});return {configSha256:digest(input.configText)};},
        releaseProfileOwner(owner:any){expect(owner).toBe(lease);expect(active).toBe(0);},
      };
      const catalog=JSON.parse(modelFixture.json), requests:string[]=[];
      const spawnProcess=(_executable:string,args:string[])=>{
        expect(active).toBe(0);active++;const classifier=args.includes('--account-info');if(!classifier)appServers++;
        const online=!classifier && !Bun.TOML.parse(readFileSync(p.config,'utf8')).model_catalog_json;
        const c:any=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();let buffer='';
        const close=()=>{if(c.closed)return;c.closed=true;active--;if(online)writeFileSync(join(p.codexHome,'models_cache.json'),JSON.stringify({
          client_version:'0.163.0',identity:'a'.repeat(64),fetched_at:new Date().toISOString(),etag:'family-test',models:catalog.models}),{mode:0o600});c.emit('close',0,null);};
        c.stdin=new Writable({write(chunk,_encoding,done){buffer+=chunk.toString();while(buffer.includes('\n')){
          const at=buffer.indexOf('\n'),msg=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(msg.method==='initialized')continue;requests.push(msg.method);
          let result:any;
          if(msg.method==='initialize')result={codexHome:p.codexHome,userAgent:'family fixture'};
          else if(msg.method==='config/read'){const config=Bun.TOML.parse(readFileSync(p.config,'utf8'));result={config,layers:[{name:{type:'user',file:p.config},config}]};}
          else if(msg.method==='configRequirements/read')result={requirements:null};
          else if(msg.method==='account/read')result={account:{type:'chatgpt',planType,email:'family@example.invalid'}};
          else if(msg.method==='account/rateLimits/read')result={accountId:'family-account',ordinaryUsageAllowed:true,rateLimits:null,rateLimitsByLimitId:null};
          else if(msg.method==='model/list')result={data:[{id:modelFixture.modelId}],nextCursor:null};
          else throw new Error('Unowned RPC '+msg.method);
          queueMicrotask(()=>c.stdout.write(JSON.stringify({id:msg.id,result})+'\n'));
        }done();}});c.stdin.on('finish',close);c.kill=close;
        if(classifier)queueMicrotask(()=>{c.stdout.write(JSON.stringify({schemaVersion:1,type:'chatgpt',planType,usesCodexBackend:true,classification:'personal-pro'}));close();});
        return c;
      };
      const inventory=createNativeAccountInventoryService({authority,getWrapperPin:()=>pin,acquireProfileOwner:()=>lease,storageRoot:join(scenario,'receipts'),requestTimeoutMs:100,stopGraceMs:5,
        testHooks:{verifyWrapper(){},probeManagedPreferences(){},spawnProcess,terminateProcess:(child:any)=>child.kill()}});
      const actionId=randomUUID(), input={actionId,profileId:p.profileId,epoch:p.epoch,explicitUserAction:true};
      if(!['promax','prolite'].includes(planType)){
        await expect(inventory.run(input)).rejects.toMatchObject({code:'unsupported_account'});expect(appServers).toBe(0);expect(publications).toBe(0);expect(active).toBe(0);await inventory.destroy();continue;
      }
      const receipt=await inventory.run(input), original=inventory.trustedInventory(actionId);
      expect(receipt.state).toBe('completed');expect(receipt.metadata.account.planType).toBe(planType);expect(original.account.planType).toBe(planType);
      expect(appServers).toBe(2);expect(requests.every(method=>!method.startsWith('thread/')&&!method.startsWith('turn/'))).toBe(true);
      lease={kind:'execution'};const profile=authority.resolveProfile(p.profileId,p.epoch,lease);
      const options={authority,lease,profile,inventory:original,inventoryActionId:actionId,pin,serverGeneration:randomUUID(),generationRoot:join(scenario,'generation'),
        testHooks:{verifyWrapper(){},probeManagedPreferences(){}}};
      for(const unsupported of ['plus','team','self_serve_business_prolite','unknown']){
        expect(()=>makeNativeAccountAdmission({...options,inventory:{...original,account:{...original.account,planType:unsupported}}})).toThrow('Current own-profile Native inventory is required');
      }
      const admission=makeNativeAccountAdmission(options);expect(admission.models[0].id).toBe(modelFixture.modelId);
      expect(()=>admission.checkAccount({account:{...original.account,planType:'pro'}},original.usage)).toThrow('Native execution account or ordinary usage changed');
      admission.checkAccount({account:original.account},original.usage);expect(active).toBe(0);await inventory.destroy();
    }
  } finally {rmSync(root,{recursive:true,force:true});}
},5000);
