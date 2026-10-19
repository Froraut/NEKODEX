'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 64;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ownerErrors = new WeakSet();
function fail(code) {
    const error = Object.assign(new Error('VM export unavailable: ' + code), { code });
    ownerErrors.add(error);
    throw error;
}

function publicError(error) {
    if (ownerErrors.has(error)) {
        throw error;
    }
    fail('owner-unavailable');
}

function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
        fail('invalid-request');
    }
}

function scope(value, tool = false) {
    exact(value, tool ? ['taskId', 'generation', 'toolCallId'] : ['taskId', 'generation']);
    if (!UUID.test(value.taskId) || !Number.isSafeInteger(value.generation) || value.generation < 1 || tool && (typeof value.toolCallId !== 'string' || !value.toolCallId || value.toolCallId.length > 512)) {
        fail('invalid-scope');
    }
    return { taskId: value.taskId, generation: value.generation };
}

function relative(value) {
    if (typeof value !== 'string' || !value || value.length > 512 || !/^[A-Za-z0-9_.+@/-]+$/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git' || p.toLowerCase().startsWith('.nekodex-') || ['owner.lock', '.execution-owner', '.inventory-owner', '.build-owner', '.lock'].includes(p.toLowerCase()))) {
        fail('invalid-path');
    }
    return value;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function node(file, dir = false) {
    const s = fs.lstatSync(file, { bigint: true });
    if (fs.realpathSync(file) !== file || s.uid !== BigInt(process.getuid()) || (s.mode & 0o077n) || !(dir ? s.isDirectory() : s.isFile() && s.nlink === 1n)) {
        fail('unsafe-store');
    }
    return s;
}

function sync(dir) {
    const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
}

function directory(dir, create = false) {
    if (!fs.existsSync(dir) && create) {
        fs.mkdirSync(dir, { mode: 0o700 });
        sync(path.dirname(dir));
    }
    node(dir, true);
}

function bounded(file, max) {
    const before = node(file);
    if (before.size > BigInt(max)) {
        fail('record-limit');
    }
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(fd, { bigint: true });
        if (opened.dev !== before.dev || opened.ino !== before.ino) {
            fail('record-changed');
        }
        const chunks = [];
        let total = 0;
        while (true) {
            const b = Buffer.alloc(Math.min(65536, max + 1 - total)), n = fs.readSync(fd, b, 0, b.length, null);
            if (!n) {
                break;
            }
            total += n;
            if (total > max) {
                fail('record-limit');
            }
            chunks.push(b.subarray(0, n));
        }
        const after = node(file);
        if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].some(k => after[k] !== before[k])) {
            fail('record-changed');
        }
        return Buffer.concat(chunks, total);
    }
    finally {
        fs.closeSync(fd);
    }
}

function create(file, bytes) {
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400);
    try {
        fs.writeFileSync(fd, bytes);
        fs.fsyncSync(fd);
    }
    finally {
        fs.closeSync(fd);
    }
    sync(path.dirname(file));
}

/** Main-owned one-file export. Candidate access is a read-only port; the existing
 * workspace owner alone performs target publication. No VM launch or tool sender. */
function createWorkspaceVmExportService({ home, workspaceService, readCandidate, validateScope, validateIntent, protectedRoots = [] }) {
    if (typeof home !== 'string' || !path.isAbsolute(home) || ![readCandidate, validateScope, validateIntent, workspaceService?.captureBinary, workspaceService?.publishBinary, workspaceService?.confirmBinaryPublication].every(f => typeof f === 'function')) {
        throw new TypeError('Trusted VM export ports required');
    }
    const protectedPaths = [home, ...protectedRoots];
    if (protectedPaths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) {
        throw new TypeError('Absolute protected roots required');
    }
    const pending = new Map();
    const uncertain = new Set();
    const active = new Set();
    let closing = false;
    const root = (create = false) => {
        if (!fs.existsSync(home)) {
            if (!create) {
                return false;
            }
            directory(path.dirname(home));
            directory(home, true);
        }
        directory(home);
        return true;
    };
    const key = (make = false) => {
        root(make);
        const file = path.join(home, 'integrity.key');
        if (!fs.existsSync(file) && make) {
            if (fs.readdirSync(home).some(n => n !== '.lock')) {
                fail('foreign-store');
            }
            create(file, randomBytes(32));
        }
        const b = bounded(file, 32);
        if (b.length !== 32) {
            fail('unsafe-key');
        }
        return b;
    };
    const signed = value => {
        const body = JSON.stringify(value);
        return JSON.stringify({ body, signature: createHmac('sha256', key()).update(body).digest('hex') });
    };
    const read = file => {
        const envelope = JSON.parse(bounded(file, 65536).toString('utf8'));
        if (typeof envelope.body !== 'string' || !HASH.test(envelope.signature)) {
            fail('invalid-record');
        }
        const mac = createHmac('sha256', key()).update(envelope.body).digest();
        if (!timingSafeEqual(mac, Buffer.from(envelope.signature, 'hex'))) {
            fail('invalid-record');
        }
        return JSON.parse(envelope.body);
    };
    const put = (file, value) => {
        const bytes = signed(value);
        if (Buffer.byteLength(bytes) > 65536) {
            fail('record-limit');
        }
        if (fs.existsSync(file)) {
            if (bounded(file, 65536).toString() !== bytes) {
                fail('record-conflict');
            }
            sync(path.dirname(file));
            return;
        }
        const result = writePrivateFileAtomic(file, bytes, { protectDirectory: false, durable: true });
        if (result.durability !== 'confirmed') {
            fail('record-durability-unknown');
        }
    };
    const entries = kind => {
        if (!root() || !fs.existsSync(path.join(home, kind))) {
            return [];
        }
        directory(path.join(home, kind));
        const rows = fs.readdirSync(path.join(home, kind));
        if (rows.length > MAX_ROWS) {
            fail('store-limit');
        }
        return rows;
    };
    const locked = (work, settlement = false) => {
        if (closing && !settlement) {
            fail('closing');
        }
        const operation = (async () => {
            if (process.platform !== 'darwin') {
                fail('platform-unavailable');
            }
            root(true);
            const fd = fs.openSync(path.join(home, '.lock'), fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | 0x20 | 0x04, 0o600);
            try {
                const p = node(path.join(home, '.lock')), s = fs.fstatSync(fd, { bigint: true });
                if (p.dev !== s.dev || p.ino !== s.ino) {
                    fail('lock-changed');
                }
                key(true);
                directory(path.join(home, 'reviews'), true);
                directory(path.join(home, 'actions'), true);
                return await work();
            }
            finally {
                fs.closeSync(fd);
            }
        })();
        active.add(operation);
        void operation.finally(() => active.delete(operation)).catch(() => {
        });
        return operation;
    };
    const trusted = async (s) => {
        const value = await validateScope(s);
        if (!value || value.id !== s.taskId || value.generation !== s.generation || !UUID.test(value.familyId)) {
            fail('scope-changed');
        }
        return { taskId: s.taskId, familyId: value.familyId, generation: s.generation };
    };
    const destination = (workspaceId, name) => {
        if (!UUID.test(workspaceId)) {
            fail('invalid-workspace');
        }
        relative(name);
        const grant = workspaceService.resolveGrant(workspaceId), target = path.join(grant.path, name);
        for (const forbidden of protectedPaths) {
            const r = path.relative(forbidden, target);
            if (r === '' || !r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)) {
                fail('protected-destination');
            }
        }
        return grant;
    };
    const candidate = async (r) => {
        const bytes = await readCandidate({
            scope: r.scope,
            operationId: r.operationId,
            path: r.candidatePath,
            sha256: r.candidateSha256
        });
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) {
            fail('candidate-limit');
        }
        const captured = Buffer.from(bytes);
        if (sha(captured) !== r.candidateSha256 || captured.length !== r.bytes) {
            fail('candidate-changed');
        }
        return captured;
    };
    const reviewAt = id => {
        if (!UUID.test(id)) {
            fail('invalid-review');
        }
        return path.join(home, 'reviews', id);
    };
    const readReview = id => {
        const dir = reviewAt(id);
        directory(dir);
        const r = read(path.join(dir, 'review.json'));
        if (r.reviewId !== id || !HASH.test(r.reviewDigest)) {
            fail('invalid-review');
        }
        const { reviewDigest, ...body } = r;
        if (sha(JSON.stringify(body)) !== reviewDigest) {
            fail('invalid-review');
        }
        return r;
    };
    const publicReview = r => ({
        reviewId: r.reviewId,
        reviewDigest: r.reviewDigest,
        scope: r.scope,
        workspaceId: r.workspaceId,
        destinationPath: r.destinationPath,
        operationId: r.operationId,
        candidatePath: r.candidatePath,
        candidateSha256: r.candidateSha256,
        bytes: r.bytes,
        expectedRevision: r.expectedRevision,
        currentSha256: r.currentSha256,
        currentBytes: r.currentBytes
    });
    const requestInfo = request => {
        exact(request, ['scope', 'tool', 'arguments', 'idempotencyKey']);
        const task = scope(request.scope, true);
        exact(request.arguments, ['reviewId', 'reviewDigest']);
        if (request.tool !== 'vm-shell/export' || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey || request.idempotencyKey.length > 512 || !UUID.test(request.arguments.reviewId) || !HASH.test(request.arguments.reviewDigest)) {
            fail('invalid-intent');
        }
        const canonical = {
            scope: { ...task, toolCallId: request.scope.toolCallId },
            tool: request.tool,
            arguments: { reviewId: request.arguments.reviewId, reviewDigest: request.arguments.reviewDigest },
            idempotencyKey: request.idempotencyKey
        };
        return {
            task,
            fingerprint: sha(JSON.stringify(canonical)),
            actionKey: sha(request.idempotencyKey)
        };
    };
    const actionDir = k => {
        if (!HASH.test(k)) {
            fail('invalid-action');
        }
        return path.join(home, 'actions', k);
    };
    const unknown = intent => ({
        state: 'outcome_unknown',
        reason: 'vm-export-outcome-unknown',
        result: {
            receiptId: intent?.receiptId ?? null,
            reviewId: intent?.reviewId ?? null,
            ownerHeld: true
        }
    });
    const terminal = (dir, intent) => {
        const file = path.join(dir, 'terminal.json');
        if (uncertain.has(intent.fingerprint) || !fs.existsSync(file)) {
            return unknown(intent);
        }
        const result = read(file);
        if (result.fingerprint !== intent.fingerprint || result.receiptId !== intent.receiptId || !['completed', 'failed'].includes(result.outcome?.state)) {
            fail('invalid-receipt');
        }
        return structuredClone(result.outcome);
    };
    const held = () => entries('actions').some(name => {
        if (!HASH.test(name)) {
            fail('invalid-action');
        }
        const dir = actionDir(name);
        directory(dir);
        if (!fs.existsSync(path.join(dir, 'intent.json')) || !fs.existsSync(path.join(dir, 'terminal.json'))) {
            return true;
        }
        const intent = read(path.join(dir, 'intent.json'));
        return terminal(dir, intent).state === 'outcome_unknown';
    });
    const settle = (dir, intent, outcome) => {
        try {
            put(path.join(dir, 'terminal.json'), { version: 1, fingerprint: intent.fingerprint, receiptId: intent.receiptId, outcome });
            uncertain.delete(intent.fingerprint);
            return outcome;
        }
        catch {
            uncertain.add(intent.fingerprint);
            return unknown(intent);
        }
    };
    async function prepare(input) {
        exact(input, ['scope', 'workspaceId', 'destinationPath', 'operationId', 'candidatePath', 'candidateSha256', 'explicitUserAction']);
        scope(input.scope);
        if (input.explicitUserAction !== true || typeof input.operationId !== 'string' || !input.operationId || input.operationId.length > 512 || !HASH.test(input.candidateSha256)) {
            fail('invalid-review');
        }
        relative(input.candidatePath);
        return locked(async () => {
            if (held() || entries('reviews').length >= MAX_ROWS) {
                fail('prior-export-held-or-capacity');
            }
            const task = await trusted(input.scope);
            destination(input.workspaceId, input.destinationPath);
            const data = await readCandidate({
                scope: task,
                operationId: input.operationId,
                path: input.candidatePath,
                sha256: input.candidateSha256
            });
            if (!(data instanceof Uint8Array) || data.byteLength > MAX_BYTES || sha(data) !== input.candidateSha256) {
                fail('candidate-changed');
            }
            const bytes = Buffer.from(data);
            if (!same(await trusted(input.scope), task)) {
                fail('scope-changed');
            }
            destination(input.workspaceId, input.destinationPath);
            const capture = workspaceService.captureBinary(input.workspaceId, input.destinationPath);
            const reviewId = randomUUID(), body = {
                version: 1,
                reviewId,
                scope: task,
                workspaceId: input.workspaceId,
                destinationPath: input.destinationPath,
                operationId: input.operationId,
                candidatePath: input.candidatePath,
                candidateSha256: input.candidateSha256,
                bytes: bytes.length,
                expectedRevision: capture.revision,
                currentSha256: capture.sha256,
                currentBytes: capture.size,
                rootIdentity: capture.rootIdentity,
                parentDigest: capture.parentDigest
            };
            const row = { ...body, reviewDigest: sha(JSON.stringify(body)) }, dir = reviewAt(reviewId);
            directory(dir, true);
            create(path.join(dir, 'candidate.bin'), bytes);
            put(path.join(dir, 'review.json'), row);
            return publicReview(row);
        });
    }

    async function execute(request) {
        const info = requestInfo(request);
        const current = pending.get(info.actionKey);
        if (current) {
            if (current.fingerprint !== info.fingerprint) {
                fail('action-conflict');
            }
            return current.promise;
        }
        const promise = (async () => {
            await validateIntent(request);
            return locked(async () => {
                const dir = actionDir(info.actionKey);
                if (fs.existsSync(dir)) {
                    directory(dir);
                    if (!fs.existsSync(path.join(dir, 'intent.json'))) {
                        return unknown();
                    }
                    const priorIntent = read(path.join(dir, 'intent.json'));
                    if (priorIntent.fingerprint !== info.fingerprint) {
                        fail('action-conflict');
                    }
                    return terminal(dir, priorIntent);
                }
                if (held() || entries('actions').length >= MAX_ROWS) {
                    fail('prior-export-held-or-capacity');
                }
                const review = readReview(request.arguments.reviewId);
                if (review.reviewDigest !== request.arguments.reviewDigest || !same(await trusted(info.task), review.scope)) {
                    fail('review-scope-changed');
                }
                for (const name of entries('actions')) {
                    const priorIntent = read(path.join(actionDir(name), 'intent.json'));
                    if (priorIntent.reviewId === review.reviewId) {
                        fail('review-consumed');
                    }
                }
                // Persist the accepted, signed intent before any publication attempt.
                const intent = {
                    version: 1,
                    receiptId: randomUUID(),
                    reviewId: review.reviewId,
                    reviewDigest: review.reviewDigest,
                    fingerprint: info.fingerprint,
                    request: structuredClone(request),
                    scope: review.scope
                };
                directory(dir, true);
                put(path.join(dir, 'intent.json'), intent);
                let outcome;
                let publishCalled = false;
                try {
                    const bytes = await candidate(review);
                    const snapshot = bounded(path.join(reviewAt(review.reviewId), 'candidate.bin'), MAX_BYTES);
                    if (!snapshot.equals(bytes)) {
                        fail('candidate-changed');
                    }
                    if (!same(await trusted(info.task), review.scope)) {
                        fail('scope-changed');
                    }
                    // Recheck the exact intent after candidate/scope reads, before publication.
                    await validateIntent(request);
                    destination(review.workspaceId, review.destinationPath);
                    const capture = workspaceService.captureBinary(review.workspaceId, review.destinationPath);
                    if (capture.revision !== review.expectedRevision || capture.parentDigest !== review.parentDigest || !same(capture.rootIdentity, review.rootIdentity)) {
                        fail('destination-stale');
                    }
                    // The workspace owner is the only writer; retain uncertainty after this point.
                    publishCalled = true;
                    const result = workspaceService.publishBinary(capture, bytes, proof => put(path.join(dir, 'publication.json'), { version: 1, receiptId: intent.receiptId, proof }));
                    if (!result || !['written', 'unknown', 'conflict', 'blocked'].includes(result.state) || result.state === 'unknown') {
                        return unknown(intent);
                    }
                    if (result.state === 'written' && (!HASH.test(result.revision) || result.sha256 !== review.candidateSha256 || result.size !== review.bytes)) {
                        return unknown(intent);
                    }
                    outcome = result.state === 'written' ? {
                        state: 'completed',
                        result: {
                            receiptId: intent.receiptId,
                            reviewId: review.reviewId,
                            reviewDigest: review.reviewDigest,
                            workspaceId: review.workspaceId,
                            path: review.destinationPath,
                            revision: result.revision,
                            sha256: result.sha256,
                            bytes: result.size,
                            ownerHeld: false
                        }
                    } : {
                        state: 'failed',
                        reason: result.code === 'DESTINATION_STALE' ? 'destination-stale' : 'publication-not-started',
                        result: { receiptId: intent.receiptId, reviewId: review.reviewId, ownerHeld: false }
                    };
                }
                catch {
                    if (publishCalled) {
                        return unknown(intent);
                    }
                    outcome = {
                        state: 'failed',
                        reason: 'vm-export-prepublication-refused',
                        result: { receiptId: intent.receiptId, reviewId: review.reviewId, ownerHeld: false }
                    };
                }
                // A terminal receipt releases ownership only after durable settlement.
                return settle(dir, intent, outcome);
            });
        })();
        pending.set(info.actionKey, { fingerprint: info.fingerprint, promise });
        try {
            return await promise;
        }
        finally {
            if (pending.get(info.actionKey)?.promise === promise) {
                pending.delete(info.actionKey);
            }
        }
    }

    function inspect(request) {
        const info = requestInfo(request);
        if (!root() || !fs.existsSync(actionDir(info.actionKey))) {
            return null;
        }
        const dir = actionDir(info.actionKey);
        directory(dir);
        if (!fs.existsSync(path.join(dir, 'intent.json'))) {
            return unknown();
        }
        const intent = read(path.join(dir, 'intent.json'));
        if (intent.fingerprint !== info.fingerprint) {
            fail('action-conflict');
        }
        return terminal(dir, intent);
    }

    async function reconcile(request) {
        const info = requestInfo(request);
        return locked(async () => {
            const dir = actionDir(info.actionKey);
            if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'intent.json'))) {
                return null;
            }
            const intent = read(path.join(dir, 'intent.json'));
            if (intent.fingerprint !== info.fingerprint) {
                fail('action-conflict');
            }
            if (fs.existsSync(path.join(dir, 'terminal.json'))) {
                const value = read(path.join(dir, 'terminal.json'));
                if (value.fingerprint !== info.fingerprint || value.receiptId !== intent.receiptId) {
                    fail('invalid-receipt');
                }
                sync(dir);
                uncertain.delete(info.fingerprint);
                return terminal(dir, intent);
            }
            if (!fs.existsSync(path.join(dir, 'publication.json'))) {
                return unknown(intent);
            }
            const publication = read(path.join(dir, 'publication.json')), review = readReview(intent.reviewId);
            if (publication.receiptId !== intent.receiptId || review.reviewDigest !== intent.reviewDigest || !same(review.scope, intent.scope)) {
                fail('invalid-receipt');
            }
            // Historical settlement reads only the exact signed accepted intent and
            // existing written-node proof through the original workspace grant. It does
            // not grant a new generation permission to write or establish a new baseline.
            try {
                destination(review.workspaceId, review.destinationPath);
                const result = workspaceService.confirmBinaryPublication(review.workspaceId, review.destinationPath, publication.proof);
                if (!result) {
                    return unknown(intent);
                }
                return settle(dir, intent, {
                    state: 'completed',
                    result: {
                        receiptId: intent.receiptId,
                        reviewId: review.reviewId,
                        reviewDigest: review.reviewDigest,
                        workspaceId: review.workspaceId,
                        path: review.destinationPath,
                        revision: result.revision,
                        sha256: result.sha256,
                        bytes: result.size,
                        ownerHeld: false,
                        reconciled: true
                    }
                });
            }
            catch {
                return unknown(intent);
            }
        }, true);
    }

    function list(task) {
        scope(task);
        return {
            reviews: entries('reviews').filter(UUID.test.bind(UUID)).map(readReview).filter(r => r.scope.taskId === task.taskId && r.scope.generation === task.generation).map(publicReview),
            receipts: entries('actions').map(name => {
                const dir = actionDir(name);
                if (!fs.existsSync(path.join(dir, 'intent.json'))) {
                    return null;
                }
                const i = read(path.join(dir, 'intent.json'));
                return i.scope.taskId === task.taskId && i.scope.generation === task.generation ? { ...terminal(dir, i), request: structuredClone(i.request) } : null;
            }).filter(Boolean)
        };
    }

    function hasRetainedState(workspaceId) {
        if (typeof workspaceId !== 'string' || !UUID.test(workspaceId)) {
            return true;
        }
        try {
            for (const name of entries('actions')) {
                const dir = actionDir(name);
                directory(dir);
                if (!fs.existsSync(path.join(dir, 'intent.json'))) {
                    return true;
                }
                const intent = read(path.join(dir, 'intent.json'));
                if (terminal(dir, intent).state !== 'outcome_unknown') {
                    continue;
                }
                if (readReview(intent.reviewId).workspaceId === workspaceId) {
                    return true;
                }
            }
            return false;
        }
        catch {
            return true;
        }
    }
    const asynchronous = fn => (...args) => {
        try {
            return Promise.resolve(fn(...args)).catch(publicError);
        }
        catch (error) {
            return Promise.reject(error).catch(publicError);
        }
    };
    const synchronous = fn => (...args) => {
        try {
            return fn(...args);
        }
        catch (error) {
            return publicError(error);
        }
    };
    const activeCount = () => {
        try {
            const retained = entries('actions').filter(name => {
                const dir = actionDir(name);
                if (!fs.existsSync(path.join(dir, 'intent.json'))) {
                    return true;
                }
                return terminal(dir, read(path.join(dir, 'intent.json'))).state === 'outcome_unknown';
            }).length;
            return Math.max(retained, pending.size, active.size);
        }
        catch {
            return Math.max(1, pending.size, active.size);
        }
    };
    const destroy = async () => {
        closing = true;
        await Promise.allSettled([...active, ...[...pending.values()].map(p => p.promise)]);
        if (activeCount()) {
            fail('export-outcome-held');
        }
    };
    return Object.freeze({
        prepare: asynchronous(prepare),
        execute: asynchronous(execute),
        inspect: synchronous(inspect),
        reconcile: asynchronous(reconcile),
        list: synchronous(list),
        hasRetainedState,
        get activeCount() {
            return activeCount();
        },
        currentOperation: () => activeCount() ? 'VM candidate export' : null,
        destroy,
        close: destroy
    });
}
module.exports = { createWorkspaceVmExportService, MAX_VM_EXPORT_BYTES: MAX_BYTES };
