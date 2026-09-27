// Opt-in local protocol check with an inert adapter; no provider inference or user profile.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config';
import { startServer } from '../src/server';
import { installClaudeIntegration, claudeSettingsPath } from '../src/claude-integration';
import { resolveThreadEnvironment } from '../src/adapters/chatgpt-web/thread-environment-resolver';
import { TurnBroker } from '../src/adapters/chatgpt-web/turn-broker';

const client=process.env.CLAUDE_CLIENT_TEST_EXECUTABLE;
if (!client) throw new Error('Set CLAUDE_CLIENT_TEST_EXECUTABLE to the installed official Claude CLI');
const directory=mkdtempSync(join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'nekodex-claude-client-'));
process.env.CODEX_CHATGPT_WEB_HOME=join(directory,'bridge');
process.env.CODEX_HOME=join(directory,'codex');
process.env.CLAUDE_CONFIG_DIR=join(directory,'claude');
mkdirSync(process.env.CODEX_HOME,{recursive:true});
const workspace=join(directory,'workspace');mkdirSync(workspace);
const fixturePath=join(workspace,'fixture.txt');writeFileSync(fixturePath,'LOCAL_FIXTURE_READ_629\n');
const config=defaultConfig('full');config.browserHost='managed-chrome';config.port=0;
let toolRound=false, requests=0;
const server=startServer(config,{adapterFactory:()=>({name:'inert-client-fixture',async runTurn(parsed,context,emit){
  requests++;
  if(parsed._clientContext?.producer!=='claude')throw new Error('Missing Claude producer identity');
  const environment=resolveThreadEnvironment(parsed,{} as any).environment;
  if(environment.writableRoots.length || environment.sandboxPolicy.type!=='readOnly')throw new Error('External client gained filesystem authority');
  const result=parsed.context.messages.find(message=>message.role==='toolResult');
  if(toolRound && !result){
    emit({type:'tool_call_start',id:'call_read_fixture',name:'Read'});
    emit({type:'tool_call_delta',arguments:JSON.stringify({file_path:fixturePath})});
    emit({type:'tool_call_end'});emit({type:'done',stopReason:'tool_use',endTurn:false});
  }else{
    if(toolRound && !JSON.stringify(result).includes('LOCAL_FIXTURE_READ_629'))throw new Error('Real client did not return fixture content');
    emit({type:'text_delta',text:toolRound?'CLAUDE_GATEWAY_TOOL_OK':'CLAUDE_GATEWAY_TEXT_OK'});
    emit({type:'done',stopReason:'stop',endTurn:true,usage:{inputTokens:20,outputTokens:8,totalTokens:28,estimated:true}});
  }
}})});
config.port=server.port!;
try{
  installClaudeIntegration(config);
  for(const useTool of [false,true]){
    toolRound=useTool;
    const args=[client,'--bare','--print','--no-session-persistence','--output-format','json','--settings',claudeSettingsPath(),
      '--system-prompt','This is an isolated local protocol fixture. Follow the user request.','--tools',useTool?'Read':'',
      ...(useTool?['--allowedTools','Read']:[]),'--permission-mode','dontAsk',useTool?'Read fixture.txt then report its receipt.':'Reply with the requested marker.'];
    const child=Bun.spawn(args,{cwd:workspace,env:{...process.env,DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',NO_COLOR:'1',CLAUDE_CODE_OAUTH_TOKEN:''},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
    const timer=setTimeout(()=>child.kill('SIGTERM'),25_000);
    const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timer);
    if(code!==0)throw new Error(`Client exited ${code}: ${err.slice(0,1600)} ${out.slice(0,1600)}`);
    const expected=useTool?'CLAUDE_GATEWAY_TOOL_OK':'CLAUDE_GATEWAY_TEXT_OK';
    if(!out.includes(expected))throw new Error(`Client output missing marker: ${out.slice(0,1600)}`);
    console.log(useTool?'REAL_CLAUDE_CLIENT_TOOL_CYCLE_OK':'REAL_CLAUDE_CLIENT_MESSAGES_STREAM_OK');
  }
  console.log('requests',requests);
}finally{
  await server.stop(true);await TurnBroker.forSocket(config.brokerSocketPath).close();rmSync(directory,{recursive:true,force:true});
}
