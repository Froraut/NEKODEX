// Explicit inert UI migration environment; does not launch Electron or SDK peers.
// Keep this process running while the root drives a real isolated --dev-profile UI.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { validateConfig } = require('../../launcher/electron/runtime-config-contract.cjs');
let activeServer;

async function main() {
  const repository = path.resolve(__dirname, '../..');
  const realSDK = process.argv[2];
  const bun = process.argv[3];
  assert(realSDK && bun && path.isAbsolute(realSDK) && path.isAbsolute(bun), 'Usage: node credential-ui-environment.cjs /absolute/sdk /absolute/bun');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-credential-ui-'));
  const coreHome = path.join(root, 'dev-home');
  const state = path.join(root, 'sdk-state');
  const profileDir = path.join(root, 'sdk-profiles');
  for (const folder of [coreHome, state, profileDir, path.join(coreHome, 'runtime'), path.join(coreHome, 'launcher'), path.join(coreHome, 'bin')]) fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const nonce = crypto.randomBytes(8).toString('hex');
  const alias = `nekodex-ui-${nonce}`, profileName = `fixture-${nonce}`;
  const tunnelId = `tunnel_${crypto.randomBytes(16).toString('hex')}`;
  const syntheticKey = `synthetic-ui-${crypto.randomBytes(24).toString('hex')}`;
  const keyFile = path.join(coreHome, 'legacy-synthetic.key');
  fs.writeFileSync(keyFile, syntheticKey, { mode: 0o600 });
  let polls = 0, authenticatedPolls = 0;
  const requests = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const target = new URL(req.url, 'http://127.0.0.1');
      requests.add(`${req.method} ${target.pathname}`);
      res.setHeader('content-type', 'application/json');
      if (target.pathname === '/fixture/status') {
        res.end(JSON.stringify({ fixture: 'credential-ui', polls, authenticatedPolls, requests: [...requests] })); return;
      }
      if (target.pathname.endsWith('/poll')) {
        polls++; if (req.headers.authorization === `Bearer ${syntheticKey}`) authenticatedPolls++;
        setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ commands: [] })); }, 150); return;
      }
      if (target.pathname === `/v1/tunnels/${tunnelId}`) {
        res.end(JSON.stringify({ id: tunnelId, name: alias, organization_ids: [], workspace_ids: [] })); return;
      }
      if (target.pathname === '/mcp' && req.method === 'POST') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) { res.writeHead(413); res.end('{}'); return; } }
        if (!raw.trim()) { res.writeHead(405); res.end('{}'); return; }
        const message = JSON.parse(raw);
        if (message.id === undefined) { res.writeHead(202); res.end('{}'); return; }
        const result = message.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'inert-ui-fixture', version: '1' } }
          : message.method === 'tools/list' ? { tools: [] } : {};
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })); return;
      }
      res.writeHead(target.pathname === '/mcp' ? 405 : 404); res.end('{}');
    } catch { if (!res.headersSent) res.writeHead(400); res.end('{}'); }
  });
  activeServer = server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const wrapper = path.join(coreHome, 'bin', 'tunnel-client-ui-fixture');
  const wrapperSource = `#!${process.execPath}
const fs=require('node:fs'), {spawn}=require('node:child_process');
const args=process.argv.slice(2);
function remove(flag){const i=args.indexOf(flag);if(i>=0)args.splice(i,2);}
if(args[0]==='runtimes'&&args[1]==='connect'){
 remove('--mcp-command');remove('--mcp-server-url');remove('--control-plane-base-url');remove('--tunnel-client-bin');
 args.push('--control-plane-base-url',${JSON.stringify(origin)},'--mcp-server-url',${JSON.stringify(origin + '/mcp')},'--tunnel-client-bin',${JSON.stringify(realSDK)});
}
fs.appendFileSync(${JSON.stringify(path.join(root, 'sdk-commands.jsonl'))},JSON.stringify({at:new Date().toISOString(),args})+'\\n',{mode:0o600});
const env={PATH:process.env.PATH||'',TMPDIR:${JSON.stringify(root)},TUNNEL_CLIENT_STATE_DIR:${JSON.stringify(state)},TUNNEL_CLIENT_PROFILE_DIR:${JSON.stringify(profileDir)},XDG_CONFIG_HOME:${JSON.stringify(path.join(root, 'config'))},XDG_STATE_HOME:${JSON.stringify(path.join(root, 'xdg-state'))},NO_PROXY:'127.0.0.1,localhost,::1'};
if(process.env.NEKODEX_TUNNEL_RUNTIME_KEY)env.NEKODEX_TUNNEL_RUNTIME_KEY=process.env.NEKODEX_TUNNEL_RUNTIME_KEY;
if(process.env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION)env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION=process.env.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION;
const child=spawn(${JSON.stringify(realSDK)},args,{env,stdio:'inherit',windowsHide:true});
process.once('SIGTERM',()=>child.kill('SIGTERM'));process.once('SIGINT',()=>child.kill('SIGINT'));
child.once('error',()=>{process.exitCode=1});child.once('exit',(code)=>{process.exitCode=code??1});
`;
  fs.writeFileSync(wrapper, wrapperSource, { mode: 0o700 });
  const defaultsScript = path.join(root, 'runtime-defaults.ts');
  fs.writeFileSync(defaultsScript, `import{defaultConfig}from ${JSON.stringify(path.join(repository, 'src/config.ts'))};console.log(JSON.stringify(defaultConfig('full')))`);
  const defaults = spawnSync(bun, [defaultsScript],
    { cwd: repository, env: { ...process.env, CODEX_CHATGPT_WEB_HOME: coreHome }, encoding: 'utf8', timeout: 10_000 });
  if (defaults.status !== 0) throw new Error(`Cannot derive current runtime defaults: ${defaults.stderr}`);
  const config = JSON.parse(defaults.stdout);
  const descriptor = path.join(coreHome, 'runtime', 'launcher-browser.json');
  const tunnel = { binaryPath: wrapper, tunnelId, runtimeKeyFile: keyFile, profileDir, profileName, alias };
  Object.assign(config, { purpose: 'dev-harness', browserHost: 'launcher', browserHostDescriptorPath: descriptor,
    appName: 'Codex Native6 DEV', automaticAppName: 'Codex Native6 DEV', manualAppName: 'Codex Zero Risk4',
    runtimeCommand: [bun, 'run', path.join(repository, 'src/cli.ts')], experimentalAsyncToolOperations: true,
    accountTunnelMode: true, accountTunnels: [{ accountId: 'default', interactionMode: 'automatic', tunnel }],
    tunnel, automaticTunnel: tunnel });
  validateConfig(config, descriptor, process.platform, 'development');
  fs.writeFileSync(path.join(coreHome, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(coreHome, 'account-registry.json'), JSON.stringify({ accounts: [{ id: 'default', label: 'Synthetic migration fixture', enabled: true }], selectedId: 'default', mode: 'selected' }), { mode: 0o600 });
  fs.writeFileSync(path.join(coreHome, 'launcher', 'launcher-state.json'), JSON.stringify({ version: 1, language: 'en', onboardingComplete: true,
    browserInteractionMode: 'automatic', experimentalAsyncToolOperations: true, autoStart: false,
    keepRunningOnClose: false, appearance: 'dark' }), { mode: 0o600 });
  const receipt = { fixtureRoot: root, fixtureServerPid: process.pid, coreHome, origin, alias, tunnelId,
    legacyKeyPath: keyFile, sdkState: state, sdkProfiles: profileDir, sdkWrapper: wrapper,
    configPath: path.join(coreHome, 'config.json'), descriptor,
    launchEnvironment: { CODEX_WEB_GPT_DEV_HOME: coreHome, CODEX_WEB_GPT_BUN: bun, CODEX_CHATGPT_WEB_BUN: bun },
    launchArguments: [path.join(repository, 'launcher'), '--dev-profile'],
    statusUrl: `${origin}/fixture/status`, cleanup: 'Quit exact fixture Electron first; stop any remaining exact SDK fixture alias via wrapper; then stop this server and remove this fixtureRoot. Remove only its created credential reference using the provider owner.' };
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...receipt, receiptPath: path.join(root, 'fixture.json') }, null, 2));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.closeAllConnections(); server.close(() => { console.log('Fixture loopback server stopped; temporary state retained for owner cleanup.'); });
  });
}
main().catch(error => { console.error(error.message); activeServer?.closeAllConnections(); activeServer?.close(); process.exitCode = 1; });
