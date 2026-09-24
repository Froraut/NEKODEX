const ACCOUNT_READ_SETTLEMENT_TIMEOUT_MS = 10_000;
function printableLabel(label) {
  return typeof label === 'string' && label.trim().length > 0 && label.trim().length <= 80
    && !/[\u0000-\u001f\u007f]/.test(label);
}
function validateRead(label, cancel) {
  if (!printableLabel(label) || typeof cancel !== 'function') {
    throw new Error('Account read operation requires a printable label and cancellation callback');
  }
}
function validateExclusive(label) {
  if (!printableLabel(label)) throw new Error('Account operation label must contain 1 to 80 printable characters');
}
/** Owns leases only; account, workspace and handoff policy belongs to the pool. */
class AccountOperationLeases {
  #exclusive = new Map();
  #reads = new Map();
  readLabel(id) { return this.#reads.get(id)?.values().next().value?.label ?? null; }
  exclusiveLabel(id) { return this.#exclusive.get(id)?.label ?? null; }
  firstExclusiveLabel() { return this.#exclusive.values().next().value?.label ?? null; }
  acquireRead(id, label, cancel) {
    validateRead(label, cancel);
    this.#assertAvailable(this.exclusiveLabel(id));
    const token = Symbol('account-read-operation');
    let resolveSettled;
    const settled = new Promise(resolve => { resolveSettled = resolve; });
    const operation = Object.freeze({ label: label.trim(), cancel, settled });
    const reads = this.#reads.get(id) ?? new Map();
    reads.set(token, operation);
    this.#reads.set(id, reads);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.#reads.get(id);
      if (current?.get(token) === operation) {
        current.delete(token);
        if (!current.size) this.#reads.delete(id);
      }
      resolveSettled();
    };
  }
  #assertAvailable(label) {
    if (label) throw new Error(`This ChatGPT account is busy with ${label}; retry after it finishes`);
  }
  acquireExclusive(id, label) {
    validateExclusive(label);
    this.#assertAvailable(this.exclusiveLabel(id) || this.readLabel(id));
    const token = Symbol('account-operation');
    this.#exclusive.set(id, { label: label.trim(), token });
    return () => {
      if (this.#exclusive.get(id)?.token === token) this.#exclusive.delete(id);
    };
  }
  #cancelReads() {
    const reads = [...this.#reads.values()].flatMap(operations => [...operations.values()]);
    for (const read of reads) { try { read.cancel(); } catch {} }
    return reads;
  }
  async cancelAndDrain(timeoutMs = ACCOUNT_READ_SETTLEMENT_TIMEOUT_MS) {
    const reads = this.#cancelReads();
    let timer;
    try {
      await Promise.race([
        Promise.allSettled(reads.map(read => read.settled)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Account read cancellation timed out')), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally { clearTimeout(timer); }
  }
  destroy() {
    this.#exclusive.clear();
    this.#cancelReads();
    this.#reads.clear();
  }
}
module.exports = { AccountOperationLeases, validateRead, validateExclusive };
