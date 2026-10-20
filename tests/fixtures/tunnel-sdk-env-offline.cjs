// Explicit offline SDK smoke, never imported by the ordinary test suite.
// node tests/fixtures/tunnel-sdk-env-offline.cjs /absolute/tunnel-client /absolute/manifest.json
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { processIdentity } = require('../../launcher/electron/update-recovery.cjs');

async function run(binary, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 12_000);
    child.stdout.on('data', bytes => { if (stdout.length < 128_000) stdout += bytes; });
    child.stderr.on('data', bytes => { if (stderr.length < 128_000) stderr += bytes; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  const [binaryInput, manifestInput] = process.argv.slice(2);
  assert(binaryInput && manifestInput && path.isAbsolute(binaryInput) && path.isAbsolute(manifestInput), 'Pass explicit binary and install-manifest paths');
  const binary = fs.realpathSync(binaryInput);
  const manifest = JSON.parse(fs.readFileSync(manifestInput, 'utf8'));
  assert.equal(manifest.tunnelClientVersion, '0.0.16');
  const binaryHash = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  assert.equal(binaryHash, manifest.binarySha256, 'Installed binary differs from its installation receipt');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-sdk-env-offline-'));
  const state = path.join(root, 'state'), profiles = path.join(root, 'profiles');
  fs.mkdirSync(state, { mode: 0o700 }); fs.mkdirSync(profiles, { mode: 0o700 });
  const nonce = crypto.randomBytes(8).toString('hex');
  const alias = `nekodex-offline-${nonce}`, profile = `fixture-${nonce}`;
  const tunnelId = `tunnel_${crypto.randomBytes(16).toString('hex')}`;
  const syntheticKey = `synthetic-offline-${crypto.randomBytes(24).toString('hex')}`;
  const variable = 'NEKODEX_OFFLINE_SYNTHETIC_RUNTIME_KEY';
  // Deliberately avoid inheriting proxy, API-key, telemetry or user profile variables.
  const env = { PATH: process.env.PATH || '', TMPDIR: root,
    TUNNEL_CLIENT_STATE_DIR: state, TUNNEL_CLIENT_PROFILE_DIR: profiles,
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'xdg-state'),
    NO_PROXY: '127.0.0.1,localhost,::1', [variable]: syntheticKey };
  if (process.platform === 'win32') for (const key of ['SystemRoot', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
  let polls = 0, authenticatedPolls = 0, afterConnectPolls = 0, connected = false;
  let owner, stopped = false, server;
  const requests = new Set();
  const processRecords = () => {
    const file = path.join(state, 'processes.yaml');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  };
  try {
    server = http.createServer(async (req, res) => {
      try {
      const target = new URL(req.url, 'http://127.0.0.1');
      requests.add(`${req.method} ${target.pathname}`);
      res.setHeader('content-type', 'application/json');
      if (target.pathname.endsWith('/poll')) {
        polls++; if (req.headers.authorization === `Bearer ${syntheticKey}`) authenticatedPolls++;
        if (connected) afterConnectPolls++;
        await pause(100);
        if (!res.destroyed) res.end(JSON.stringify({ commands: [] }));
        return;
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
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'inert-offline-fixture', version: '1' } }
          : message.method === 'tools/list' ? { tools: [] } : {};
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result })); return;
      }
      res.writeHead(target.pathname === '/mcp' ? 405 : 404); res.end('{}');
      } catch { if (!res.headersSent) res.writeHead(400); res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const version = await run(binary, ['--version'], env, root);
    assert.equal(version.code, 0); assert.match(version.stdout + version.stderr, /0\.0\.16/);
    const connect = await run(binary, ['runtimes', 'connect', '--alias', alias,
      '--tunnel-id', tunnelId, '--profile', profile, '--profile-dir', profiles,
      '--control-plane-base-url', origin, '--runtime-api-key', `env:${variable}`,
      '--mcp-server-url', `${origin}/mcp`, '--json'], env, root);
    const record = processRecords()[alias];
    if (record?.pid > 1) owner = { pid: record.pid, identity: processIdentity(record.pid) };
    const profileBytes = fs.readFileSync(path.join(profiles, `${profile}.yaml`), 'utf8');
    assert.equal(JSON.parse(profileBytes).control_plane.api_key, `env:${variable}`);
    assert(!profileBytes.includes(syntheticKey), 'SDK persisted the synthetic secret in its profile');
    assert(owner?.identity && alive(owner.pid), 'SDK did not leave a provable fixture process');
    // The control command has exited. A later authenticated poll proves the
    // independently running child retained the selected environment value.
    connected = true;
    const deadline = Date.now() + 3_000;
    while (!afterConnectPolls && Date.now() < deadline) await pause(50);
    assert(afterConnectPolls > 0 && polls === authenticatedPolls, 'Detached runtime did not inherit the synthetic credential');
    assert(!connect.timedOut, 'Managed connect timed out');
    assert.equal(connect.code, 0, `Managed connect failed: ${connect.stderr.replaceAll(syntheticKey, '[synthetic]')}`);
    const stop = await run(binary, ['runtimes', 'stop', alias, '--json'], env, root);
    const stopDeadline = Date.now() + 3_000;
    while (alive(owner.pid) && processIdentity(owner.pid) === owner.identity && Date.now() < stopDeadline) await pause(50);
    assert(!alive(owner.pid) || processIdentity(owner.pid) !== owner.identity, 'Fixture runtime did not stop');
    stopped = true;
    assert.equal(stop.code, 0, 'SDK fixture stop returned an error');
    for (const folder of [state, profiles]) for (const file of fs.readdirSync(folder, { recursive: true })) {
      const target = path.join(folder, file);
      if (fs.lstatSync(target).isFile()) assert(!fs.readFileSync(target).includes(Buffer.from(syntheticKey)), 'SDK persisted synthetic secret');
    }
    console.log(JSON.stringify({ result: 'passed', sdkVersion: '0.0.16', binarySha256: binaryHash,
      selectorOnlyProfile: true, authenticatedPolls, detachedPollAfterConnectExit: true,
      exactFixtureStopped: true, persistedSecret: false, requests: [...requests] }, null, 2));
  } finally {
    if (!owner) { const record = processRecords()[alias]; if (record?.pid > 1) owner = { pid: record.pid, identity: processIdentity(record.pid) }; }
    if (!stopped && owner?.identity && alive(owner.pid) && processIdentity(owner.pid) === owner.identity) {
      // Only the fixture's private persisted alias plus captured start identity
      // authorizes this signal; never enumerate or target unrelated SDK processes.
      process.kill(owner.pid, 'SIGTERM');
      const deadline = Date.now() + 3_000;
      while (alive(owner.pid) && processIdentity(owner.pid) === owner.identity && Date.now() < deadline) await pause(50);
      stopped = !alive(owner.pid) || processIdentity(owner.pid) !== owner.identity;
    }
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (owner && !stopped) console.error(`Preserving unresolved fixture state: ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
