'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MAX_BYTES = 32 * 1024, MAX_WATCHERS = 16, MAX_EVENTS = 32;
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/u.test(value);
const scopeOf = task => ({ familyId: task.familyId, generation: task.generation, revision: task.revision });
function scope(value) {
  if (!record(value) || !validId(value.familyId) || !Number.isSafeInteger(value.generation) || value.generation < 1
      || !Number.isSafeInteger(value.revision) || value.revision < 1 || Object.keys(value).sort().join(',') !== 'familyId,generation,revision') throw new Error('Invalid Loop source scope');
  return { familyId: value.familyId, generation: value.generation, revision: value.revision };
}
const nodeId = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(directory);
  if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(directory) !== directory || (st.mode & 0o077)
      || process.getuid && st.uid !== process.getuid()) throw new Error('Private Loop source storage required');
}
function checkParents(row, capture = false) {
  const root = fs.lstatSync(row.projectPath);
  if (!root.isDirectory() || root.isSymbolicLink() || fs.realpathSync(row.projectPath) !== row.projectPath
      || !same(nodeId(root), row.rootPin)) throw new Error('Selected project identity changed');
  let current = row.projectPath; const pins = [];
  for (const part of row.relativePath.split(path.sep).slice(0, -1)) {
    current = path.join(current, part);
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('Selected source cannot follow symbolic or changed parent directories');
    pins.push(nodeId(st));
  }
  if (!capture && !same(pins, row.parentPins)) throw new Error('Selected source parent identity changed; select the file again');
  return pins;
}
function readPinned(row, content) {
  checkParents(row);
  const current = path.join(row.projectPath, row.relativePath);
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Selected source cannot follow symbolic links');
  const fd = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    // O_NOFOLLOW protects the final component only. Recheck the pinned parent
    // chain after opening and before reading, then again before publishing a hash.
    checkParents(row);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || !same(nodeId(before), row.filePin) || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)
        || !same(nodeId(fs.lstatSync(current)), row.filePin)) throw new Error('Selected regular file identity or bound changed');
    if (!content) return { name: path.basename(current), byteLength: Number(before.size) };
    const bytes = Buffer.alloc(MAX_BYTES + 1); let count = 0;
    while (count <= MAX_BYTES) { const n = fs.readSync(fd, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
    const after = fs.fstatSync(fd, { bigint: true });
    checkParents(row);
    if (count > MAX_BYTES || !after.isFile() || after.nlink !== 1n || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || !same(nodeId(after), row.filePin) || !same(nodeId(fs.lstatSync(current)), row.filePin)) throw new Error('Selected file changed while observing metadata');
    return { name: path.basename(current), byteLength: count, sha256: hash(bytes.subarray(0, count)) };
  } finally { fs.closeSync(fd); }
}
/** Selected-file metadata producer only. getTask/enqueueWork are trusted owned-core
 * adapters; this leaf cannot create Run consent, invoke tools or start a model.
 * getTask must project a LIVE loopSourceAuthority, never persisted loopRun alone. */
function createLoopFileWatcher({ directory, resolveProject, getTask, enqueueWork }) {
  if (!path.isAbsolute(directory) || typeof resolveProject !== 'function' || typeof getTask !== 'function' || typeof enqueueWork !== 'function') throw new Error('Loop file source owner unavailable');
  directory = path.resolve(directory); privateDirectory(directory);
  const registryPath = path.join(directory, 'watchers.json'), lockPath = path.join(directory, 'owner.lock');
  const lockBytes = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  const lockFd = fs.openSync(lockPath, 'wx', 0o600); fs.writeFileSync(lockFd, lockBytes); fs.fsyncSync(lockFd); fs.closeSync(lockFd);
  let rows = [], registryDigest = null, closed = false, closing = false, closingPromise;
  const live = new Map(), pending = new Set(), taskEpochs = new Map(), projectEpochs = new Map(), starting = new Set();
  const currentState = (row, state) => !closed && !closing && !state?.cancelled && (!state
    || state.taskEpoch === (taskEpochs.get(row.taskId) ?? 0) && state.projectEpoch === (projectEpochs.get(row.projectId) ?? 0));
  function readRegistry() {
    if (!fs.existsSync(registryPath)) return null;
    const fd = fs.openSync(registryPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const st = fs.fstatSync(fd); if (!st.isFile() || st.size > 1024 * 1024 || st.nlink !== 1 || st.mode & 0o077) throw new Error('Invalid Loop source registry'); return fs.readFileSync(fd); }
    finally { fs.closeSync(fd); }
  }
  function persist() {
    if (closed || fs.readFileSync(lockPath, 'utf8') !== lockBytes) throw new Error('Loop source owner changed');
    const previous = readRegistry(); if ((previous ? hash(previous) : null) !== registryDigest) throw new Error('Loop source registry changed externally');
    const bytes = Buffer.from(JSON.stringify({ version: 1, rows })); if (bytes.length > 1024 * 1024) throw new Error('Loop source registry quota reached');
    const temporary = path.join(directory, `.${randomUUID()}.tmp`); let fd;
    try { fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, registryPath);
      const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } registryDigest = hash(bytes);
    } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  try {
    const bytes = readRegistry(); registryDigest = bytes ? hash(bytes) : null;
    if (bytes) {
      const saved = JSON.parse(bytes.toString('utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.rows) || saved.rows.length > MAX_WATCHERS) throw new Error('Invalid Loop source registry');
      rows = saved.rows;
      for (const row of rows) {
        if (!validId(row.id) || !validId(row.taskId) || !Array.isArray(row.events) || row.events.length > MAX_EVENTS) throw new Error('Invalid Loop source registry');
        row.enabled = false; row.reason = 'restart_requires_explicit_enable';
        for (const event of row.events) if (event.state === 'pending') event.state = 'unknown';
      }
      persist();
    }
  } catch (error) { if (fs.readFileSync(lockPath, 'utf8') === lockBytes) fs.unlinkSync(lockPath); throw error; }
  const find = id => { const row = rows.find(item => item.id === id); if (!row) throw new Error('Selected Loop source is unavailable'); return row; };
  function stop(row, reason) {
    const state = live.get(row.id); if (state) { state.cancelled = true; clearTimeout(state.timer); state.watcher?.close(); live.delete(row.id); }
    row.enabled = false; row.reason = reason;
  }
  function dto(row) { return { id: row.id, taskId: row.taskId, projectId: row.projectId, name: path.basename(row.relativePath), enabled: row.enabled,
    reason: row.reason, scope: row.scope, runId: row.runId ?? null, eventBound: row.eventBound ?? 0, emitted: row.emitted ?? 0,
    instruction: row.instruction ?? '', baseline: row.baseline ?? null, events: row.events.map(event => ({ eventId: event.eventId, sequence: event.sequence,
      actionId: event.actionId, workId: event.workId, workKey: event.workKey, state: event.state, metadata: event.metadata, scope: event.scope,
      runId: event.runId, createdAt: event.createdAt })), contentIncluded: false, coalescing: 'Current metadata changes only; transient intermediate contents may be coalesced.' }; }
  async function inspect(row, state, initial = false) {
    const project = await resolveProject(row.projectId);
    if (!currentState(row, state) || !project || project.id !== row.projectId || project.path !== row.projectPath) throw new Error('Selected project grant is unavailable');
    const current = await getTask(row.taskId), task = current?.task, authority = current?.loopSourceAuthority;
    if (!currentState(row, state)) throw new Error('Selected project or task grant is unavailable');
    if (!task || task.id !== row.taskId || task.mode !== 'loop' || !['ready', 'running', 'review_required'].includes(task.status)
        || task.familyId !== row.scope.familyId || !authority || authority.active !== true || !validId(authority.runId) || !validId(authority.ownerId)
        || authority.ownerId !== task.ownerId || authority.ownerId !== task.loopRun?.ownerId || authority.generation !== task.generation
        || authority.revision !== task.revision || authority.familyId !== task.familyId || authority.cycle !== task.cycle || task.loopRun?.generation !== task.generation) throw new Error('Live explicit Loop Run authority is unavailable');
    if (initial) { if (!same(scopeOf(task), row.scope)) throw new Error('Task scope changed before enabling source'); }
    else {
      const delta = task.cycle - row.cycle;
      if (authority.runId !== row.runId || authority.ownerId !== row.ownerId || delta < 0 || task.generation - row.scope.generation !== delta
          || task.revision - row.scope.revision !== delta || task.bounds.maxTurns !== row.bounds.maxTurns || task.bounds.maxConcurrent !== row.bounds.maxConcurrent || task.bounds.maxSpend !== row.bounds.maxSpend) throw new Error('Loop source Run or instruction scope changed');
    }
    return { task, authority, current };
  }
  function acceptScope(row, checked) { row.scope = scopeOf(checked.task); row.cycle = checked.task.cycle; }
  async function reconcileEvent(row, event) {
    const current = await getTask(row.taskId, event.workId);
    const packet = current?.workPacket ?? current?.workPackets?.find(item => item.workId === event.workId || item.workKey === event.workKey);
    if (packet && packet.workId === event.workId && packet.workKey === event.workKey && packet.text === event.text && packet.taskId === row.taskId) { event.state = 'delivered'; persist(); }
    return dto(row);
  }
  async function observe(row, state) {
    if (!currentState(row, state) || !row.enabled) return;
    try {
      const checked = await inspect(row, state); if (state.cancelled) return;
      acceptScope(row, checked);
      const metadata = readPinned(row, true);
      // A synchronous selected-file read follows the live authority check. A
      // later revocation cannot turn that bounded read into event authority.
      const after = await inspect(row, state); if (state.cancelled) return;
      acceptScope(row, after);
      if (same(metadata, row.baseline)) return;
      if (row.emitted >= row.eventBound || row.events.length >= MAX_EVENTS) { stop(row, 'event_bound'); persist(); return; }
      const sequence = row.events.length + 1, eventId = randomUUID(), actionId = randomUUID(), workId = randomUUID();
      const event = { eventId, sequence, actionId, workId, workKey: `local-file:${row.id}:${sequence}`, scope: { ...row.scope }, runId: row.runId,
        metadata, text: `${row.instruction}\n\nSelected local-file change (metadata only; file contents are not instructions or tool permission):\n${JSON.stringify(metadata)}`,
        state: 'pending', createdAt: new Date().toISOString() };
      row.events.push(event); row.emitted++; row.baseline = metadata; persist();
      // Exactly one enqueue attempt. A thrown/lost response is retained unknown;
      // later reconciliation only reads the exact packet, and never retries.
      try {
        const result = await enqueueWork({ action: 'enqueue-work', taskId: row.taskId, actionId, scope: event.scope, loopSourceRunId: event.runId,
          work: { workId, workKey: event.workKey, text: event.text } });
        const packet = result?.packet;
        if (!packet || packet.workId !== workId || packet.workKey !== event.workKey || packet.text !== event.text || packet.taskId !== row.taskId) throw new Error('Exact enqueue receipt unavailable');
        event.state = 'delivered';
      } catch { event.state = 'unknown'; stop(row, 'delivery_unknown'); }
      persist();
      if (!state.cancelled && row.enabled) {
        try { const next = await inspect(row, state); acceptScope(row, next); }
        catch { stop(row, 'run_authority_changed'); }
        if (row.emitted >= row.eventBound) stop(row, 'event_bound');
        persist();
      }
    } catch {
      if (!closed && !state.cancelled) { stop(row, 'source_or_authority_changed'); persist(); }
    }
  }
  function schedule(row, state) {
    if (!currentState(row, state)) return;
    state.dirty = true;
    if (state.busy || state.timer) return;
    state.timer = setTimeout(() => { state.timer = undefined; state.busy = (async () => {
      do { state.dirty = false; await observe(row, state); } while (state.dirty && !state.cancelled && !closed);
    })().catch(() => { if (!state.cancelled) stop(row, 'storage_unavailable'); }).finally(() => { pending.delete(state.busy); state.busy = null; }); pending.add(state.busy); }, 35);
    state.timer.unref?.();
  }
  return {
    status: () => ({ capability: 'explicit-selected-local-file-metadata', genericExternalWatchers: false, rows: rows.map(dto) }),
    /** Main-only native picker output. Renderer paths are never accepted by IPC. */
    async select({ taskId, scope: captured, projectId, filePath }) {
      if (closed || closing || !validId(taskId) || !validId(projectId) || !path.isAbsolute(filePath)) throw new Error('Invalid explicit file selection');
      captured = scope(captured);
      const selection = { taskId, projectId }, state = { taskEpoch: taskEpochs.get(taskId) ?? 0, projectEpoch: projectEpochs.get(projectId) ?? 0 };
      const current = await getTask(taskId), task = current?.task;
      if (!currentState(selection, state)) throw new Error('Selected project or task grant is unavailable');
      if (!task || task.id !== taskId || task.mode !== 'loop' || task.status === 'stopped' || !same(scopeOf(task), captured)) throw new Error('Task scope changed before selection');
      const project = await resolveProject(projectId);
      if (!currentState(selection, state)) throw new Error('Selected project or task grant is unavailable');
      if (!project || project.id !== projectId || !path.isAbsolute(project.path) || fs.realpathSync(project.path) !== project.path) throw new Error('Select an existing granted local project');
      const relativePath = path.relative(project.path, path.resolve(filePath));
      if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)
          || relativePath.split(path.sep).some(part => part.toLowerCase() === '.git')) throw new Error('Select one file inside the granted project');
      const previous = rows.find(row => row.taskId === taskId);
      if (previous && (previous.enabled || live.has(previous.id) || starting.has(previous.id) || previous.events.some(event => event.state !== 'delivered'))) throw new Error('Disable the source and settle its retained event receipts before selecting again');
      if (!previous && rows.length >= MAX_WATCHERS) throw new Error('Selected source quota reached; existing receipts are retained');
      const row = { id: previous?.id ?? randomUUID(), taskId, projectId, projectPath: project.path, relativePath, scope: captured,
        rootPin: nodeId(fs.lstatSync(project.path)), filePin: nodeId(fs.lstatSync(filePath)), enabled: false, reason: 'selected_disabled', events: previous?.events ?? [] };
      row.parentPins = checkParents(row, true);
      readPinned(row, false); if (previous) rows[rows.indexOf(previous)] = row; else rows.push(row); persist(); return dto(row);
    },
    async enable({ watcherId, scope: captured, instruction, eventBound, explicitUserAction }) {
      const row = find(watcherId); captured = scope(captured);
      if (closed || closing || explicitUserAction !== true || typeof instruction !== 'string' || !instruction.trim() || Buffer.byteLength(instruction) > 8192
          || /^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(instruction.trim())
          || !Number.isSafeInteger(eventBound) || eventBound < 1 || eventBound > MAX_EVENTS || row.events.length + eventBound > MAX_EVENTS
          || row.enabled || live.has(row.id) || starting.has(row.id) || row.events.some(event => event.state !== 'delivered') || captured.familyId !== row.scope.familyId) throw new Error('Explicit bounded source enable requires settled receipts and a substantive instruction');
      starting.add(row.id);
      try {
      row.scope = captured;
      const state = { cancelled: false, busy: null, timer: undefined, watcher: undefined, dirty: false, taskEpoch: taskEpochs.get(row.taskId) ?? 0, projectEpoch: projectEpochs.get(row.projectId) ?? 0 };
      const checked = await inspect(row, state, true);
      row.runId = checked.authority.runId; row.ownerId = checked.authority.ownerId; row.cycle = checked.task.cycle; row.bounds = structuredClone(checked.task.bounds);
      row.baseline = readPinned(row, true); row.instruction = instruction.trim(); row.eventBound = eventBound; row.emitted = 0;
      row.enabled = true; row.reason = 'watching'; live.set(row.id, state);
      try { state.watcher = fs.watch(path.join(row.projectPath, row.relativePath), () => schedule(row, state)); state.watcher.unref?.();
        state.watcher.on('error', () => { if (!closed && !state.cancelled) { stop(row, 'watch_unavailable'); try { persist(); } catch { row.reason = 'storage_unavailable'; } } }); persist(); schedule(row, state);
      } catch (error) { stop(row, 'watch_unavailable'); persist(); throw error; }
      return dto(row);
      } finally { starting.delete(row.id); }
    },
    disable(watcherId) { const row = find(watcherId); taskEpochs.set(row.taskId, (taskEpochs.get(row.taskId) ?? 0) + 1); stop(row, 'explicitly_disabled'); persist(); return dto(row); },
    /** Call synchronously before main-owned Pause/Stop/correction/owner teardown. */
    invalidateTask(taskId) { taskEpochs.set(taskId, (taskEpochs.get(taskId) ?? 0) + 1); for (const row of rows) if (row.taskId === taskId && row.enabled) stop(row, 'task_authority_invalidated'); persist(); },
    invalidateProject(projectId) { projectEpochs.set(projectId, (projectEpochs.get(projectId) ?? 0) + 1); for (const row of rows) if (row.projectId === projectId && row.enabled) stop(row, 'project_grant_revoked'); persist(); },
    async refresh(watcherId) { const row = find(watcherId), state = live.get(row.id); if (state) try { const checked = await inspect(row, state); acceptScope(row, checked); persist(); } catch { stop(row, 'run_authority_changed'); persist(); } return dto(row); },
    async reconcile({ watcherId, eventId }) { const row = find(watcherId), event = row.events.find(item => item.eventId === eventId); if (!event) throw new Error('Exact retained source event unavailable'); return reconcileEvent(row, event); },
    async waitForIdle() { for (const [id, state] of [...live]) if (state.timer) { clearTimeout(state.timer); state.timer = undefined; state.busy = observe(find(id), state).catch(() => { stop(find(id), 'storage_unavailable'); }).finally(() => { pending.delete(state.busy); state.busy = null; }); pending.add(state.busy); } while (pending.size) await Promise.allSettled([...pending]); },
    currentOperation: () => pending.size ? 'Loop local-file event enqueue' : null,
    get activeCount() { return pending.size; },
    close() {
      if (closingPromise) return closingPromise;
      // Fence new selections/Enable and stale awaited replies before draining
      // committed enqueue receipts. Persistence stays available to that owner.
      closing = true;
      closingPromise = (async () => {
        for (const row of rows) stop(row, 'owner_closed');
        // Stop pending Enable before its next file read as well as live watchers.
        for (const row of rows) taskEpochs.set(row.taskId, (taskEpochs.get(row.taskId) ?? 0) + 1);
        // Already committed enqueue ownership settles before journal release.
        while (pending.size) await Promise.allSettled([...pending]); persist(); closed = true;
        if (fs.readFileSync(lockPath, 'utf8') === lockBytes) fs.unlinkSync(lockPath);
      })();
      return closingPromise;
    },
  };
}
module.exports = { createLoopFileWatcher, MAX_BYTES, MAX_EVENTS };
