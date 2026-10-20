'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function compileSkillPdfHelper({repositoryRoot=path.resolve(__dirname,'..'),platform=process.platform,arch=process.arch,development=false,sign,env=process.env}={}) {
  if(platform!=='darwin')return {supported:false,platform,arch};
  if(!development&&typeof sign!=='function')throw new Error('PDF helper distribution signing requires its explicit signing owner; use --development for an isolated ad-hoc build');
  const target={arm64:'arm64',x64:'x86_64'}[arch];if(!target)throw new Error('Unsupported PDF helper architecture');
  const root=fs.realpathSync(repositoryRoot),source=path.join(root,'launcher/native/skill-pdf-helper.m');
  const st=fs.lstatSync(source);if(!st.isFile()||st.isSymbolicLink())throw new Error('Fixed PDF helper source is unavailable');
  const sourceBytes=fs.readFileSync(source),sourceSha256=hash(sourceBytes);
  const expected=/SKILL_PDF_HELPER_SOURCE_SHA256 = "([a-f0-9]{64})"/.exec(fs.readFileSync(path.join(root,'src/agent-tools/skill-pdf-helper-path.ts'),'utf8'))?.[1];
  if(sourceSha256!==expected)throw new Error('PDF helper source pin must be reviewed before build');
  const run=(command,args,timeout=30000,childEnv=env)=>{const result=spawnSync(command,args,{cwd:root,env:childEnv,encoding:'utf8',stdio:'pipe',shell:false,timeout});if(result.error||result.status!==0)throw new Error('PDF helper build failed: '+(result.stderr||'').slice(0,4000));return result.stdout.trim();};
  const compiler=run('/usr/bin/xcrun',['--find','clang']),sdk=run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path']);
  if(!path.isAbsolute(compiler)||!path.isAbsolute(sdk))throw new Error('Apple compiler/SDK selection is unavailable');
  const directory=path.join(root,'launcher/electron/skill-pdf-helper',`${platform}-${arch}`);
  for(let current=root;current!==directory;){const next=path.relative(current,directory).split(path.sep)[0];current=path.join(current,next);if(!fs.existsSync(current))fs.mkdirSync(current);const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('PDF helper build ancestry is unsafe');}
  if(fs.realpathSync(directory)!==directory||!fs.lstatSync(directory).isDirectory())throw new Error('PDF helper build directory must be canonical');
  const ownerFile=path.join(directory,'.build-owner'),owner=JSON.stringify({pid:process.pid,nonce:crypto.randomUUID()});fs.writeFileSync(ownerFile,owner,{flag:'wx',mode:0o600});
  const temporary=fs.mkdtempSync(path.join(directory,'.build-')),candidate=path.join(temporary,'nekodex-skill-pdf-helper');
  try {
    // Compile the exact reviewed bytes; the checkout path may change after capture.
    const snapshot=path.join(temporary,'skill-pdf-helper.m'),snapshotFD=fs.openSync(snapshot,'wx',0o400);
    try {fs.writeFileSync(snapshotFD,sourceBytes);fs.fsyncSync(snapshotFD);}finally{fs.closeSync(snapshotFD);}
    // This fixed source uses only SDK/builtin headers, with no inherited include roots.
    const compilerEnv={...env};for(const name of ['CPATH','C_INCLUDE_PATH','CPLUS_INCLUDE_PATH','OBJC_INCLUDE_PATH','OBJCPLUS_INCLUDE_PATH'])delete compilerEnv[name];
    run(compiler,['-O2','-fobjc-arc','-Wall','-Wextra','-Wno-deprecated-declarations','-isysroot',sdk,'-target',`${target}-apple-macos13.0`,snapshot,'-lobjc',`-DNEKODEX_PDF_SOURCE_SHA256="${sourceSha256}"`,`-DNEKODEX_PDF_DEVELOPMENT_PROBE=${development?1:0}`,'-o',candidate],120000,compilerEnv);
    if(typeof sign==='function')sign(candidate);else run('/usr/bin/codesign',['--force','--sign','-','--timestamp=none','--identifier','com.nekodex.skill-pdf-helper',candidate]);
    run('/usr/bin/codesign',['--verify','--strict',candidate]);
    const executableSha256=hash(fs.readFileSync(candidate)),manifest={version:1,provider:'macos-pdfkit',target:`${platform}-${arch}`,sourceSha256,executableSha256,development,probe:development};
    fs.chmodSync(candidate,0o755);const executable=path.join(directory,'nekodex-skill-pdf-helper');
    for(const name of ['nekodex-skill-pdf-helper','manifest.json']){const file=path.join(directory,name);if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw new Error('Previous PDF helper artifacts are not regular owned files');}
    const manifestFile=path.join(temporary,'manifest.json');fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o644});
    fs.renameSync(candidate,executable);fs.renameSync(manifestFile,path.join(directory,'manifest.json'));
    return {supported:true,executable,...manifest};
  } finally {fs.rmSync(temporary,{recursive:true,force:true});if(fs.readFileSync(ownerFile,'utf8')!==owner)throw new Error('PDF helper build owner changed');fs.unlinkSync(ownerFile);}
}
module.exports={compileSkillPdfHelper};
if(require.main===module){if(process.argv.slice(2).join(' ')!=='--development')throw new Error('Usage: node scripts/build-skill-pdf-helper.cjs --development');console.log(JSON.stringify(compileSkillPdfHelper({development:true})));}
