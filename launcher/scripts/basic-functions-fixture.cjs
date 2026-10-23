'use strict';
// Inert, loopback-only manual UI fixture. No Electron, SSH or user-directory discovery.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createLocalWorkspaceService } = require('../electron/local-workspace.cjs');
const { createRemoteWorkspaceService } = require('../electron/remote-workspace.cjs');
const { createExternalUsageService } = require('../electron/external-usage.cjs');

async function createBasicFunctionsFixture() {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-basic-ui-')));
  const root = path.join(parent, 'disposable-files'), logs = path.join(parent, 'disposable-usage');
  fs.mkdirSync(root); fs.mkdirSync(logs);
  for (let i = 0; i < 305; i++) fs.writeFileSync(path.join(root, `inert-${String(i).padStart(3, '0')}.txt`), '');
  const local = createLocalWorkspaceService({ pickDirectory: async () => root, registryPath: path.join(parent, 'local.json') });
  const grant = await local.pickRoot();
  let sshAttempts = 0;
  const remote = createRemoteWorkspaceService({ storagePath: path.join(parent, 'remote', 'hosts.json'),
    spawnProcess: () => { sshAttempts++; throw new Error('SSH is disabled in this metadata-only fixture.'); } });
  const host = remote.addHost({ label: 'Inert SSH metadata', hostname: 'never-connect.invalid', username: 'fixture', port: 22, root: '/disposable' });
  const usage = createExternalUsageService({ statePath: path.join(parent, 'usage.json'), pickDirectory: async () => logs });
  fs.writeFileSync(path.join(logs, 'session.jsonl'), JSON.stringify({ type: 'assistant', sessionId: 'fixture', uuid: 'a', version: '2.1.0',
    message: { id: 'm', model: 'fixture', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n');
  const source = (await usage.selectRoot({ client: 'claude', accountPseudonym: 'original_fixture', scope: 'external-only', consent: true })).sources[0];
  await usage.request({ action: 'import', sourceId: source.id });
  const calls = [];
  const unavailable = () => ({ state: 'unavailable', reason: 'Git is outside this disposable basic-functions fixture.' });
  const methods = {
    workspaceRoots: () => local.listRoots(), workspacePick: () => local.pickRoot(),
    workspaceForget: id => local.forgetRoot(id), workspaceList: (id, p = '') => local.list(id, p),
    workspaceListPage: (id, p = '', cursor = null) => local.list(id, p, cursor),
    workspacePreview: (id, p) => local.preview(id, p), workspaceSave: (id, input) => local.save(id, input),
    workspaceDrafts: id => local.listDrafts(id), workspaceRetainDraft: (id, input) => local.retainDraft(id, input),
    workspaceDiscardDraft: (id, draftId) => local.discardDraft(id, draftId),
    workspaceManageRoot: id => { const selected = local.resolveGrant(id); calls.push({ method: 'file-manager-request', path: selected.path }); return { opened: true }; },
    workspaceGitBases: unavailable, workspaceGitReviewBases: unavailable, workspaceGitReviewListActions: () => [],
    workspaceWorktrees: () => [], workspaceSnapshots: () => [],
    terminalAvailability: () => ({ available: false, reason: 'Terminal is outside this fixture.' }),
    terminalList: () => [],
    remoteWorkspaceHosts: () => remote.listHosts(), remoteWorkspaceAddHost: input => remote.addHost(input),
    remoteWorkspaceDrafts: id => remote.listDrafts(id), remoteWorkspaceReceipts: id => remote.listReceipts(id),
    remoteWorkspaceForgetHost: id => remote.forgetHost(id),
    usageRequest: input => usage.request(input), usageSelectRoot: input => usage.selectRoot(input),
    fixtureSnapshot: () => ({ parent, root, grantId: grant.id, hostId: host.id, sourceId: source.id, sshAttempts,
      files: fs.readdirSync(root).map(name => { const stat = fs.lstatSync(path.join(root, name)); return { name, size: stat.size }; }),
      hosts: remote.listHosts(), usage: usage.snapshot(), calls: [...calls] }),
  };
  return { parent, root, methods, async invoke(method, args) {
    if (!Object.hasOwn(methods, method) || !Array.isArray(args) || args.length > 4) throw new Error('Unsupported fixture operation.');
    calls.push({ method, args }); return methods[method](...args);
  }, close() { remote.dispose(); fs.rmSync(parent, { recursive: true, force: true }); } };
}

async function start() {
  const { createServer } = await import('vite');
  const fixture = await createBasicFunctionsFixture();
  const token = randomBytes(32).toString('hex');
  const port = Number(process.env.BASIC_FIXTURE_PORT || 4192);
  let server;
  try { server = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port, strictPort: true, open: false },
    plugins: [{ name: 'inert-basic-functions-fixture', configureServer(vite) {
      vite.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (pathname === '/basic-fixture/') {
          response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
          response.end(await vite.transformIndexHtml('/basic-fixture/', `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Disposable basic functions fixture</title></head><body class="nk-root"><div id="root"></div><script>window.__basicFixtureToken=${JSON.stringify(token)}</script><script type="module" src="/scripts/basic-functions-fixture.tsx"></script></body></html>`)); return;
        }
        if (pathname !== '/__basic-fixture') return next();
        response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'POST' || request.headers['x-basic-fixture-token'] !== token || request.headers.origin !== `http://127.0.0.1:${port}`) { response.statusCode = 403; response.end('{"error":"Fixture request refused"}'); return; }
        try {
          let body = ''; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 512 * 1024) throw new Error('Fixture request too large.'); }
          const input = JSON.parse(body); const result = await fixture.invoke(input.method, input.args);
          response.end(JSON.stringify({ result }));
        } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: error.message })); }
      });
    } }],
  });
  await server.listen(); } catch (error) { await server?.close(); fixture.close(); throw error; }
  console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/basic-fixture/`, parent: fixture.parent, root: fixture.root }));
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await server.close(); fixture.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
module.exports = { createBasicFunctionsFixture };
if (require.main === module) start().catch(error => { console.error(error); process.exitCode = 1; });
