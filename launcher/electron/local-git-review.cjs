'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { chain, assertChain } = require('./workspace-file-capture.cjs');
const { createRemoteGitReviewController, validateRemoteGitReviewRecords, REMOTE_GIT_REVIEW_LIMITS } = require('./remote-git-review.cjs');
const { REMOTE_GIT_REVIEW_HELPER } = require('./remote-git-review-helper.cjs');

function fail(code, message) { throw Object.assign(new Error(message), { code, actionRecorded: false }); }
const hash = value => createHash('sha256').update(value).digest('hex');

/** Fixed local transport for the same exact-index/CAS transaction protocol as SSH Git Review. */
function runLocalGitReviewHelper(scope, action, payload) {
  if (!['darwin', 'linux'].includes(process.platform)) {
    fail('LOCAL_GIT_UNSUPPORTED', 'Local Git mutations require the macOS/Linux transaction adapter. This platform is not supported yet.');
  }
  const python = ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3'].find(value => {
    try { return fs.statSync(value).isFile(); } catch { return false; }
  });
  if (!python || !fs.existsSync('/usr/bin/git')) fail('LOCAL_GIT_RUNTIME_UNAVAILABLE', 'Local Git Review requires Python 3 and /usr/bin/git. Its runtime is unavailable.');
  const input = JSON.stringify({ root: scope.root, scope, action, payload }) + '\n';
  if (Buffer.byteLength(input) > 2 * 1024 * 1024) fail('LOCAL_GIT_REQUEST_LIMIT', 'The local review exceeds its supported boundary.');
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-S', '-c', REMOTE_GIT_REVIEW_HELPER], {
      cwd: scope.root, shell: false, windowsHide: true,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = []; let bytes = 0; let overflow = false;
    // The fixed helper bounds its reads; an accepted mutation owns the process until physical exit.
    // Exceeding the response boundary discards output, never kills an in-flight repository mutation.
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 1024 * 1024) overflow = true; else chunks.push(chunk); });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', () => reject(Object.assign(new Error('Local Git Review could not start its fixed runtime.'), { code: 'LOCAL_GIT_RUNTIME_UNAVAILABLE', actionRecorded: false })));
    child.once('close', code => {
      if (code !== 0 || overflow) { reject(Object.assign(new Error('Local Git has no bounded terminal response. Inspect the retained exact action without replay.'), { code: 'LOCAL_GIT_UNKNOWN' })); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Local Git has no valid terminal response. Inspect the retained exact action without replay.'), { code: 'LOCAL_GIT_UNKNOWN' })); }
    });
    child.stdin.end(input);
  });
}

function local(value) {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(local);
  const { hostId, target, ...rest } = value;
  if (typeof rest.reason === 'string') rest.reason = rest.reason.replace(/\bRemote\b/g, 'Local').replace(/\bremote\b/g, 'local');
  return { ...rest, ...(hostId ? { workspaceId: hostId } : {}), ...(target ? {
    workspaceId: target.hostId, target: { path: target.root, identity: target.fingerprint },
  } : {}) };
}

/** Main-only adapter. All roots, draft state and operation owners come from trusted services. */
function createLocalGitReviewService({ storagePath, rootFor, recheck, own, exclusive, getDraftPaths = () => [], executeHelper = runLocalGitReviewHelper }) {
  const storageChain = chain(storagePath), file = path.join(storagePath, 'local-git-reviews.json');
  let rows = [];
  function safeFile() {
    assertChain(storageChain);
    if (!fs.existsSync(file)) return;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > REMOTE_GIT_REVIEW_LIMITS.retainedBytes
      || typeof process.getuid === 'function' && stat.uid !== process.getuid()
      || process.platform !== 'win32' && (stat.mode & 0o077)) fail('LOCAL_GIT_STORAGE', 'Preserve the unsafe local Git review registry for recovery.');
  }
  safeFile();
  if (fs.existsSync(file)) { rows = JSON.parse(fs.readFileSync(file, 'utf8')); validateRemoteGitReviewRecords(rows); }
  const store = next => {
    validateRemoteGitReviewRecords(next); safeFile();
    const receipt = writePrivateFileAtomic(file, JSON.stringify(next), { protectDirectory: false, durable: true });
    if (receipt.durability === 'uncertain') fail('LOCAL_GIT_STORAGE', 'Local Git receipt durability is unknown. Inspect this exact action before another mutation.');
    rows = structuredClone(next);
  };
  const save = row => {
    const next = structuredClone(rows), index = next.findIndex(item => item.actionId === row.actionId);
    if (index < 0) next.push(structuredClone(row)); else next[index] = structuredClone(row);
    store(next);
  };
  const draftCheck = id => {
    const drafts = getDraftPaths(id);
    if (!Array.isArray(drafts)) fail('LOCAL_GIT_DRAFTS_UNAVAILABLE', 'The editor draft state is unavailable.');
    if (drafts.length) fail('LOCAL_GIT_DRAFTS_RETAINED', 'Save or explicitly discard retained editor drafts before preparing or applying a Git mutation.');
  };
  const controller = createRemoteGitReviewController({
    withHost(id, action, kind, mutation = false) {
      const run = async () => {
        const root = rootFor(id); recheck(root);
        const scope = { hostId: id, connectionId: id, fingerprint: hash(`${root.path}\0${root.identity}`), root: root.path,
          hostname: 'local-workspace', username: `local-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`, port: 1 };
        return action(scope, async (operation, payload) => {
          recheck(root);
          if (operation === 'prepare' || operation === 'apply') draftCheck(id);
          const value = await executeHelper(scope, operation, payload);
          recheck(root); return value;
        });
      };
      return mutation ? exclusive(id, 'Applying reviewed local Git action', run) : own(id, 'read', `Local Git ${kind}`, run);
    },
    getRecords: () => structuredClone(rows), storeRecords: store,
    begin() { throw new Error('Local Git uses atomic prepared records.'); },
    finish() { throw new Error('Local Git uses atomic terminal records.'); },
    storePrepared(row) { row.receiptId = randomUUID(); save(row); return structuredClone(row); },
    storeTerminal(row) { save(row); },
  });
  const call = async action => {
    try { return local(await action()); }
    catch (error) {
      if (error instanceof Error) error.message = error.message.replace(/\bRemote\b/g, 'Local').replace(/\bremote\b/g, 'local');
      throw error;
    }
  };
  return Object.freeze({
    bases: id => call(() => controller.bases(id)),
    capture: (id, input) => call(() => controller.capture(id, input)),
    diff: (id, input) => call(() => controller.diff(id, input)),
    prepare: (id, input) => call(() => controller.prepare(id, input)),
    apply: (id, input) => call(() => controller.apply(id, input)),
    inspectAction: (id, actionId) => call(() => controller.inspectAction(id, actionId)),
    listActions: id => local(controller.listActions(id)),
    pruneActions: (id, ids) => controller.pruneActions(id, ids),
    hasRetainedState: id => controller.listActions(id).some(row => row.ownerHeld || ['prepared', 'unknown'].includes(row.state)),
    currentOperation: () => controller.currentOperation() ? 'Local Git Review operation' : null,
    destroy: () => controller.destroy(),
  });
}
module.exports = { createLocalGitReviewService, runLocalGitReviewHelper };
