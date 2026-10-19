'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function compileExecutionVmHelper({repositoryRoot=path.resolve(__dirname,'..'),platform=process.platform,arch=process.arch,development=false,sign,env=process.env}={}) {
  if(platform!=='darwin'||arch!=='arm64')return {supported:false,platform,arch,reason:'Execution VM helper requires macOS arm64'};
  if(!development&&typeof sign!=='function')throw new Error('Execution VM distribution signing requires an explicit publisher owner');
  const root=fs.realpathSync(repositoryRoot);
  const capture=file=>{const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||fs.realpathSync(file)!==file||before.size>1048576n)throw new Error('Unsafe VM helper build source');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const opened=fs.fstatSync(fd,{bigint:true});if(opened.dev!==before.dev||opened.ino!==before.ino)throw new Error('VM helper source changed');const bytes=fs.readFileSync(fd),after=fs.lstatSync(file,{bigint:true});if(['dev','ino','size','mtimeNs','ctimeNs'].some(k=>before[k]!==after[k]))throw new Error('VM helper source changed');return bytes;}finally{fs.closeSync(fd);}};
  const sourceBytes=capture(path.join(root,'launcher/native/execution-vm-helper.swift'));
  const entitlementBytes=capture(path.join(root,'launcher/native/execution-vm-helper.entitlements.plist'));
  const sourceSha256=sha256(sourceBytes),entitlementsSha256=sha256(entitlementBytes);
  const cleanEnv={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C',HOME:env.HOME||'/var/empty'};
  const run=(command,args,timeout=30000)=>{const r=spawnSync(command,args,{cwd:root,env:cleanEnv,encoding:'utf8',stdio:'pipe',shell:false,timeout,maxBuffer:1048576});if(r.error||r.status!==0)throw new Error('Execution VM helper build failed: '+String(r.stderr||r.error?.code||'command-failed').slice(0,5000));return r.stdout.trim();};
  const compiler=run('/usr/bin/xcrun',['--find','swiftc']),sdk=run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path']);
  if(!path.isAbsolute(compiler)||!path.isAbsolute(sdk))throw new Error('Fixed Apple Swift compiler/SDK unavailable');
  const directory=path.join(root,'launcher/electron/execution-vm-helper','darwin-arm64');
  for(let current=root;current!==directory;){current=path.join(current,path.relative(current,directory).split(path.sep)[0]);if(!fs.existsSync(current))fs.mkdirSync(current,{mode:0o700});const s=fs.lstatSync(current);if(!s.isDirectory()||fs.realpathSync(current)!==current)throw new Error('VM helper build ancestry is unsafe');}
  const ownerPath=path.join(directory,'.build-owner'),owner=JSON.stringify({pid:process.pid,nonce:crypto.randomUUID()});fs.writeFileSync(ownerPath,owner,{mode:0o600,flag:'wx'});
  const temporary=fs.mkdtempSync(path.join(directory,'.build-'));
  try {
    const main=path.join(temporary,'main.swift'),identity=path.join(temporary,'BuildIdentity.swift'),entitlements=path.join(temporary,'entitlements.plist'),candidate=path.join(temporary,'nekodex-execution-vm-helper');
    const write=(file,data)=>{const fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
    write(main,sourceBytes);write(entitlements,entitlementBytes);
    write(identity,`enum BuildIdentity { static let sourceSha256 = "${sourceSha256}"; static let entitlementsSha256 = "${entitlementsSha256}" }\n`);
    run(compiler,['-O','-swift-version','5','-sdk',sdk,'-target','arm64-apple-macos13.0','-framework','Virtualization','-framework','CryptoKit','-module-cache-path',path.join(temporary,'module-cache'),main,identity,'-o',candidate],120000);
    const identifier=development?'com.nekodex.execution-vm-helper.dev':'com.nekodex.execution-vm-helper';
    if(typeof sign==='function')sign(candidate,entitlements);else run('/usr/bin/codesign',['--force','--sign','-','--timestamp=none','--identifier',identifier,'--entitlements',entitlements,candidate]);
    run('/usr/bin/codesign',['--verify','--strict',candidate]);
    const actualEntitlements=run('/usr/bin/codesign',['-d','--entitlements',':-',candidate]);
    // Decode the exact signed entitlement bytes; never accept extra rights.
    const check=spawnSync('/usr/bin/plutil',['-convert','json','-o','-','-'],{input:actualEntitlements,encoding:'utf8',env:cleanEnv,stdio:'pipe',timeout:30000,maxBuffer:1048576});
    const keys=check.status===0?JSON.parse(check.stdout):null;
    if(!keys||JSON.stringify(keys)!==JSON.stringify({'com.apple.security.virtualization':true}))throw new Error('VM helper entitlements must be exactly virtualization:true');
    const executableSha256=sha256(fs.readFileSync(candidate));
    const manifest={version:1,provider:'macos-virtualization',protocol:'neko-vm-v1',target:'darwin-arm64',sourceSha256,entitlementsSha256,executableSha256,development,identifier,cpuCount:2,memoryBytes:2147483648,guestPort:4041};
    const executable=path.join(directory,'nekodex-execution-vm-helper'),manifestPath=path.join(directory,'manifest.json');
    for(const file of [executable,manifestPath])if(fs.existsSync(file)){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||s.nlink!==1)throw new Error('Existing VM helper artifact is not an owned regular file');}
    fs.chmodSync(candidate,0o755);const manifestCandidate=path.join(temporary,'manifest.json');write(manifestCandidate,JSON.stringify(manifest,null,2)+'\n');
    fs.renameSync(candidate,executable);fs.renameSync(manifestCandidate,manifestPath);
    const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    return {supported:true,executable,...manifest};
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
    if(fs.readFileSync(ownerPath,'utf8')!==owner)throw new Error('VM helper build owner changed');fs.unlinkSync(ownerPath);
  }
}
module.exports={compileExecutionVmHelper};
if(require.main===module){if(process.argv.slice(2).join(' ')!=='--development')throw new Error('Usage: node scripts/build-execution-vm-helper.cjs --development');console.log(JSON.stringify(compileExecutionVmHelper({development:true})));}
