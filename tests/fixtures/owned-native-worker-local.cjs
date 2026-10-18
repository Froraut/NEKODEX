'use strict';
// Opt-in ONE local-fake Responses proof. No real account/profile/model.
// node tests/fixtures/owned-native-worker-local.cjs /absolute/executable [--owned-wrapper]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { PassThrough } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');
const { createOwnedNativeWorkerService } = require('../../launcher/electron/owned-native-worker.cjs');
const { digest, fileDigest, makeAdmission, canonical } = require('../../launcher/electron/owned-native-admission.cjs');
const catalog = require('./owned-native-model.cjs');
const Ajv = require('ajv'); // Fixture dependency only; Electron leaf has no Ajv/package dependency.
const executable = process.argv[2];
const ownedWrapper = process.argv[3] === '--owned-wrapper';
assert(process.argv.length <= 4 && (process.argv[3] === undefined || ownedWrapper), 'Unsupported fixture variant');
assert.equal(process.platform, 'darwin', 'Owned Native worker contract is Mac-first');
assert(executable && path.isAbsolute(executable), 'Provide the exact reviewed executable');
let executableAdmission;
if (ownedWrapper) {
  // Test-only input capture from the just-built, reviewed DEV artifact. Product
  // main must supply its independent fixed build pins; renderer cannot select it.
  const sourceRoot = fs.realpathSync(path.resolve(__dirname, '../../launcher/native/owned-worker'));
  const target = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
  const metadataPath = path.join(sourceRoot, 'build', target, 'build-info.json');
  const bytes = fs.readFileSync(metadataPath), metadata = JSON.parse(bytes);
  executableAdmission = { executableVariant: 'owned-wrapper', executableSha256: metadata.sha256,
    wrapperBuildPin: { sourceRoot, metadataPath, metadataSha256: digest(bytes),
      sourcePinSha256: fileDigest(path.join(sourceRoot, 'source-pin.json'), 16384) } };
} else executableAdmission = { executableSha256: fileDigest(executable) };
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-owned-native-local-')));
let owner, child, childClosed = false, launches = 0, turnOffers = 0, droppedAck = false;
const requests = [], receipts = [], faults = [];
let diagnostics = '';
let effectiveSummary = null;
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const server = http.createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses');
    assert.equal(request.headers.authorization, 'Bearer nekodex-dummy-fixture-auth');
    let bytes = 0; const chunks = [];
    for await (const chunk of request) { bytes += chunk.length; assert(bytes <= 1024 * 1024); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks)); requests.push(body);
    assert.equal(body.model, catalog.modelId); assert.deepEqual(body.tools, []);
    assert.equal(request.headers['content-encoding'], undefined);
    if (requests.length === 1) assert.deepEqual(body.text?.format?.schema, schema);
    assert(requests.length <= 3, 'No automatic retry/extra provider request is allowed by this fixture');
    const id = `resp_fixture_${requests.length}`, messageId = `msg_fixture_${requests.length}`;
    const text = requests.length === 1 ? '{"answer":"local first"}' : `local continuation ${requests.length}`;
    // Official pinned core/tests/common/responses.rs ev_* shape (L753–830).
    const events = [{ type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item: { type: 'message', role: 'assistant', id: messageId,
        phase: 'final_answer', content: [{ type: 'output_text', text }] } },
      { type: 'response.completed', response: { id, usage: { input_tokens: 7, output_tokens: 3,
        total_tokens: 10, input_tokens_details: null, output_tokens_details: null } } }];
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  } catch (reason) {
    faults.push(reason.message); response.writeHead(400, { 'content-type': 'application/json' });
    response.end('{"error":{"message":"Local fixture assertion failed","type":"invalid_request_error"}}');
  }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const shared = { executable, ...executableAdmission,
      authorityHome: path.join(root, 'authority'), catalog: { ...catalog, sha256: digest(catalog.json) },
      route: { kind: 'local-fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1` } };
    const expected = makeAdmission(shared).config;
    owner = createOwnedNativeWorkerService({ ...shared,
      requestTimeoutMs: 5000, terminalTimeoutMs: 15_000, stopGraceMs: 1000,
      compileOutputSchema: schema => new Ajv({ strict: true, allErrors: false }).compile(schema),
      onReceipt: receipt => receipts.push(receipt),
      testHooks: { observeEffective(read, requirements) {
        effectiveSummary = { differingFields: Object.keys(expected).filter(key => canonical(expected[key]) !== canonical(read.config?.[key])),
          features: read.config?.features,
          layerTypes: read.layers?.map(layer => ({ type: layer.name?.type, keys: Object.keys(layer.config || {}), disabled: layer.disabledReason !== null })),
          requirementKeys: Object.entries(requirements.requirements || {}).filter(([, value]) => value !== null).map(([key]) => key) };
      }, spawnProcess(binary, args, options) {
        assert.deepEqual(args, ownedWrapper ? ['--stdio'] : ['app-server', '--stdio', '--strict-config']);
        launches++; assert.equal(launches, 1); child = spawn(binary, args, options);
        child.stderr.on('data', chunk => { if (diagnostics.length < 8192) diagnostics += chunk.toString().slice(0, 8192 - diagnostics.length); });
        child.once('close', () => { childClosed = true; });
        // Deterministic lost ACK of the third real turn. No extra sender/transport/CLI.
        const write = child.stdin.write.bind(child.stdin), lost = new Set();
        child.stdin.write = (chunk, ...rest) => {
          const message = JSON.parse(String(chunk));
          if (message.method === 'turn/start' && ++turnOffers === 3) lost.add(message.id);
          return write(chunk, ...rest);
        };
        const raw = child.stdout, projected = new PassThrough(), decoder = new StringDecoder('utf8');
        let buffer = '';
        raw.on('data', chunk => {
          buffer += decoder.write(chunk); assert(Buffer.byteLength(buffer) <= 2 * 1024 * 1024);
          for (;;) {
            const newline = buffer.indexOf('\n'); if (newline < 0) break;
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            if (!line.trim()) continue;
            const message = JSON.parse(line);
            if (lost.has(message.id) && Object.hasOwn(message, 'result')) { droppedAck = true; continue; }
            projected.write(`${line}\n`);
          }
        });
        raw.on('end', () => projected.end()); raw.on('error', reason => projected.destroy(reason));
        child.stdout = projected; return child;
      } },
    });
    assert.equal(owner.inspectOwnedWorker().state, 'disconnected');
    assert(!fs.existsSync(path.join(root, 'authority')), 'Passive inspection must not create a profile');
    const worker = await owner.createOwnedWorker({ actionId: randomUUID() });
    const first = await owner.offerOwnedTurn({ workerHandle: worker.workerHandle, actionId: randomUUID(),
      text: 'Automatic local contract request one.', outputSchema: schema });
    assert.deepEqual(faults, []); assert.equal(first.state, 'completed');
    assert.deepEqual(first.structuredOutput, { answer: 'local first' });
    assert(first.canonicalItems.some(item => item.role === 'user' && item.authorship === 'automatic-host'));
    assert(first.canonicalItems.some(item => item.role === 'assistant' && item.text === '{"answer":"local first"}'));
    assert(first.canonicalItems.every(item => item.messageId && item.turnId === first.turnId && Number.isSafeInteger(item.timestampMs)));
    const second = await owner.offerOwnedTurn({ workerHandle: worker.workerHandle, actionId: randomUUID(),
      text: 'Automatic local continuation two.' });
    assert.equal(second.state, 'completed'); assert.equal(second.threadId, first.threadId);
    assert.notEqual(second.turnId, first.turnId); assert.equal(launches, 1);
    assert.equal(second.canonicalItems.at(-1).text, 'local continuation 2');
    const unknownId = randomUUID();
    const third = await owner.offerOwnedTurn({ workerHandle: worker.workerHandle, actionId: unknownId,
      text: 'Automatic local receipt loss three.' });
    assert.equal(third.state, 'unknown'); assert.equal(third.turnId, null); assert(droppedAck);
    assert.equal(third.ownerHeld, true);
    await assert.rejects(owner.offerOwnedTurn({ workerHandle: worker.workerHandle, actionId: unknownId,
      text: 'Do not replay.' }));
    assert.equal(requests.length, 3); assert.equal(turnOffers, 3); assert.deepEqual(faults, []);
    assert(receipts.some(receipt => receipt.state === 'acknowledged' && receipt.turnId === first.turnId));
    console.log(JSON.stringify({ proof: ownedWrapper ? 'owned-wrapper-0.163-local-fake-only' : 'stock-cli-0.163-local-fake-only', realOpenAI: false, realAccountAuth: false,
      toolsExactlyEmpty: requests.every(request => Array.isArray(request.tools) && request.tools.length === 0),
      canonicalMessages: first.canonicalItems.length + second.canonicalItems.length, nativeTimestamps: true,
      sameThreadContinuation: true, ownedChildCount: launches, providerRequests: requests.length,
      unknownWithoutReplay: third.state === 'unknown', structuredOutput: first.structuredOutput,
      nativeUsage: first.usage }));
  } finally {
    await owner?.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    assert(!fs.existsSync(root)); assert(!child || childClosed);
    console.log(JSON.stringify({ ownedChildClosed: !child || childClosed, listenerClosed: !server.listening,
      privateStateRemoved: true }));
  }
}
main().catch(reason => { console.error(JSON.stringify({ code: reason.code || 'fixture_failed', message: reason.message,
  field: reason.field, providerRequests: requests.length, faults,
  effectiveSummary, diagnostics: diagnostics.replaceAll(root, '$FIXTURE').replaceAll(executable, '$CODEX') })); process.exitCode = 1; });
