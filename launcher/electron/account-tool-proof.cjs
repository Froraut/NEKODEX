const fs = require('node:fs');
const path = require('node:path');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { validateAccountId } = require('./account-registry.cjs');

const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,80}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const MAX_JS_DATE_MILLISECONDS = 8_640_000_000_000_000;

function validProof(item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    && Number.isSafeInteger(item.at) && item.at > 0 && item.at <= MAX_JS_DATE_MILLISECONDS
    && typeof item.tool === 'string' && TOOL_NAME.test(item.tool)
    && (item.principalFingerprint === undefined || typeof item.principalFingerprint === 'string' && FINGERPRINT.test(item.principalFingerprint))
    && Object.keys(item).every(key => ['at', 'tool', 'principalFingerprint'].includes(key));
}

/**
 * The last completed task per account in which Codex returned a tool result without an error.
 * It is the observed fact behind "tools verified": the time and tool name only, never arguments,
 * output, prompts or task IDs. A proof belongs to the ChatGPT sign-in that produced it.
 */
class AccountToolProof {
  constructor(coreHome, clock = Date.now) {
    this.clock = clock;
    this.path = path.join(coreHome, 'account-tool-proof.json');
    this.state = {};
    try {
      const data = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      if (data.version !== 1 || !data.accounts || typeof data.accounts !== 'object' || Array.isArray(data.accounts)) throw new Error('Invalid tool proof state');
      for (const [id, item] of Object.entries(data.accounts)) {
        validateAccountId(id);
        // An unreadable entry only loses its proof; tool readiness never depends on it.
        if (validProof(item)) this.state[id] = item;
      }
    } catch { this.state = {}; }
  }
  record(id, tool, principalFingerprint) {
    validateAccountId(id);
    if (typeof tool !== 'string' || !TOOL_NAME.test(tool)) throw new Error('Invalid tool proof name');
    const item = { at: this.clock(), tool,
      ...(typeof principalFingerprint === 'string' && FINGERPRINT.test(principalFingerprint) ? { principalFingerprint } : {}) };
    this.write({ ...this.state, [id]: item });
  }
  forget(id) {
    if (!Object.hasOwn(this.state, id)) return;
    const { [id]: _removed, ...rest } = this.state;
    this.write(rest);
  }
  /** Shown only for the sign-in that produced it; a different or unknown principal hides it. */
  snapshot(id, principalFingerprint) {
    const item = this.state[id];
    if (!item) return null;
    if (item.principalFingerprint && item.principalFingerprint !== principalFingerprint) return null;
    return { at: item.at, tool: item.tool };
  }
  write(next) {
    writePrivateFileAtomic(this.path, JSON.stringify({ version: 1, accounts: next }) + '\n', { durable: true });
    this.state = next;
  }
}

module.exports = { AccountToolProof, TOOL_NAME };
