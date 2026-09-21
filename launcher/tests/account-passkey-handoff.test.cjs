const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const SECOND = '12345678-1234-4123-8123-123456789abc';
function fixture() {
  let finishCapture;
  const capture = new Promise(resolve => { finishCapture = resolve; });
  const secondary = { accountId: SECOND, activeTraceId: null, turnTabs: new Map(),
    currentOperation() { return this.embeddedLoginController ? 'ChatGPT login' : null; },
    openLogin() {
      this.embeddedLoginController = new AbortController();
      this.loginOperation = new Promise(resolve => this.embeddedLoginController.signal.addEventListener('abort', resolve, {once:true}));
      return this.loginOperation.finally(() => { this.embeddedLoginController = null; this.loginOperation = null; });
    },
    openPasskeyLogin() { this.embeddedLoginController?.abort(); return capture; },
  };
  const primary = { ...secondary, accountId:'default', openPasskeyLogin(){throw Error('Wrong account');} };
  const registry = {snapshot:()=>({selectedId:SECOND,accounts:[{id:'default'},{id:SECOND}]})};
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {registry, hosts:new Map([['default',primary],[SECOND,secondary]]),
    accountOperations:new Map(), accountReadOperations:new Map(), reservations:new Map(), networkOperation:null, loginOperation:null,
    existingChromeImportLease:null, destroyed:false });
  return {pool,secondary,finishCapture};
}

test('secondary account owns passkey import and prevents selection or a conflicting lease', async () => {
  const {pool,finishCapture}=fixture();
  const pending=pool.openPasskeyLogin();
  assert.equal(pool.passkeyImportLease.id,SECOND);
  assert.throws(()=>pool.acquireAccountOperation(SECOND,'quota login'),/busy/);
  await assert.rejects(pool.selectAccount('default'),/passkey sign-in/);
  finishCapture({authenticated:true});
  assert.deepEqual(await pending,{authenticated:true});
  assert.equal(pool.accountOperations.size,0);
  assert.equal(pool.passkeyImportLease,null);
});

test('owned embedded login hands off without releasing the successor account guard', async () => {
  const {pool,secondary,finishCapture}=fixture();
  const login=pool.openLogin();
  assert.ok(secondary.embeddedLoginController);
  const passkey=pool.openPasskeyLogin();
  await login;
  assert.equal(pool.accountOperations.size,0);
  assert.equal(pool.accountMutationOperationLabel(SECOND),'ChatGPT passkey login');
  assert.equal(pool.currentOperation(),'ChatGPT passkey login');
  assert.throws(()=>pool.acquireAccountOperation(SECOND,'other'),/busy/);
  finishCapture({authenticated:true});await passkey;
  assert.equal(pool.accountMutationOperationLabel(SECOND),null);
});

test('an unrelated account operation is not mistaken for a transferable login', async () => {
  const {pool}=fixture();
  const release=pool.acquireAccountOperation(SECOND,'account replacement');
  await assert.rejects(pool.openPasskeyLogin(),/busy/);
  assert.equal(pool.passkeyImportLease,undefined);
  release();
});

test('embedded sign-in cancels a stuck initial observation before passkey handoff', async () => {
 const {BrowserHost}=require('../electron/browser-host.cjs');
 let observed;
 const started=new Promise(r=>{observed=r;});
 const host={state:{authenticated:false},getBrowserInteractionMode:()=> 'automatic',authGeneration:0,
  view:{webContents:{getURL:()=> 'https://chatgpt.com/?temporary-chat=true'}},
  withManualOperation:async(_name,fn)=>fn(),show(){},logger:{info(){}},publishState(){},snapshot:()=>({authenticated:false}),
  probeAuthentication:({signal})=>{observed(signal);return new Promise(()=>{});},
 };
 const pending=BrowserHost.prototype.openLogin.call(host);
 const signal=await started;
 host.embeddedLoginController.abort();
 assert.equal(signal.aborted,true);
 await pending;
 assert.equal(host.loginOperation,null);
 assert.equal(host.embeddedLoginController,null);
});
