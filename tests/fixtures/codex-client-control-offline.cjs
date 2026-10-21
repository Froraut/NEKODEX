// Opt-in installed-protocol fixture. No credentials or real thread. Only `--handoff` sends one
// turn, to an unreachable loopback provider, so no model request can leave the machine.
// node tests/fixtures/codex-client-control-offline.cjs /absolute/path/to/codex [--canonical-only|--handoff]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { createCodexClientControl } = require('../../launcher/electron/codex-client-control.cjs');
const { createCodexThreadHandoff } = require('../../launcher/electron/codex-thread-handoff.cjs');

const executable = process.argv[2];
assert(executable && path.isAbsolute(executable), 'Provide an absolute installed Codex executable');
const canonicalOnly = process.argv[3] === '--canonical-only';
const handoffMode = process.argv[3] === '--handoff';
assert(process.argv[3] === undefined || canonicalOnly || handoffMode, 'Unsupported fixture mode');
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
request_max_retries = 0
stream_max_retries = 0
[analytics]
enabled = false
`);
const environment = { PATH: process.env.PATH, HOME: root, CODEX_HOME: home,
  HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9' };
let child, port, handoff, stopped = true, creatorClosed;
const pending = new Map();

async function stopCreator() {
  if (!child || stopped) return;
  child.stdin.end();
  const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
  try { await creatorClosed; } finally { clearTimeout(kill); }
}
/** A separate official process resumes the thread: succeeds only if no other writer holds it. */
async function resumeInFreshProcess(threadId) {
  const other = spawn(executable, ['app-server', '--stdio'], { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  other.stderr.on('data', () => {}); other.stdin.on('error', () => {});
  const closed = new Promise(resolve => other.once('close', resolve));
  const replies = new Map();
  createInterface({ input: other.stdout }).on('line', line => {
    const message = JSON.parse(line); if (message.id !== undefined && !message.method) replies.get(message.id)?.(message);
  });
  const call = (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fresh resume timed out')), 30_000);
    replies.set(id, message => { clearTimeout(timer); resolve(message); });
    other.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  try {
    await call(1, 'initialize', { clientInfo: { name: 'nekodex-offline-fixture', title: null, version: '1' },
      capabilities: { experimentalApi: false, requestAttestation: false } });
    other.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    const resumed = await call(2, 'thread/resume', { threadId, excludeTurns: true });
    return !resumed.error && resumed.result?.thread?.id === threadId;
  } finally {
    other.stdin.end();
    const kill = setTimeout(() => other.kill('SIGKILL'), 5000);
    await closed; clearTimeout(kill);
  }
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
    if (handoffMode) {
      // The creator still owns the loaded thread: Codex's writer lock must refuse a second process.
      handoff = createCodexThreadHandoff({ executable, codexHome: home, cwd: root, environment,
        journalPath: path.join(root, 'private', 'handoffs.json'), requestTimeoutMs: 30_000, turnTimeoutMs: 20_000 });
      const refused = await handoff.continueThread({ threadId: start.thread.id, text: 'Owned elsewhere', userInitiated: true })
        .then(() => null, reason => reason);
      assert.equal(refused?.code, 'handoff_owner_active');
      await stopCreator(); lines.close();
      const receipt = await handoff.continueThread({ threadId: start.thread.id, text: 'Offline handoff turn', userInitiated: true });
      assert.equal(receipt.released, true);
      assert.equal(receipt.threadId, start.thread.id);
      // Released: another official process can now become the writer.
      const nextOwnerResumed = await resumeInFreshProcess(start.thread.id);
      assert.equal(nextOwnerResumed, true);
      port = createCodexClientControl({ executable, codexHome: home, cwd: root, environment, requestTimeoutMs: 10_000 });
      const after = await port.readThread(start.thread.id);
      console.log(JSON.stringify({ mode: 'handoff', installedProtocol: port.snapshot().userAgent,
        ownerActiveRefused: true, acquiredAfterRelease: true, turnStatus: receipt.turnStatus,
        approvalsRefused: receipt.approvalsRefused, released: receipt.released, nextOwnerResumed, statusAfterRelease: after.thread.status.type,
        uncertainHandoffs: handoff.snapshot().uncertainHandoffs.length, providerReachable: false }));
      return;
    }
    // Stored attachments are copied by a non-ephemeral fork; observe parity by identity.
    await request('thread/attachment/add', { threadId: start.thread.id, attachmentType: 'pull_request',
      identityKey: JSON.stringify(['github.com', 'fixture', 'offline', 1]), payload: { fixture: true } });
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
      emptyForkRejected: true, metadataRead: 'passed', forkReceipt: 'passed', attachments: fork.attachments,
      listCount: page.data.length, statusScope: page.statusScope, modelTurnStarted: false }));
  } finally {
    if (port) await port.destroy();
    if (handoff) await handoff.destroy();
    await stopCreator();
    fs.rmSync(root, { recursive: true, force: true });
    assert(!fs.existsSync(root));
    console.log(JSON.stringify({ creatorClosed: stopped, clientClosed: port?.snapshot().state === 'closed', stateRemoved: true }));
  }
}
main().catch(reason => { console.error(reason.message); process.exitCode = 1; });
