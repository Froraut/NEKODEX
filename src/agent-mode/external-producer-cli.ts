import { stdin, stdout } from 'node:process';
import { closeSync, constants, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { directLoopbackRequest } from '../local-control-api/client';
import { snapshotFile, writeFileSnapshot } from '../file-transactions';
import { LOOP_PRODUCER_TOKEN, producerDigest, producerEventSchema, type ProducerEvent } from './external-producer-types';
interface Outbox {
  version: 1; origin: string; event: ProducerEvent; fingerprint: string;
  state: 'unknown' | 'accepted' | 'unchanged' | 'not_started'; receipt?: unknown; error?: string;
}
export interface LoopProducerClientOptions {
  origin: string; journalDirectory: string;
  /** Fixture seam only. One POST; no implicit retry after durable intent. */
  request?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number;
}
const identity = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const unavailable = () => { throw new Error('External producer journal or exact receipt is unavailable; never replay the submission'); };
/** One-submit named producer. Reopening an event only permits receipt GET. */
export class NekodexLoopEventProducer {
  private readonly origin: string; private readonly directory: string;
  constructor(private readonly options: LoopProducerClientOptions) {
    if (!/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/?$/.test(options.origin)) throw new Error('Use one exact loopback core origin');
    const target = new URL(options.origin); if (!Number(target.port) || Number(target.port) > 65535) throw new Error('Invalid loopback port');
    this.origin = target.origin; this.directory = resolve(options.journalDirectory);
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000)) throw new Error('Invalid producer observation wait');
  }
  private checkDirectory(create = false) {
    if (process.platform === 'win32') unavailable();
    if (create) mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077 || realpathSync(this.directory) !== this.directory) unavailable();
  }
  private path(producerId: string, eventId: string) {
    if (!identity.test(producerId) || !identity.test(eventId)) throw new Error('Invalid producer event identity');
    return join(this.directory, producerDigest([this.origin, producerId, eventId]) + '.json');
  }
  private read(file: string): Outbox {
    this.checkDirectory(); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > 64 * 1024) unavailable();
      const row = JSON.parse(readFileSync(fd, 'utf8')) as Outbox;
      if (row.version !== 1 || row.origin !== this.origin || producerDigest(row.event) !== row.fingerprint
        || !['unknown', 'accepted', 'unchanged', 'not_started'].includes(row.state)) unavailable();
      producerEventSchema.parse(row.event); return row;
    } finally { closeSync(fd); }
  }
  private async send(method: 'POST' | 'GET', event: ProducerEvent, token: string) {
    if (!LOOP_PRODUCER_TOKEN.test(token)) throw new Error('Provide one producer credential through stdin');
    if (JSON.stringify(event).includes(token) || this.directory.includes(token)) throw new Error('Credentials cannot be part of producer metadata');
    const path = method === 'POST' ? '/api/loop-events/v1/events' : `/api/loop-events/v1/receipts/${event.producerId}/${event.eventId}`;
    const response = await (this.options.request ?? directLoopbackRequest)(this.origin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
      headers: { authorization: 'Bearer ' + token, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(event) } : {}),
    });
    const reader = response.body?.getReader(); if (!reader) return unavailable(); let size = 0; const chunks: Uint8Array[] = [];
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32 * 1024) { await reader.cancel(); unavailable(); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (JSON.stringify(result).includes(token)) unavailable();
    return { result, ok: response.ok };
  }
  private save(file: string, row: Outbox, packet: { result: any; ok: boolean }, receiptOnly: boolean): Outbox {
    const value = packet.result?.value, receipt = value?.receipt;
    let next = { ...row };
    if (packet.ok && packet.result?.ok === true && receipt && receipt.producerId === row.event.producerId && receipt.eventId === row.event.eventId
      && receipt.sourceEventKey === row.event.sourceEventKey && receipt.observationDigest === producerDigest({ subject: row.event.subject, observationText: row.event.observationText })
      && typeof receipt.taskId === 'string' && Number.isSafeInteger(receipt.generation) && Number.isSafeInteger(receipt.revision) && Number.isSafeInteger(receipt.createdAt)
      && ['accepted', 'unchanged'].includes(receipt.state)) {
      // Persist only a fixed safe projection. Unknown remote fields never enter the CLI journal/output.
      const safe = { producerId: receipt.producerId, eventId: receipt.eventId, sourceEventKey: receipt.sourceEventKey,
        state: receipt.state, ...(typeof receipt.workId === 'string' ? { workId: receipt.workId } : {}), ...(typeof receipt.workKey === 'string' ? { workKey: receipt.workKey } : {}),
        observationDigest: receipt.observationDigest, taskId: receipt.taskId, generation: receipt.generation, revision: receipt.revision, createdAt: receipt.createdAt };
      next = { ...row, state: receipt.state, receipt: safe }; delete next.error;
    } else if (!receiptOnly && !packet.ok && packet.result?.ok === false && packet.result?.outcome === 'not_started') {
      next = { ...row, state: 'not_started', error: 'Producer request was refused before admission' };
    }
    const before = snapshotFile(file), current = this.read(file);
    if (current.fingerprint !== row.fingerprint) unavailable();
    // A late failed/absent observation never overwrites an established terminal receipt.
    if (['accepted', 'unchanged'].includes(current.state) && !['accepted', 'unchanged'].includes(next.state)) return current;
    writeFileSnapshot(before, JSON.stringify(next) + '\n', { expectedSnapshot: before }); return next;
  }
  async publish(value: unknown, token: string): Promise<Outbox> {
    let event: ProducerEvent;
    try { event = producerEventSchema.parse(value); } catch { throw new Error('Invalid bounded producer observation'); }
    if (this.directory.includes(token) || !LOOP_PRODUCER_TOKEN.test(token) || /nk-loop-[a-f0-9]{64}/.test(JSON.stringify(event))) throw new Error('Producer credentials must not appear in event data');
    this.checkDirectory(true); const file = this.path(event.producerId, event.eventId), fingerprint = producerDigest(event);
    const row: Outbox = { version: 1, origin: this.origin, event, fingerprint, state: 'unknown' };
    let fd;
    try { fd = openSync(file, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = this.read(file); if (existing.fingerprint !== fingerprint) throw new Error('Producer event identity conflict');
      return this.receipt(event.producerId, event.eventId, token);
    }
    try { writeFileSync(fd, JSON.stringify(row) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    const parent = openSync(this.directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
    try { return this.save(file, row, await this.send('POST', event, token), false); }
    catch { return this.read(file); }
  }
  async receipt(producerId: string, eventId: string, token: string): Promise<Outbox> {
    const file = this.path(producerId, eventId), row = this.read(file);
    if (!LOOP_PRODUCER_TOKEN.test(token)) throw new Error('Provide one producer credential through stdin');
    try { return this.save(file, row, await this.send('GET', row.event, token), true); }
    catch { return this.read(file); }
  }
}
/** Nonblocking open precedes the regular-file check: a FIFO with no writer must
 * never hang this CLI before its HTTP observation timeout can even begin. */
function readProducerEventFile(file: string): unknown {
  const rejected = () => new Error('Choose one unchanged bounded regular event file');
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } catch { throw rejected(); }
  let text: string;
  try {
    const before = fstatSync(fd), firstPath = lstatSync(file);
    if (!before.isFile() || !firstPath.isFile() || firstPath.isSymbolicLink() || before.size > 32 * 1024
      || firstPath.dev !== before.dev || firstPath.ino !== before.ino) throw rejected();
    const buffer = Buffer.alloc(32 * 1024 + 1); let count = 0;
    while (count < buffer.length) { const size = readSync(fd, buffer, count, buffer.length - count, null); if (!size) break; count += size; }
    const after = fstatSync(fd), lastPath = lstatSync(file);
    if (count !== before.size || count > 32 * 1024 || !after.isFile() || !lastPath.isFile() || lastPath.isSymbolicLink()
      || [after, lastPath].some(stat => stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size
        || stat.mode !== before.mode || stat.nlink !== before.nlink || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs)) throw rejected();
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count)); } catch { throw new Error('Invalid producer event UTF-8'); }
  } finally { closeSync(fd); }
  if (/nk-loop-[a-f0-9]{64}/.test(text)) throw new Error('Credentials must not appear in event data');
  try { return JSON.parse(text); } catch { throw new Error('Invalid producer event JSON'); }
}
/** Existing bundled CLI only; no service startup, endpoint discovery or web fetch. */
export async function loopEventProducerCommand(args: readonly string[]): Promise<boolean> {
  const usage = 'Usage: codex-chatgpt-web loop-events <publish|receipt> --origin http://127.0.0.1:PORT --journal-dir PATH --token-stdin; publish --event-file PATH; receipt --producer-id ID --event-id ID';
  const [operation, ...rest] = args; if (!['publish', 'receipt'].includes(operation ?? '') || stdin.isTTY) throw new Error(usage);
  const allowed = new Set(['--origin', '--journal-dir', ...(operation === 'publish' ? ['--event-file'] : ['--producer-id', '--event-id'])]);
  const values = new Map<string, string>(); let piped = false;
  for (let i = 0; i < rest.length; i++) { const key = rest[i]!;
    if (key === '--token-stdin') { if (piped) throw new Error(usage); piped = true; continue; }
    const value = rest[++i]; if (!allowed.has(key) || values.has(key) || !value || value.startsWith('--')) throw new Error(usage); values.set(key, value);
  }
  if (!piped || [...allowed].some(key => !values.has(key))) throw new Error(usage);
  const chunks: Buffer[] = []; let bytes = 0, token;
  try { for await (const chunk of stdin) { bytes += chunk.length; if (bytes > 1024) throw new Error(usage); chunks.push(Buffer.from(chunk)); }
    token = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).replace(/\r?\n$/, '');
  } finally { for (const chunk of chunks) chunk.fill(0); }
  if (!LOOP_PRODUCER_TOKEN.test(token) || args.some(value => value.includes(token))) throw new Error('Provide one producer credential on stdin only');
  const client = new NekodexLoopEventProducer({ origin: values.get('--origin')!, journalDirectory: values.get('--journal-dir')! });
  let result;
  if (operation === 'publish') {
    const event = readProducerEventFile(values.get('--event-file')!);
    result = await client.publish(event, token);
  } else result = await client.receipt(values.get('--producer-id')!, values.get('--event-id')!, token);
  const output = JSON.stringify(result); if (output.includes(token)) unavailable(); stdout.write(output + '\n');
  return ['accepted', 'unchanged'].includes(result.state);
}
