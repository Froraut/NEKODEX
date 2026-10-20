// Opt-in installed-protocol fixture. No credentials, real thread, turn/start or model request.
// node tests/fixtures/codex-client-control-offline.cjs /absolute/path/to/codex [--canonical-only]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { createCodexClientControl } = require('../../launcher/electron/codex-client-control.cjs');

const executable = process.argv[2];
assert(executable && path.isAbsolute(executable), 'Provide an absolute installed Codex executable');
const canonicalOnly = process.argv[3] === '--canonical-only';
assert(process.argv[3] === undefined || canonicalOnly, 'Unsupported fixture mode');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-client-control-offline-')));
const home = path.join(root, 'codex');
fs.mkdirSync(home);
fs.writeFileSync(path.join(home, 'config.toml'), `model = "offline-fixture"
model_provider = "offline_fixture"
approval_policy = "never"
sandbox_mode = "read-only"
[model_providers.offline_fixture]
name = "Offline fixture"
base_url = "http://127.0.0.1:9/v1"
wire_api = "responses"
[analytics]
enabled = false
`);
const environment = { PATH: process.env.PATH, HOME: root, CODEX_HOME: home,
  HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' };
let child, port, stopped = true, creatorClosed;
const pending = new Map();

async function stopCreator() {
  if (!child || stopped) return;
  child.stdin.end();
  const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
  try { await creatorClosed; } finally { clearTimeout(kill); }
}
async function main() {
  try {
    child = spawn(executable, ['app-server', '--stdio'], { cwd: root, env: environment,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    stopped = false;
    child.stderr.on('data', () => {});
    creatorClosed = new Promise(resolve => child.once('close', () => {
      stopped = true;
      for (const waiting of pending.values()) waiting.reject(new Error('Fixture creator closed'));
      pending.clear(); resolve();
    }));
    child.on('error', () => {
      for (const waiting of pending.values()) waiting.reject(new Error('Fixture creator failed to start'));
    });
    child.stdin.on('error', () => {});
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      const message = JSON.parse(line), waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(Object.assign(new Error('Fixture RPC rejected'), { rpcCode: message.error.code }));
      else waiting.resolve(message.result);
    });
    let nextId = 1;
    const request = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id); reject(new Error('Fixture RPC timed out'));
      }, 10_000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
        reject: reason => { clearTimeout(timer); reject(reason); } });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    const init = await request('initialize', { clientInfo: { name: 'nekodex-offline-fixture', title: null, version: '1' },
      capabilities: { experimentalApi: false, requestAttestation: false } });
    assert.equal(init.codexHome, home);
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    const start = await request('thread/start', { cwd: root });
    assert.equal(start.thread.status.type, 'idle');
    if (canonicalOnly) {
      const expected = ['DW5 inert offline user text.', 'DW5 inert offline assistant text.'];
      await request('thread/inject_items', { threadId: start.thread.id, items: [
        { type: 'message', id: 'dw5-offline-user', role: 'user',
          content: [{ type: 'input_text', text: expected[0] }] },
        { type: 'message', id: 'dw5-offline-assistant', role: 'assistant', phase: 'final_answer',
          content: [{ type: 'output_text', text: expected[1] }] },
      ] });
      await stopCreator(); lines.close();
      port = createCodexClientControl({ executable, codexHome: home, cwd: root, environment, requestTimeoutMs: 10_000 });
      let canonical;
      try { canonical = await port.readThreadConversation(start.thread.id); }
      catch (reason) {
        console.log(JSON.stringify({ mode: 'canonical-only', canonicalProducer: reason.rpcCode === -32601
          ? 'unsupported-method' : 'unavailable', errorCode: reason.code, rpcCode: reason.rpcCode,
        modelTurnStarted: false }));
        process.exitCode = 2; return;
      }
      console.log(JSON.stringify({ mode: 'canonical-only', installedProtocol: port.snapshot().userAgent,
        threadIdMatches: canonical.threadId === start.thread.id, messages: canonical.messages,
        complete: canonical.complete, nextCursor: canonical.nextCursor, excludedItems: canonical.excludedItems,
        modelTurnStarted: false }));
      assert.equal(canonical.threadId, start.thread.id);
      if (!canonical.messages.length) {
        console.log(JSON.stringify({ canonicalProducer: 'unavailable-from-injected-history',
          itemsEndpoint: 'supported-empty-page',
          reason: 'thread/inject_items materializes model-visible history without canonical visible thread items; no fallback or turn was started' }));
        process.exitCode = 2; return;
      }
      assert.deepEqual(canonical.messages.map(message => message.text), expected);
      assert.deepEqual(canonical.messages.map(message => message.role), ['user', 'assistant']);
      assert(canonical.messages.every(message => message.messageId && message.turnId && message.compactionId === null));
      assert(canonical.messages.every(message => message.timestampMs === null || Number.isSafeInteger(message.timestampMs)));
      return;
    }
    // Empty, unmaterialized threads have no rollout to fork. This is a known API rejection.
    await assert.rejects(request('thread/fork', { threadId: start.thread.id, excludeTurns: true }),
      reason => reason.rpcCode === -32600);
    // This materializes fixture history without executing a turn, tools, or a model.
    await request('thread/inject_items', { threadId: start.thread.id, items: [{ type: 'message', role: 'user',
      content: [{ type: 'input_text', text: 'Inert offline fixture history. No turn is started.' }] }] });
    await stopCreator(); lines.close();
    port = createCodexClientControl({ executable, codexHome: home, journalPath: path.join(root, 'private', 'forks.json'),
      cwd: root, environment, requestTimeoutMs: 10_000 });
    const page = await port.listThreads();
    assert(Array.isArray(page.data));
    const read = await port.readThread(start.thread.id);
    assert.equal(read.thread.id, start.thread.id);
    assert.equal(read.thread.status.type, 'notLoaded');
    assert(!Object.hasOwn(read.thread, 'turns'));
    const fork = await port.forkThread({ threadId: start.thread.id, userInitiated: true });
    assert.notEqual(fork.thread.id, start.thread.id);
    assert.equal(fork.thread.forkedFromId, start.thread.id);
    assert.equal(fork.thread.status.type, 'idle');
    console.log(JSON.stringify({ installedProtocol: port.snapshot().userAgent, initialize: 'passed',
      emptyForkRejected: true, metadataRead: 'passed', forkReceipt: 'passed',
      listCount: page.data.length, statusScope: page.statusScope, modelTurnStarted: false }));
  } finally {
    if (port) await port.destroy();
    await stopCreator();
    fs.rmSync(root, { recursive: true, force: true });
    assert(!fs.existsSync(root));
    console.log(JSON.stringify({ creatorClosed: stopped, clientClosed: port?.snapshot().state === 'closed', stateRemoved: true }));
  }
}
main().catch(reason => { console.error(reason.message); process.exitCode = 1; });
