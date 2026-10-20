const fs = require('node:fs');
const { validTaskObservation, assertTaskObservation } = require('./task-observation.cjs');
const { randomBytes } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');

const phases = new Set(['preparing', 'sending-context', 'context-accepted', 'sending', 'accepted', 'responding', 'waiting-tools']);
const terminalPhases = new Set(['completed', 'failed-before-send', 'send-uncertain', 'failed-after-send', 'cancelled', 'interrupted']);
const submissions = new Set(['not-sent', 'unknown', 'uncertain', 'context-accepted', 'accepted']);
const fields = ['id', 'traceId', 'tabId', 'createdAt', 'updatedAt', 'phase', 'submission', 'sequence', 'terminal'];
const MAX_RECORDS = 2048;
// Only catalog identifiers, never prompts or other caller-supplied free text.
const taskModels = new Set(['chatgpt-web/light', 'chatgpt-web/medium', 'chatgpt-web/high',
  'chatgpt-web/extra-high', 'chatgpt-web/pro', 'chatgpt-web/luna', 'chatgpt-web/think',
  'chatgpt-web/zero-risk', 'chatgpt-web/zero-risk-pro', 'chatgpt-web/gpt-5.6-sol-instant',
  'chatgpt-web/gpt-5.6-sol-medium', 'chatgpt-web/gpt-5.6-sol-high', 'chatgpt-web/gpt-5.6-sol-extra-high',
  'chatgpt-web/gpt-5.6-sol', 'chatgpt-web/gpt-5.6-pro', 'chatgpt-web/gpt-6-pro', 'chatgpt-web/gpt-5.6-luna',
  'chatgpt-web/gpt-6-astra', 'chatgpt-web/gpt-6-astra-instant']);
// GPT-5.6 Sol runs every level below Pro, including the retired Astra identities; GPT-6 only Pro.
const solTaskModels = new Set(['chatgpt-web/gpt-5.6-sol-instant', 'chatgpt-web/gpt-5.6-sol-medium',
  'chatgpt-web/gpt-5.6-sol-high', 'chatgpt-web/gpt-5.6-sol-extra-high', 'chatgpt-web/gpt-5.6-sol',
  'chatgpt-web/gpt-5.6-pro', 'chatgpt-web/gpt-6-astra', 'chatgpt-web/gpt-6-astra-instant']);
function isTaskModel(model) { return typeof model === 'string' && taskModels.has(model); }
function taskModelFamily(model) {
  if (model === 'chatgpt-web/gpt-6-pro') return '6';
  return solTaskModels.has(model) ? '5.6' : undefined;
}
function taskModelForRequirement(requirement) {
  return isTaskModel(requirement?.requestedModel) ? requirement.requestedModel : null;
}

function validRecord(row) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).every(key => fields.includes(key) || ['model', 'observation', 'delivery'].includes(key))
    && fields.every(key => Object.hasOwn(row, key))
    && (row.observation === undefined || validTaskObservation(row.observation))
    && (row.delivery === undefined || (Array.isArray(row.delivery) && row.delivery.length <= 16
      && row.delivery.every(receipt => receipt && Object.keys(receipt).length === 4
        && (phases.has(receipt.phase) || terminalPhases.has(receipt.phase))
        && submissions.has(receipt.submission) && Number.isSafeInteger(receipt.observedAt)
        && receipt.observedAt >= row.createdAt && receipt.observedAt <= row.updatedAt
        && Number.isSafeInteger(receipt.sequence) && receipt.sequence >= 0)))
    && (!Object.hasOwn(row, 'model') || row.model === null || isTaskModel(row.model))
    && /^[a-f0-9]{32}$/.test(row.id) && /^[A-Za-z0-9_-]{6,128}$/.test(row.traceId)
    && /^[A-Za-z0-9_-]{6,128}$/.test(row.tabId)
    && Number.isSafeInteger(row.createdAt) && row.createdAt >= 0
    && Number.isSafeInteger(row.updatedAt) && row.updatedAt >= row.createdAt && row.updatedAt <= 8_640_000_000_000_000
    && (phases.has(row.phase) || terminalPhases.has(row.phase)) && submissions.has(row.submission)
    && Number.isSafeInteger(row.sequence) && row.sequence >= 0
    && typeof row.terminal === 'boolean' && row.terminal === terminalPhases.has(row.phase);
}

// Metadata only. No prompt, response, page title, URL, credentials or tool arguments.
class BrowserTaskLedger {
  constructor(file, clock = Date.now) {
    this.file = file; this.clock = clock; this.records = []; this.recordIndex = new Map(); this.storageIssue = null;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error('Invalid task journal');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > MAX_RECORDS
        || !data.records.every(validRecord) || new Set(data.records.map(row => row.id)).size !== data.records.length) {
        throw new Error('Invalid task journal');
      }
      this.records = data.records.map(row => {
        const next = { ...row, model: row.model ?? null };
        if (!row.terminal) {
          Object.assign(next, { phase: 'interrupted', terminal: true, updatedAt: Math.max(row.updatedAt, this.clock()) });
          next.delivery = this.receipts(row, next);
        }
        return next;
      });
      if (data.records.some(row => !row.terminal)) this.save(this.records);
    } catch (error) {
      if (error.code !== 'ENOENT') this.storageIssue = 'task-history-unavailable';
    }
    this.recordIndex = new Map(this.records.map(row => [row.id, row]));
  }
  save(records) {
    if (this.storageIssue) throw new Error('Task history could not be read; preserve the journal and repair storage before starting new tasks');
    writePrivateFileAtomic(this.file, JSON.stringify({ version: 1, records }) + '\n', { durable: true });
    this.records = records;
    // Publish the read index only after the durable write succeeds. It refers to
    // these exact records, never a second owner of journal state.
    this.recordIndex = new Map(records.map(row => [row.id, row]));
  }
  get(id) { return this.recordIndex.get(id); }
  snapshot() { return structuredClone(this.records); }
  start(traceId, tabId, progressVersion, model = null) {
    const now = this.clock();
    const record = { id: randomBytes(16).toString('hex'), traceId, tabId, model, createdAt: now, updatedAt: now,
      phase: 'preparing', submission: progressVersion === 1 ? 'not-sent' : 'unknown', sequence: 0, terminal: false };
    record.delivery = [this.receipt(record)];
    if (!validRecord(record)) throw new Error('Invalid task owner');
    // Never silently evict an unresolved incident or an active owner to make room.
    let records = this.records;
    if (records.length >= MAX_RECORDS) {
      const removable = records.find(row => row.terminal && row.phase === 'completed');
      if (!removable) throw new Error('Task history is full. Review and dismiss a finished task before starting another.');
      records = records.filter(row => row !== removable);
    }
    this.save([...records, record]);
    return record.id;
  }
  receipt(row) { return { phase: row.phase, submission: row.submission, observedAt: row.updatedAt, sequence: row.sequence }; }
  receipts(previous, next) {
    const receipts = previous.delivery ?? [];
    // Keep the first receipt of every meaningful milestone; repeated tool rounds must not
    // evict the original uncertain-send or acceptance proof.
    return receipts.some(receipt => receipt.phase === next.phase && receipt.submission === next.submission)
      ? receipts : [...receipts, this.receipt(next)].slice(-16);
  }
  progress(id, phase, sequence, observation) {
    const row = this.get(id);
    if (!row || row.terminal) throw new Error('Task is no longer active');
    if (observation !== undefined) {
      assertTaskObservation(observation);
      if (row.observation && JSON.stringify(row.observation.native) !== JSON.stringify(observation.native)) {
        throw new Error('Task observation native owner mismatch');
      }
    }
    if (!phases.has(phase) || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid task progress');
    if (sequence < row.sequence) return;
    if (sequence === row.sequence) {
      if (phase !== row.phase) throw new Error('Task progress revision conflict');
      return;
    }
    let submission = row.submission;
    // A later multipart send can be uncertain while earlier context is already
    // accepted. Preserve the strongest durable evidence for the whole task.
    if ((phase === 'sending' || phase === 'sending-context')
      && submission !== 'context-accepted' && submission !== 'accepted') submission = 'uncertain';
    if (phase === 'context-accepted' && submission !== 'accepted') submission = 'context-accepted';
    if (['accepted', 'responding', 'waiting-tools'].includes(phase)) submission = 'accepted';
    // A worker must not turn proven sending into a safe-to-retry preparation state.
    if (phase === 'preparing' && submission !== 'not-sent' && row.sequence > 0) throw new Error('Task cannot return to preparation after sending');
    const updated = { ...row, phase, submission, sequence, updatedAt: Math.max(row.updatedAt, this.clock()),
      ...(observation !== undefined ? { observation: structuredClone(observation) } : {}) };
    updated.delivery = this.receipts(row, updated);
    this.save(this.records.map(item => item !== row ? item : updated));
  }
  end(id, status) {
    const row = this.get(id);
    if (!row || row.terminal) return;
    if (!['completed', 'failed', 'aborted'].includes(status)) throw new Error('Invalid task outcome');
    const phase = status === 'completed' ? 'completed' : status === 'aborted' ? 'cancelled'
      : row.submission === 'not-sent' ? 'failed-before-send'
        : row.submission === 'accepted' || row.submission === 'context-accepted' ? 'failed-after-send' : 'send-uncertain';
    const updated = { ...row, phase, terminal: true, updatedAt: Math.max(row.updatedAt, this.clock()) };
    updated.delivery = this.receipts(row, updated);
    this.save(this.records.map(item => item !== row ? item : updated));
  }
  dismiss(id) {
    const row = this.get(id);
    if (!row || !row.terminal) throw new Error('Only a finished task can be dismissed');
    this.save(this.records.filter(item => item !== row));
  }
}
module.exports = { BrowserTaskLedger, taskModelForRequirement, taskModelFamily, isTaskModel };
