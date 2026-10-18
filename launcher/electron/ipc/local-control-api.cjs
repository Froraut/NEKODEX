const ACTIONS = new Set(['status', 'enable', 'disable', 'rotate', 'history-consent']);
function registerLocalControlApi({handle,runtimeHost,clipboard}) {
  handle('launcher:local-control-api',async(_event,body)=>{
    if(!body||!ACTIONS.has(body.action)||JSON.stringify(body).length>1024)throw new Error('Invalid local control API action');
    const supervisor=runtimeHost.supervisor,config=supervisor.readConfig();
    if(!await supervisor.ownedRuntimeReady(config))throw new Error('Start the current NEKODEX runtime to manage its local API');
    const receipt=await supervisor.control(config,'local-control-api',{body});
    if(!receipt||receipt.ok!==true)throw new Error('Local control API action failed');
    const value=receipt.value;
    // Consume the one-time secret in main. Renderer snapshots/logs never receive it.
    let tokenCopied=false;
    if(typeof value?.readToken==='string') {
      if(!/^nk-read-[a-f0-9]{64}$/.test(value.readToken))throw new Error('Local API returned an invalid credential');
      try {clipboard.writeText(value.readToken);tokenCopied=true;}
      catch {throw new Error('Credential was created but could not be copied. Use Rotate and copy to replace it; it cannot be recovered.');}
    }
    if(!value?.status||typeof value.status.enabled!=='boolean')throw new Error('Invalid local control API status');
    return {status:{...value.status,baseUrl:`http://127.0.0.1:${config.port}/api/v1`},tokenCopied};
  });
}
module.exports={registerLocalControlApi};
