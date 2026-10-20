import { existsSync, mkdirSync, realpathSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertPrivatePath, createPrivateFile, readPrivate, syncDirectory } from './storage';
import { createHash } from 'node:crypto';
import type { VmNetworkLedger, VmNetworkReceipt, VmNetworkScope } from './network';

function check(ok: unknown): asserts ok { if (!ok) throw new Error('vm-network-ledger-invalid'); }
/** Immutable/fsynced reservation and terminal receipt files. O_EXCL arbitrates
 * concurrent processes; a crash after reservation remains unknown forever until
 * a separate externally evidenced reconciliation contract is implemented.
 * No receipt includes URLs, response bytes, headers or credential material. */
export class FileVmNetworkLedger implements VmNetworkLedger {
  constructor(readonly directory: string) {
    check(realpathSync(dirname(directory)) === dirname(directory));
    if (!existsSync(directory)) { mkdirSync(directory, { mode: 0o700 }); syncDirectory(dirname(directory)); }
    assertPrivatePath(directory, true);
  }
  private scopeDirectory(scope: VmNetworkScope, create = false): string {
    const key = createHash('sha256').update(JSON.stringify([scope.taskId, scope.generation, scope.actionId])).digest('hex');
    assertPrivatePath(this.directory, true);
    const path = join(this.directory, key);
    if (create && !existsSync(path)) { mkdirSync(path, { mode: 0o700 }); syncDirectory(this.directory); }
    if (existsSync(path)) assertPrivatePath(path, true);
    return path;
  }
  private path(key: string, scope: VmNetworkScope, terminal = false): string {
    check(/^[a-f0-9]{64}$/.test(key)); assertPrivatePath(this.directory, true);
    return join(this.scopeDirectory(scope), `${key}.${terminal ? 'receipt' : 'reservation'}.json`);
  }
  private decode(path: string, key: string): VmNetworkReceipt {
    const row = JSON.parse(readPrivate(path, 32 * 1024).toString('utf8')) as VmNetworkReceipt;
    check(row.version === 1 && row.requestKey === key && typeof row.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.fingerprint)
      && ['unknown', 'completed', 'never-sent'].includes(row.state));
    return row;
  }
  read(key: string, scope: VmNetworkScope): VmNetworkReceipt | undefined {
    const pending = this.path(key, scope), terminal = this.path(key, scope, true);
    if (!existsSync(pending)) { check(!existsSync(terminal)); return; }
    const original = this.decode(pending, key);
    check(original.scope.taskId === scope.taskId && original.scope.generation === scope.generation && original.scope.actionId === scope.actionId);
    if (!existsSync(terminal)) return original;
    const result = this.decode(terminal, key); check(result.fingerprint === original.fingerprint && result.grantId === original.grantId);
    return result;
  }
  assertScopeClear(scope: VmNetworkScope): void {
    const directory = this.scopeDirectory(scope);
    if (!existsSync(directory)) return;
    check(!existsSync(join(directory, 'active.json')));
    const entries = readdirSync(directory);
    check(entries.length <= 2000);
    for (const name of entries) {
      const match = /^([a-f0-9]{64})\.reservation\.json$/.exec(name);
      if (!match) continue;
      const receipt = this.read(match[1]!, scope);
      check(receipt && receipt.state !== 'unknown');
    }
  }
  reserve(receipt: VmNetworkReceipt): void {
    check(receipt.state === 'unknown');
    this.assertScopeClear(receipt.scope);
    const directory = this.scopeDirectory(receipt.scope, true);
    // O_EXCL scope gate arbitrates different request IDs across processes, too.
    // A crash at any later stage leaves the action closed to new requests.
    createPrivateFile(join(directory, 'active.json'), JSON.stringify({ requestKey: receipt.requestKey, fingerprint: receipt.fingerprint }));
    syncDirectory(directory);
    createPrivateFile(this.path(receipt.requestKey, receipt.scope), JSON.stringify(receipt)); syncDirectory(directory);
  }
  finish(receipt: VmNetworkReceipt): void {
    const existing = this.read(receipt.requestKey, receipt.scope);
    check(existing && existing.fingerprint === receipt.fingerprint && existing.grantId === receipt.grantId);
    const directory = this.scopeDirectory(receipt.scope);
    const active = JSON.parse(readPrivate(join(directory, 'active.json'), 2048).toString('utf8'));
    check(active.requestKey === receipt.requestKey && active.fingerprint === receipt.fingerprint);
    createPrivateFile(this.path(receipt.requestKey, receipt.scope, true), JSON.stringify(receipt)); syncDirectory(directory);
    if (receipt.state !== 'unknown') { unlinkSync(join(directory, 'active.json')); syncDirectory(directory); }
  }
}
