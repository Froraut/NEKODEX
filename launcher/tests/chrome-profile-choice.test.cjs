const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {readProfiles,selectMatch}=require('../electron/chrome-profile-choice.cjs');
const {createProfileFirstLogin,verifyCapturedAccount}=require('../electron/profile-first-login.cjs');
test('profile metadata returns safe existing directories and matches saved email, not labels',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nekodex-profiles-'));
 try{
  fs.mkdirSync(path.join(root,'Default'));fs.mkdirSync(path.join(root,'Profile 2'));
  fs.writeFileSync(path.join(root,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Work',user_name:'A@EXAMPLE.COM'},'Profile 2':{name:'Prim2',user_name:'b@example.com'},'../escape':{user_name:'bad@example.com'},'Profile 3':{user_name:'missing@example.com'}}}}));
  const list=readProfiles(root);assert.equal(list.length,2);
  assert.equal(selectMatch(list,'a@example.com',null).id,'Default');
  assert.equal(selectMatch(list,'Prim2',null),null);
  assert.equal(selectMatch(list,null,{id:'Profile 2',email:'old@example.com'}),null);
  assert.equal(selectMatch(list,null,{id:'Profile 2',email:'b@example.com'}).id,'Profile 2');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('choosing a new profile uses existing isolated login; cancelled selection does not launch it',async()=>{
 let starts=0;
 const options={runtime:{capturePasskeyLogin:async()=>{starts++;return 'new';}}};
 assert.equal(await createProfileFirstLogin({...options,choose:async()=>({kind:'new'})})(()=>{},{accountId:'default'}),'new');
 await assert.rejects(createProfileFirstLogin({...options,choose:async()=>({kind:'cancel'})})(()=>{},{accountId:'default'}),e=>e.code==='profile-login-cancelled');
 assert.equal(starts,1);
});
test('existing profile import verifies email in an isolated session before handing off cookies',async()=>{
 let cleared=0,captured=0,newStarts=0;
 const transfer={storageState:{cookies:[{name:'__Secure-next-auth.session-token',value:'fixture',domain:'.chatgpt.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]},cleanup:async()=>{}};
 const isolated={cookies:{set:async()=>{}},fetch:async()=>new Response(JSON.stringify({user:{email:'wrong@example.com'}}),{headers:{'content-type':'application/json'}}),clearStorageData:async()=>{cleared++;},closeAllConnections(){}};
 await assert.rejects(verifyCapturedAccount({fromPartition:()=>isolated},transfer,'expected@example.com'),e=>e.code==='chrome-account-mismatch');assert.equal(cleared,1);
 isolated.fetch=async()=>new Response(JSON.stringify({user:{email:'expected@example.com'}}),{headers:{'content-type':'application/json'}});
 const login=createProfileFirstLogin({choose:async()=>({kind:'existing',email:'expected@example.com'}),runtime:{captureExistingChromeLogin:async()=>{captured++;return transfer;},capturePasskeyLogin:async()=>{newStarts++;}},session:{fromPartition:()=>isolated},dialog:{showMessageBox:async()=>({response:1})},window:()=>null,language:()=> 'en'});
 assert.equal(await login(()=>{},{accountId:'default'}),transfer);assert.equal(captured,1);assert.equal(newStarts,0);assert.equal(cleared,2);
});
test('profile selection opens the exact existing directory and remembers it, while explicit fallback creates no Chrome window',async()=>{
 const {createChromeProfileChoice}=require('../electron/chrome-profile-choice.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nekodex-choice-'));
 try {
  fs.mkdirSync(path.join(root,'Default'));fs.mkdirSync(path.join(root,'Profile 2'));
  fs.writeFileSync(path.join(root,'Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'One',user_name:'one@example.test'},'Profile 2':{name:'Two',user_name:'two@example.test'}}}}));
  let response=2;const launches=[];let lastDialog;
  const choose=createChromeProfileChoice({root,coreHome:root,dialog:{showMessageBox:async(_w,d)=>{lastDialog=d;return {response};}},window:()=>null,executable:()=>'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',language:()=> 'ru',launch:async(...args)=>launches.push(args)});
  const first=await choose({accountId:'default'});assert.equal(first.email,'two@example.test');assert.equal(launches[0][1],'Profile 2');
  response=0;await choose({accountId:'default'});assert.match(lastDialog.buttons[1],/two@example.test/);
  response=3;assert.deepEqual(await choose({accountId:'default'}),{kind:'new'});assert.equal(launches.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
