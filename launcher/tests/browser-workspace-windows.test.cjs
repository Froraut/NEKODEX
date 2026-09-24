const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {BrowserWorkspaceWindows}=require('../electron/browser-workspace-windows.cjs');
class Window extends EventEmitter {
 constructor(options){super();this.options=options;this.tabbingIdentifier=options.tabbingIdentifier;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=fn=>{this.popup=fn;};this.destroyed=false;this.tabs=[];}
 loadURL(url){this.url=url;return Promise.resolve();} show(){} focus(){this.emit('focus');}setTitle(value){this.title=value;}isDestroyed(){return this.destroyed;}
 addTabbedWindow(child){this.tabs.push(child);}selectNextTab(){this.next=true;}selectPreviousTab(){this.previous=true;}
 close(){if(this.preventClose)this.webContents.emit('will-prevent-unload');else this.destroy();}
 destroy(){this.destroyed=true;this.emit('closed');}
}
function manager(id){return new BrowserWorkspaceWindows({BrowserWindow:Window,session:{id},accountId:id,label:id,
 platform:'darwin',allowedUrl:url=>url.startsWith('https://chatgpt.com/'),register(){},unregister(){},external:async()=>{}});}
test('separate windows, native tabs and keyboard switching keep their account session and sandbox',async()=>{
 const a=manager('a'),b=manager('b');try{
  const first=a.open();const second=a.open({asTab:true});const separate=a.open();const other=b.open({asTab:true});
  assert.deepEqual(first.tabs,[second]);assert.equal(first.options.webPreferences.session,second.options.webPreferences.session);
  assert.notEqual(first.options.webPreferences.session,other.options.webPreferences.session);
  assert.notEqual(first.tabbingIdentifier,separate.tabbingIdentifier);
  assert.equal(second.options.webPreferences.nodeIntegration,false);assert.equal(second.options.webPreferences.sandbox,true);
  second.webContents.emit('before-input-event',{preventDefault(){}},{type:'keyDown',key:'Tab',control:true});assert.equal(second.next,true);
  second.webContents.emit('before-input-event',{preventDefault(){}},{type:'keyDown',key:'Tab',control:true,shift:true});assert.equal(second.previous,true);
  assert.equal(first.popup({url:'https://untrusted.test/'}).action,'deny');
  assert.equal(first.popup({url:'https://chatgpt.com/auth'}).overrideBrowserWindowOptions.webPreferences.session,first.options.webPreferences.session);
  await a.closeAll();assert.equal(a.windows.size,0);
 }finally{a.destroy();b.destroy();}
});
test('quit preserves a browser window that refuses unload',async()=>{
 const m=manager('a');try{const w=m.open();w.preventClose=true;await assert.rejects(m.closeAll(),/save work/);assert.equal(w.destroyed,false);}finally{m.destroy();}
});

test('Cmd-W closes the current macOS workspace tab and respects an unload veto',()=>{
 const m=manager('close-shortcut');try{
  const first=m.open();const tab=m.open({asTab:true});let prevented=false;
  tab.webContents.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'w',meta:true});
  assert.equal(prevented,true);assert.equal(tab.destroyed,true);assert.equal(m.windows.has(tab),false);
  first.preventClose=true;prevented=false;
  first.webContents.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'W',meta:true});
  assert.equal(prevented,true);assert.equal(first.destroyed,false);assert.equal(m.windows.has(first),true);
 }finally{m.destroy();}
});

test('Ctrl-W closes the current Windows or Linux workspace window',()=>{
 const m=new BrowserWorkspaceWindows({BrowserWindow:Window,session:{id:'linux'},accountId:'linux',label:'linux',
  platform:'linux',allowedUrl:url=>url.startsWith('https://chatgpt.com/'),register(){},unregister(){},external:async()=>{}});
 try{const w=m.open();let prevented=false;
  w.webContents.emit('before-input-event',{preventDefault(){prevented=true;}},{type:'keyDown',key:'w',control:true});
  assert.equal(prevented,true);assert.equal(w.destroyed,true);assert.equal(m.windows.size,0);
 }finally{m.destroy();}
});
