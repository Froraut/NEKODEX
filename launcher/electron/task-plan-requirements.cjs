const fs = require('node:fs');
const crypto = require('node:crypto');
const MAX_HISTORY = 8;
const MAX_REVIEWS = 64;
const MAX_BYTES = 256 * 1024;
const key = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const keys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every(name => Object.hasOwn(value, name)) && Object.keys(value).every(name => required.includes(name) || optional.includes(name));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.trim() && Buffer.byteLength(value, 'utf8') <= 500
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

/** Explicit user-authored content. The supplied task resolver is the sole metadata authority. */
function createTaskRequirementStore({ fileFor, read, commit, getPlan, resolveTask, clock = Date.now }) {
  function owner(input) {
    fileFor(input); // Validate the exact account/task key before asking its trusted owner.
    const task = resolveTask?.({ accountId: input.accountId, taskId: input.taskId });
    const native = task?.observation?.native;
    if (!task || task.id !== input.taskId || !native || native.source !== 'codex-client') throw new Error('Native task requirements owner is unavailable');
    return { task, native: { threadId: native.threadId, turnId: native.turnId } };
  }
  function actions(task) {
    return (task.observation?.tools ?? []).filter(tool => tool.observed === 'succeeded' && integer(tool.observedAt)).map(tool => ({
      key: key([tool.namespace ?? null, tool.name, tool.observedAt]), source: 'task-tool-result',
      name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), observedAt: tool.observedAt,
    }));
  }
  function planRevision(input, native) {
    const plan = getPlan(input);
    if (!plan) return null;
    if (plan.native?.threadId !== native.threadId || plan.native?.turnId !== native.turnId) throw new Error('Requirements and retained plan have different native owners');
    return plan.revisions.at(-1)?.revision ?? null;
  }
  function validate(book, input, native) {
    if (!keys(book, ['version', 'accountId', 'taskId', 'native', 'revision', 'requirementRevision', 'planRevision', 'history', 'coverage', 'coverageHistory', 'consent'], ['invalidation'])
      || book.version !== 1 || book.accountId !== input.accountId || book.taskId !== input.taskId
      || !keys(book.native, ['threadId', 'turnId']) || book.native.threadId !== native.threadId || book.native.turnId !== native.turnId
      || !integer(book.revision) || book.revision < 1 || !integer(book.requirementRevision) || book.requirementRevision < 1
      || !(book.planRevision === null || (integer(book.planRevision) && book.planRevision > 0))
      || !keys(book.consent, ['source', 'confirmedAt']) || book.consent.source !== 'explicit-user-input' || !integer(book.consent.confirmedAt)
      || !Array.isArray(book.history) || !book.history.length || book.history.length > MAX_HISTORY
      || !Array.isArray(book.coverage) || book.coverage.length > 16 || !Array.isArray(book.coverageHistory) || book.coverageHistory.length > MAX_REVIEWS) throw new Error('Invalid retained task requirements');
    for (let index = 0; index < book.history.length; index++) {
      const revision = book.history[index];
      if (!keys(revision, ['revision', 'source', 'savedAt', 'requirements']) || revision.revision !== index + 1
        || revision.source !== (index ? 'user-correction' : 'user-original') || !integer(revision.savedAt)
        || !Array.isArray(revision.requirements) || !revision.requirements.length || revision.requirements.length > 16
        || revision.requirements.some(row => !keys(row, ['id', 'text']) || !/^[a-f0-9-]{36}$/.test(row.id) || !text(row.text))
        || new Set(revision.requirements.map(row => row.id)).size !== revision.requirements.length) throw new Error('Invalid requirement revision history');
    }
    if (book.history.at(-1).revision !== book.requirementRevision) throw new Error('Invalid current requirement revision');
    for (const row of [...book.coverage, ...book.coverageHistory]) {
      const requirements = book.history.find(revision => revision.revision === row.requirementRevision)?.requirements;
      if (!keys(row, ['id', 'requirementId', 'requirementRevision', 'planRevision', 'stepIndexes', 'actionReferences', 'savedAt'], ['userAttestation'])
        || typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/.test(row.id)
        || !requirements?.some(requirement => requirement.id === row.requirementId) || !integer(row.savedAt)
        || !(row.planRevision === null || (integer(row.planRevision) && row.planRevision > 0))
        || !Array.isArray(row.stepIndexes) || row.stepIndexes.length > 32 || row.stepIndexes.some(index => !integer(index) || index >= 32)
        || new Set(row.stepIndexes).size !== row.stepIndexes.length || !Array.isArray(row.actionReferences) || row.actionReferences.length > 8
        || row.actionReferences.some(action => !keys(action, ['key', 'source', 'name', 'observedAt'], ['namespace'])
          || action.source !== 'task-tool-result' || !/^[a-f0-9]{32}$/.test(action.key) || typeof action.name !== 'string'
          || !/^[A-Za-z0-9_.:-]{1,128}$/.test(action.name) || !integer(action.observedAt)
          || (action.namespace !== undefined && (typeof action.namespace !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(action.namespace))))
        || (row.userAttestation !== undefined && (!keys(row.userAttestation, ['source', 'confirmedAt'])
          || row.userAttestation.source !== 'user-confirmed' || !integer(row.userAttestation.confirmedAt)))) throw new Error('Invalid scoped coverage history');
    }
    if (book.coverage.some(row => row.requirementRevision !== book.requirementRevision || row.planRevision !== book.planRevision)
      || new Set(book.coverage.map(row => row.requirementId)).size !== book.coverage.length
      || new Set(book.coverageHistory.map(row => row.id)).size !== book.coverageHistory.length
      || book.coverage.some(row => !book.coverageHistory.some(event => JSON.stringify(event) === JSON.stringify(row)))) throw new Error('Invalid current coverage scope');
    if (book.invalidation !== undefined && (!keys(book.invalidation, ['reason', 'at'])
      || !['plan-changed', 'requirements-corrected'].includes(book.invalidation.reason) || !integer(book.invalidation.at))) throw new Error('Invalid coverage invalidation');
  }
  function write(input, book) {
    if (Buffer.byteLength(JSON.stringify(book)) > MAX_BYTES) throw new Error('Requirements storage is full; retained history was preserved');
    if (!commit(fileFor(input), book)) throw new Error('Private task content quota reached; existing records were retained');
  }
  function load(input, owned) {
    const file = fileFor(input); if (!fs.existsSync(file)) return null;
    const book = read(file, MAX_BYTES); validate(book, input, owned.native);
    const current = planRevision(input, owned.native);
    if (book.planRevision !== current) {
      book.planRevision = current; book.coverage = []; book.revision++;
      book.invalidation = { reason: 'plan-changed', at: clock() }; write(input, book);
    }
    return book;
  }
  function project(book, owned) {
    return book ? structuredClone({ ...book, availableActions: actions(owned.task), propertyVerification: 'unavailable' }) : null;
  }
  function cas(book, expected) {
    if (!integer(expected) || expected !== (book?.revision ?? 0)) throw new Error('Requirements or plan revision changed; refresh before saving');
  }
  return {
    requirements(input) { const owned = owner(input); return project(load(input, owned), owned); },
    saveRequirements(input) {
      if (!keys(input, ['accountId', 'taskId', 'expectedRevision', 'texts', 'captureConsent']) || input.captureConsent !== true
        || !Array.isArray(input.texts) || !input.texts.length || input.texts.length > 16 || input.texts.some(value => !text(value))) throw new Error('Explicit content consent and 1 to 16 bounded requirements are required');
      const owned = owner(input); const previous = load(input, owned); cas(previous, input.expectedRevision);
      const normalized = input.texts.map(value => value.trim());
      if (previous && JSON.stringify(previous.history.at(-1).requirements.map(row => row.text)) === JSON.stringify(normalized)) return project(previous, owned);
      if ((previous?.history.length ?? 0) >= MAX_HISTORY) throw new Error('Requirement revision history is full; retained revisions were preserved');
      const now = clock(); const requirementRevision = (previous?.requirementRevision ?? 0) + 1;
      const history = { revision: requirementRevision, source: previous ? 'user-correction' : 'user-original', savedAt: now,
        requirements: normalized.map(value => ({ id: crypto.randomUUID(), text: value })) };
      const book = { version: 1, accountId: input.accountId, taskId: input.taskId, native: owned.native,
        revision: (previous?.revision ?? 0) + 1, requirementRevision, planRevision: planRevision(input, owned.native),
        history: [...(previous?.history ?? []), history], coverage: [], coverageHistory: previous?.coverageHistory ?? [],
        consent: previous?.consent ?? { source: 'explicit-user-input', confirmedAt: now },
        ...(previous ? { invalidation: { reason: 'requirements-corrected', at: now } } : {}) };
      validate(book, input, owned.native); write(input, book); return project(book, owned);
    },
    updateCoverage(input) {
      if (!keys(input, ['accountId', 'taskId', 'expectedRevision', 'requirementId', 'stepIndexes', 'actionKeys', 'userConfirmed'])
        || !Array.isArray(input.stepIndexes) || input.stepIndexes.length > 32 || input.stepIndexes.some(index => !integer(index))
        || new Set(input.stepIndexes).size !== input.stepIndexes.length || !Array.isArray(input.actionKeys) || input.actionKeys.length > 8
        || input.actionKeys.some(value => typeof value !== 'string') || new Set(input.actionKeys).size !== input.actionKeys.length
        || typeof input.userConfirmed !== 'boolean') throw new Error('Invalid requirement coverage input');
      const owned = owner(input); const book = load(input, owned); cas(book, input.expectedRevision);
      if (!book || !book.history.at(-1).requirements.some(row => row.id === input.requirementId)) throw new Error('Requirement does not belong to the current correction');
      const steps = getPlan(input)?.revisions.at(-1)?.steps ?? [];
      if (input.stepIndexes.some(index => index >= steps.length)) throw new Error('Selected plan step does not belong to the current native revision');
      const available = actions(owned.task); const references = input.actionKeys.map(actionKey => {
        const action = available.find(candidate => candidate.key === actionKey);
        if (!action) throw new Error('Observed action does not belong to the trusted task owner'); return action;
      });
      const previous = book.coverage.find(row => row.requirementId === input.requirementId);
      if (previous && JSON.stringify(previous.stepIndexes) === JSON.stringify(input.stepIndexes)
        && JSON.stringify(previous.actionReferences.map(action => action.key)) === JSON.stringify(input.actionKeys)
        && Boolean(previous.userAttestation) === input.userConfirmed) return project(book, owned);
      if (book.coverageHistory.length >= MAX_REVIEWS) throw new Error('Coverage review history is full; retained reviews were preserved');
      const now = clock(); const row = { id: crypto.randomUUID(), requirementId: input.requirementId, requirementRevision: book.requirementRevision,
        planRevision: book.planRevision, stepIndexes: input.stepIndexes, actionReferences: references, savedAt: now,
        ...(input.userConfirmed ? { userAttestation: { source: 'user-confirmed', confirmedAt: now } } : {}) };
      book.coverage = [...book.coverage.filter(item => item.requirementId !== input.requirementId), row];
      book.coverageHistory.push(row); book.revision++; validate(book, input, owned.native); write(input, book); return project(book, owned);
    },
    deleteRequirements(input) {
      if (!keys(input, ['accountId', 'taskId', 'expectedRevision']) || !integer(input.expectedRevision)) throw new Error('Captured requirements revision is required for deletion');
      const owned = owner(input); const file = fileFor(input);
      if (fs.existsSync(file)) {
        const book = read(file, MAX_BYTES); validate(book, input, owned.native); cas(book, input.expectedRevision); fs.unlinkSync(file);
      }
      return { deleted: true };
    },
  };
}
module.exports = { createTaskRequirementStore, MAX_REQUIREMENT_BYTES: MAX_BYTES };
