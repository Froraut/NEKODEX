import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync, openSync, fsyncSync, closeSync } from "node:fs";
import { join } from "node:path";
import { validNativeUsageEvent, type NativeUsageTelemetryEvent } from "./usage/native-contract";

const MAX_EVENTS = 512;
const MAX_AGE_MS = 23 * 60 * 60 * 1000; // Inside the receiver's 24-hour delivery window.
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Separate immutable event files let a successor replay unacknowledged receipts safely. */
export class NativeUsageOutbox {
  constructor(private directory: string, private clock = Date.now) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
      throw new Error('Invalid native usage outbox');
    }
  }
  pending(): NativeUsageTelemetryEvent[] {
    const events: NativeUsageTelemetryEvent[] = [];
    for (const name of readdirSync(this.directory)) {
      if (!name.endsWith('.json') || !idPattern.test(name.slice(0, -5))) continue;
      const file = join(this.directory, name);
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) continue;
        let e: unknown;
        try { e = JSON.parse(readFileSync(file, 'utf8')); }
        catch { unlinkSync(file); continue; }
        if (!validNativeUsageEvent(e) || `${e.eventId}.json` !== name
          || Date.parse(e.startedAt) + e.durationMs < this.clock() - MAX_AGE_MS
          || Date.parse(e.startedAt) + e.durationMs > this.clock() + 60_000) {
          unlinkSync(file);
          continue;
        }
        events.push(e);
      } catch { /* One malformed or concurrently acknowledged receipt cannot stop replay. */ }
    }
    events.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    while (events.length > MAX_EVENTS) this.acknowledge(events.shift()!.eventId);
    return events;
  }
  put(event: NativeUsageTelemetryEvent): void {
    if (!validNativeUsageEvent(event)) throw new Error('Invalid native usage event');
    const raw = JSON.stringify(event);
    if (Buffer.byteLength(raw) > 4096) throw new Error('Native usage event too large');
    const pending = this.pending();
    if (pending.some(e => e.eventId === event.eventId)) return;
    if (pending.length >= MAX_EVENTS) {
      this.acknowledge(pending[0]!.eventId);
      console.warn('[codex-chatgpt-web] native_usage_telemetry_dropped reason=capacity');
    }
    const target = join(this.directory, `${event.eventId}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, raw, { mode: 0o600, flag: 'wx' });
      const fd = openSync(temporary, "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, target);
    } finally { try { unlinkSync(temporary); } catch {} }
  }
  acknowledge(id: string): void {
    if (!idPattern.test(id)) throw new Error('Invalid native usage event id');
    try { unlinkSync(join(this.directory, `${id}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
