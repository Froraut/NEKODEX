const fs = require('node:fs');
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
  'chatgpt-web/zero-risk', 'chatgpt-web/zero-risk-pro']);
function isTaskModel(model) { return typeof model === 'string' && taskModels.has(model); }
function taskModelForRequirement(requirement) {
  return isTaskModel(requirement?.requestedModel) ? requirement.requestedModel : null;
}

function validRecord(row) {
  return row && typeof row === 'object' && !Array.isArray(row)
    && (Object.keys(row).length === fields.length || (Object.keys(row).length === fields.length + 1 && Object.hasOwn(row, 'model')))
    && fields.every(key => Object.hasOwn(row, key))
    && (!Object.hasOwn(row, 'model') || row.model === null || taskModels.has(row.model))
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
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('Invalid task journal');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.records) || data.records.length > MAX_RECORDS
        || !data.records.every(validRecord) || new Set(data.records.map(row => row.id)).size !== data.records.length) {
        throw new Error('Invalid task journal');
      }
      this.records = data.records.map(row => ({ ...row, model: row.model ?? null, ...(row.terminal ? {} : {
        phase: 'interrupted', terminal: true, updatedAt: Math.max(row.updatedAt, this.clock()),
      }) }));
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
  snapshot() { return this.records.map(row => ({ ...row })); }
  start(traceId, tabId, progressVersion, model = null) {
    const now = this.clock();
    const record = { id: randomBytes(16).toString('hex'), traceId, tabId, model, createdAt: now, updatedAt: now,
      phase: 'preparing', submission: progressVersion === 1 ? 'not-sent' : 'unknown', sequence: 0, terminal: false };
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
  progress(id, phase, sequence) {
    const row = this.get(id);
    if (!row || row.terminal) throw new Error('Task is no longer active');
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
    this.save(this.records.map(item => item !== row ? item : {
      ...row, phase, submission, sequence, updatedAt: Math.max(row.updatedAt, this.clock()),
    }));
  }
  end(id, status) {
    const row = this.get(id);
    if (!row || row.terminal) return;
    if (!['completed', 'failed', 'aborted'].includes(status)) throw new Error('Invalid task outcome');
    const phase = status === 'completed' ? 'completed' : status === 'aborted' ? 'cancelled'
      : row.submission === 'not-sent' ? 'failed-before-send'
        : row.submission === 'accepted' || row.submission === 'context-accepted' ? 'failed-after-send' : 'send-uncertain';
    this.save(this.records.map(item => item !== row ? item : {
      ...row, phase, terminal: true, updatedAt: Math.max(row.updatedAt, this.clock()),
    }));
  }
  dismiss(id) {
    const row = this.get(id);
    if (!row || !row.terminal) throw new Error('Only a finished task can be dismissed');
    this.save(this.records.filter(item => item !== row));
  }
}
module.exports = { BrowserTaskLedger, taskModelForRequirement, isTaskModel };
