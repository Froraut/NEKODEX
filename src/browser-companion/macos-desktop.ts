import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { validateToolScope } from '../agent-tools/journal';
import { desktopApplicationPropertiesSchema, type DesktopApplicationProperties } from './desktop-outcome';
import type { ToolScope } from '../agent-tools/types';
import { desktopActionSchema, desktopBindingOf, desktopBindingSchema, desktopObservationSchema,
  type DesktopAction, type DesktopBinding, type DesktopObservation, type DesktopProviderPort, type DesktopReceipt } from './providers';

const PROVIDER_ID = 'nekodex-macos-desktop-v1';
const MAX_REPLY = 12 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const macosWindowSelectionSchema = z.object({ windowId: z.string().max(10).regex(/^\d+$/), processId: z.string().max(32).regex(/^\d+:\d+$/), windowEpoch: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const windowSchema = macosWindowSelectionSchema.extend({ owner: z.string().max(160), title: z.string().max(512), foreground: z.boolean(),
  frame: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive().finite(), height: z.number().positive().finite() }).strict() }).strict();
/** The identity macOS judges permissions for. Self-responsible means the helper bundle itself
 * (a stable bundle ID and designated requirement); otherwise TCC judges the app or terminal
 * that started the runtime, and the UI must not direct the user to grant that. */
const permissionClientSchema = z.object({ selfResponsible: z.boolean(), bundleIdentifier: z.string().max(160).nullable(),
  name: z.string().max(160).nullable(), bundlePath: z.string().max(4096).nullable() }).strict();
const permissionFlags = { screenCaptureGranted: z.boolean(), accessibilityGranted: z.boolean(), postEventGranted: z.boolean() };
const statusSchema = z.object({ enabled: z.boolean(), providerId: z.literal(PROVIDER_ID), uncertain: z.boolean(), selected: windowSchema.nullable(),
  selectionCurrent: z.boolean(), inputWindowBound: z.boolean(), ...permissionFlags, permissionClient: permissionClientSchema }).strict();
export const desktopPermissionSchema = z.enum(['screenCapture', 'accessibility', 'postEvent']);
const permissionSettingsSchema = z.object({ ...permissionFlags, permissionClient: permissionClientSchema,
  pane: z.enum(['Privacy_ScreenCapture', 'Privacy_Accessibility']), registered: z.boolean() }).strict();
export type DesktopPermission = z.infer<typeof desktopPermissionSchema>;
export type DesktopPermissionClient = z.infer<typeof permissionClientSchema>;
export type DesktopPermissionSettings = z.infer<typeof permissionSettingsSchema>;
const receiptSchema = z.object({ operationId: z.string().uuid(), outcome: z.enum(['completed', 'rejected', 'unknown']), executed: z.boolean(), reason: z.string().max(240) }).strict();
export type MacosWindowSelection = z.infer<typeof macosWindowSelectionSchema>;
export type MacosWindowMetadata = z.infer<typeof windowSchema>;
export type MacosDesktopStatus = z.infer<typeof statusSchema>;
export interface NativeDesktopTransport {
  readonly activeCount?: number;
  request(command: 'status' | 'listWindows' | 'openPermissionSettings' | 'enable' | 'select' | 'observe' | 'image' | 'act' | 'invalidate' | 'properties', body?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
  readExistingReceipt?(operationId: string, binding: DesktopBinding): unknown | undefined;
  waitForIdle?(): Promise<void>;
}
class NativeRejection extends Error {}

/** One exact pinned native child and one bounded request at a time. No automatic process restart/replay. */
export class NativeDesktopHelperClient implements NativeDesktopTransport {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: { id: string; operationId?: string; resolve(value: unknown): void; reject(error: Error): void; cleanup(): void };
  private receipts = new Map<string, { binding: DesktopBinding; fingerprint: string; value?: unknown }>();
  private bytes = Buffer.alloc(0);
  private closed = false;
  private closing?: Promise<void>;
  private idleWaiters = new Set<() => void>();
  constructor(private readonly options: { executable: string; sha256: string; requestTimeoutMs?: number }) {}
  get activeCount(): number { return this.pending || this.closing && this.child && this.child.exitCode === null && this.child.signalCode === null ? 1 : 0; }
  private settleIdle() { if (this.activeCount === 0) { for (const resolve of this.idleWaiters) resolve(); this.idleWaiters.clear(); } }
  waitForIdle(): Promise<void> { return this.activeCount === 0 ? Promise.resolve() : new Promise(resolve => this.idleWaiters.add(resolve)); }
  private start() {
    if (this.closed) throw new Error('Native desktop helper is closed; no automatic restart');
    if (this.child) return this.child;
    const { executable, sha256 } = this.options;
    const stat = lstatSync(executable);
    if (process.platform !== 'darwin' || !isAbsolute(executable) || !stat.isFile() || stat.isSymbolicLink()
      || realpathSync(executable) !== executable || !(stat.mode & 0o111) || !/^[a-f0-9]{64}$/.test(sha256)
      || hash(readFileSync(executable)) !== sha256) throw new Error('Pinned macOS desktop helper is unavailable or changed');
    const child = spawn(executable, [], { shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdin.on('error', () => this.fail(new Error('Native desktop stdin delivery failed')));
    child.stdout.on('error', () => this.fail(new Error('Native desktop stdout failed')));
    child.stderr.on('data', () => {}); // Native diagnostics never become screenshot/text logs.
    child.stderr.on('error', () => {});
    child.stdout.on('data', (chunk: Buffer) => {
      this.bytes = Buffer.concat([this.bytes, chunk]);
      if (this.bytes.length > MAX_REPLY) { this.fail(new Error('Native desktop reply exceeds its bound')); return; }
      let newline: number;
      while ((newline = this.bytes.indexOf(10)) >= 0) {
        const line = this.bytes.subarray(0, newline); this.bytes = newline + 1 === this.bytes.length ? Buffer.alloc(0) : this.bytes.subarray(newline + 1);
        try {
          const reply: unknown = JSON.parse(line.toString('utf8'));
          const value = z.object({ version: z.literal(1), id: z.string().uuid(), ok: z.boolean(), value: z.unknown().optional(), error: z.string().max(100).optional() }).strict().parse(reply);
          const pending = this.pending;
          if (!pending || value.id !== pending.id || (value.ok ? !Object.hasOwn(value, 'value') || value.error !== undefined : !value.error || Object.hasOwn(value, 'value'))) throw new Error('Native desktop protocol owner mismatch');
          this.pending = undefined; pending.cleanup();
          if (pending.operationId) {
            const owned = this.receipts.get(pending.operationId);
            if (owned) owned.value = value.ok ? value.value : { operationId: pending.operationId, outcome: 'rejected', executed: false, reason: value.error };
          }
          if (value.ok) pending.resolve(value.value); else pending.reject(new NativeRejection(value.error));
          this.settleIdle();
        } catch (error) { this.fail(error instanceof Error ? error : new Error('Invalid native desktop frame')); return; }
      }
    });
    child.once('error', () => this.fail(new Error('Owned native desktop helper failed')));
    child.once('exit', () => {
      this.closed = true;
      this.child = undefined;
      if (this.pending) { const pending = this.pending; this.pending = undefined; pending.cleanup(); pending.reject(new Error('Owned native desktop helper exited')); }
      this.settleIdle();
    });
    return child;
  }
  private fail(error: Error) {
    const pending = this.pending; this.pending = undefined;
    if (pending) { pending.cleanup(); pending.reject(error); }
    void this.close();
  }
  async request(command: Parameters<NativeDesktopTransport['request']>[0], body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    if (Object.keys(body).some(key => ['version', 'id', 'command'].includes(key))) return Promise.reject(new Error('Native desktop body cannot override protocol ownership'));
    if (this.pending) return Promise.reject(new Error('Native desktop helper already owns a request'));
    let operationId: string | undefined;
    if (command === 'act') {
      operationId = z.string().uuid().parse(body.operationId);
      const binding = desktopBindingSchema.parse(body.binding);
      const fingerprint = hash(Buffer.from(JSON.stringify({ binding, action: desktopActionSchema.parse(body.action) })));
      const existing = this.receipts.get(operationId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) return Promise.reject(new NativeRejection('Native operation identity changed payload'));
        return existing.value !== undefined ? Promise.resolve(existing.value) : Promise.reject(new Error('Exact native operation has no terminal receipt; it will not be replayed'));
      }
      if (this.receipts.size >= 128) return Promise.reject(new NativeRejection('Native operation receipt capacity reached'));
      this.receipts.set(operationId, { binding, fingerprint });
    }
    const id = randomUUID();
    const line = JSON.stringify({ version: 1, id, command, ...body }) + '\n';
    if (Buffer.byteLength(line) > 64 * 1024) return Promise.reject(new NativeRejection('Native desktop request exceeds its bound'));
    const child = this.start();
    return new Promise((resolve, reject) => {
      const abort = () => this.fail(new Error('Native desktop request aborted; owned helper is stopping'));
      // Human foreground handoff and the helper's own enable confirmation have no consent
      // deadline here (the helper's alert has its own). Abort/close still stops its exact child.
      const waitsForHuman = (command === 'observe' && body.waitForForeground === true)
        || (command === 'act' && desktopActionSchema.parse(body.action).waitForForeground === true)
        || (command === 'enable' && body.enabled === true);
      const timeout = waitsForHuman ? undefined : setTimeout(() => {
        if (operationId) reject(new Error('Native input wait elapsed; exact owner and late receipt remain retained'));
        else this.fail(new Error('Native desktop observation timed out; owned helper is stopping'));
      }, this.options.requestTimeoutMs ?? 12000);
      this.pending = { id, operationId, resolve, reject, cleanup: () => { if (timeout !== undefined) clearTimeout(timeout); signal?.removeEventListener('abort', abort); } };
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.write(line, error => { if (error) this.fail(new Error('Native desktop request delivery failed')); });
      if (signal?.aborted) abort();
    });
  }
  readExistingReceipt(operationId: string, binding: DesktopBinding): unknown | undefined {
    const existing = this.receipts.get(operationId);
    return existing && JSON.stringify(existing.binding) === JSON.stringify(binding) ? existing.value : undefined;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const child = this.child;
    if (this.pending) { const pending = this.pending; this.pending = undefined; pending.cleanup(); pending.reject(new Error('Owned native desktop helper is closing')); }
    this.bytes = Buffer.alloc(0);
    this.closing = (child ? new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once('exit', () => { clearTimeout(escalate); resolve(); });
      child.stdin.end(); child.kill('SIGTERM');
      const escalate = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1500);
    }) : Promise.resolve()).finally(() => this.settleIdle());
    return this.closing;
  }
}

export interface MacosDesktopProvider extends DesktopProviderPort {
  passiveStatus(): { activeCount: number; uncertain: boolean; enabled: boolean; closed: boolean };
  waitForIdle(): Promise<void>;
  status(signal?: AbortSignal): Promise<MacosDesktopStatus>;
  listWindows(signal?: AbortSignal): Promise<MacosWindowMetadata[]>;
  /** Explicit user control: registers the helper's own identity for one permission and opens its exact pane. */
  openPermissionSettings(permission: DesktopPermission, explicitUserAction: boolean, signal?: AbortSignal): Promise<DesktopPermissionSettings>;
  setEnabled(enabled: boolean, explicitUserAction: boolean): Promise<void>;
  selectWindow(selection: MacosWindowSelection, explicitUserAction: boolean): Promise<void>;
  image(scope: ToolScope, observation: DesktopObservation, signal?: AbortSignal): Promise<{ mimeType: 'image/png'; base64: string; sha256: string }>;
  modelImage(scope: ToolScope, observation: DesktopObservation, signal?: AbortSignal): Promise<{ mimeType: 'image/jpeg'; base64: string; sha256: string; sourceScreenshotId: string; width: number; height: number }>;
  applicationProperties(scope: ToolScope, selection: MacosWindowSelection, signal?: AbortSignal): Promise<DesktopApplicationProperties>;
  actWithOperation(scope: ToolScope, binding: DesktopBinding, action: DesktopAction, operationId: string, signal?: AbortSignal): Promise<DesktopReceipt>;
  readExistingReceipt(operationId: string, binding: DesktopBinding, action?: DesktopAction): DesktopReceipt | undefined;
  close(): Promise<void>;
}
/** Trusted control methods are separate from model-facing observe/act. Neither accepts an executable/path. */
export function createMacosDesktopProvider(options: { helperExecutable: string; helperSha256: string;
  isScopeActive(scope: ToolScope): boolean; platform?: NodeJS.Platform;
  /** Trusted test/composition port; never read from renderer/model configuration. */
  transportFactory?: () => NativeDesktopTransport }): MacosDesktopProvider {
  const platform = options.platform ?? process.platform;
  let enabled = false; let closed = false; let busy = false; let uncertain = false; let generation = 0;
  let closingOwners = 0;
  let foregroundWaitAbort: AbortController | undefined;
  let selectedSelection: MacosWindowSelection | undefined;
  let latest: DesktopObservation | undefined; let transport: NativeDesktopTransport | undefined;
  const operations = new Map<string, { binding: DesktopBinding; actionHash: string; receipt?: DesktopReceipt }>();
  const idleWaiters = new Set<() => void>();
  const settleIdle = () => { if (provider.passiveStatus().activeCount === 0) { for (const resolve of idleWaiters) resolve(); idleWaiters.clear(); } };
  const scopeKey = (scope: ToolScope) => `${scope.taskId}\0${scope.generation}`;
  const native = () => {
    if (platform !== 'darwin' || closed) throw new Error('Native desktop provider is unavailable on this platform');
    return transport ??= options.transportFactory?.() ?? new NativeDesktopHelperClient({ executable: options.helperExecutable, sha256: options.helperSha256 });
  };
  const active = (scope: ToolScope) => {
    validateToolScope(scope);
    if (!enabled || closed || uncertain || !options.isScopeActive(scope)) throw new Error('Native desktop scope is disabled, stopped or uncertain');
  };
  const status = async (signal?: AbortSignal) => statusSchema.parse(await native().request('status', {}, signal));
  const provider: MacosDesktopProvider = {
    passiveStatus: () => ({ activeCount: Math.max(busy ? 1 : 0, transport?.activeCount ?? 0, closingOwners), uncertain, enabled, closed }),
    async waitForIdle() {
      const current = transport;
      if ((current?.activeCount ?? 0) > 0 && current?.waitForIdle) await current.waitForIdle();
      if (provider.passiveStatus().activeCount > 0) await new Promise<void>(resolve => idleWaiters.add(resolve));
    },
    status,
    async listWindows(signal) { return z.object({ windows: z.array(windowSchema).max(128) }).strict().parse(await native().request('listWindows', {}, signal)).windows; },
    async openPermissionSettings(permission, explicitUserAction, signal) {
      if (!explicitUserAction) throw new Error('Explicit permission settings action required');
      return permissionSettingsSchema.parse(await native().request('openPermissionSettings', { permission: desktopPermissionSchema.parse(permission) }, signal));
    },
    async setEnabled(value, explicitUserAction) {
      if (!explicitUserAction || typeof value !== 'boolean' || closed) throw new Error('Explicit desktop capture/input preference required');
      if (value && (uncertain || busy)) throw new Error('Reconcile the current native operation before enabling another input owner');
      const revision = ++generation; latest = undefined; selectedSelection = undefined; enabled = false;
      if (!value) {
        const previous = transport; transport = undefined;
        if (previous) { closingOwners++; try { await previous.close(); } finally { closingOwners--; settleIdle(); } }
        return;
      }
      busy = true;
      try {
        const result = z.object({ enabled: z.literal(true) }).strict().parse(await native().request('enable', { enabled: true }));
        if (closed || generation !== revision) throw new Error('Native enable authority was revoked while enabling');
        enabled = result.enabled;
      } finally { busy = false; settleIdle(); }
    },
    async selectWindow(value, explicitUserAction) {
      if (!explicitUserAction || !enabled || busy || uncertain) throw new Error('Explicit selected-window authority is required');
      const selection = macosWindowSelectionSchema.parse(value);
      const revision = ++generation; latest = undefined; selectedSelection = undefined; busy = true;
      try {
        const value = z.object({ selected: windowSchema, inputWindowBound: z.boolean() }).strict().parse(await native().request('select', { selection }));
        if (!enabled || closed || generation !== revision || JSON.stringify(macosWindowSelectionSchema.parse({
          windowId: value.selected.windowId, processId: value.selected.processId, windowEpoch: value.selected.windowEpoch,
        })) !== JSON.stringify(selection)) throw new Error('Native selected-window authority changed');
        selectedSelection = selection;
      } finally { busy = false; settleIdle(); }
    },
    async capabilities(scope, signal) {
      try {
        active(scope); const value = await status(signal);
        const available = value.enabled && value.screenCaptureGranted && value.accessibilityGranted && value.inputWindowBound && value.selectionCurrent && !value.uncertain;
        return { available, platform: 'darwin', ...(!available ? { reason: 'Enable the provider, grant OS permissions to NEKODEX Desktop Helper in System Settings and select the exact accessible window; post-event permission is needed only for foreground pixel fallback' } : {}) };
      } catch { return { available: false, platform: 'darwin', reason: 'Native macOS desktop owner or permissions are unavailable; no capture/input was sent' }; }
    },
    async observe(scope, signal, waitForForeground) {
      active(scope); if (busy) throw new Error('Native desktop operation is active');
      const revision = generation; busy = true; latest = undefined;
      const waitAbort = waitForForeground ? new AbortController() : undefined;
      if (waitAbort) foregroundWaitAbort = waitAbort;
      const requestSignal = waitAbort ? signal ? AbortSignal.any([signal, waitAbort.signal]) : waitAbort.signal : signal;
      try {
        const value = desktopObservationSchema.parse(await native().request('observe', { scopeId: scopeKey(scope), ...(waitForForeground ? { waitForForeground: true } : {}) }, requestSignal));
        active(scope);
        if (generation !== revision || value.providerId !== PROVIDER_ID || value.platform !== 'darwin' || value.scopeId !== scopeKey(scope)
          || !/^[a-f0-9]{64}$/.test(value.screenshotId) || !value.screenshotResource.startsWith('native-desktop:')) throw new Error('Native observation changed owner, scope or generation');
        latest = value; return structuredClone(value);
      } finally { if (foregroundWaitAbort === waitAbort) foregroundWaitAbort = undefined; busy = false; settleIdle(); }
    },
    async image(scope, observationValue, signal) {
      active(scope); const observation = desktopObservationSchema.parse(observationValue);
      if (!latest || JSON.stringify(observation) !== JSON.stringify(latest) || observation.scopeId !== scopeKey(scope)) throw new Error('Native image resource has no current observation owner');
      const value = z.object({ mimeType: z.literal('image/png'), base64: z.string().max(MAX_REPLY), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
        .parse(await native().request('image', { binding: desktopBindingOf(observation), resource: observation.screenshotResource, encoding: 'png' }, signal));
      active(scope); if (!latest || JSON.stringify(latest) !== JSON.stringify(observation)) throw new Error('Native image owner changed');
      const bytes = Buffer.from(value.base64, 'base64');
      if (bytes.length > 8 * 1024 * 1024 || bytes.length < 24 || bytes.toString('base64') !== value.base64
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || bytes.readUInt32BE(16) !== observation.width || bytes.readUInt32BE(20) !== observation.height
        || hash(bytes) !== value.sha256 || value.sha256 !== observation.screenshotId) {
        latest = undefined; generation++; throw new Error('Native screenshot bytes do not match their exact observation');
      }
      return value;
    },
    async modelImage(scope, observationValue, signal) {
      active(scope); const observation = desktopObservationSchema.parse(observationValue);
      if (!latest || JSON.stringify(observation) !== JSON.stringify(latest) || observation.scopeId !== scopeKey(scope)) throw new Error('Native model image has no current observation owner');
      const value = z.object({ mimeType: z.literal('image/jpeg'), base64: z.string().max(220000), sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sourceScreenshotId: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive() }).strict()
        .parse(await native().request('image', { binding: desktopBindingOf(observation), resource: observation.screenshotResource, encoding: 'jpeg' }, signal));
      active(scope);
      const bytes = Buffer.from(value.base64, 'base64'); const dimensions = jpegDimensions(bytes);
      if (!latest || JSON.stringify(latest) !== JSON.stringify(observation) || bytes.length > 160 * 1024
        || bytes.toString('base64') !== value.base64 || value.sourceScreenshotId !== observation.screenshotId || hash(bytes) !== value.sha256
        || value.width !== observation.width || value.height !== observation.height || dimensions?.width !== observation.width || dimensions.height !== observation.height) {
        latest = undefined; generation++; throw new Error('Native model image does not match the source screenshot and dimensions');
      }
      return value;
    },
    async applicationProperties(scope, selectionValue, signal) {
      active(scope); if (busy) throw new Error('Native desktop operation is active');
      const selection = macosWindowSelectionSchema.parse(selectionValue);
      if (!selectedSelection || JSON.stringify(selection) !== JSON.stringify(selectedSelection)) throw new Error('Native application properties require the exact selected window');
      const revision = generation; busy = true;
      try {
        const snapshot = desktopApplicationPropertiesSchema.parse(await native().request('properties', { selection }, signal));
        active(scope);
        if (revision !== generation || JSON.stringify(snapshot.selection) !== JSON.stringify(selection)) throw new Error('Native application property owner changed');
        return structuredClone(snapshot);
      } finally { busy = false; settleIdle(); }
    },
    act(scope, binding, action, signal) { return provider.actWithOperation(scope, binding, action, randomUUID(), signal); },
    async actWithOperation(scope, bindingValue, actionValue, operationIdValue, signal) {
      active(scope); if (busy) throw new Error('Native desktop operation is active');
      const binding = desktopBindingSchema.parse(bindingValue); const action: DesktopAction = desktopActionSchema.parse(actionValue);
      const operationId = z.string().uuid().parse(operationIdValue);
      const actionHash = hash(Buffer.from(JSON.stringify(action)));
      const existing = operations.get(operationId);
      if (existing) {
        if (existing.actionHash !== actionHash || JSON.stringify(existing.binding) !== JSON.stringify(binding)) throw new Error('Native operation changed its original payload');
        const receipt = provider.readExistingReceipt(operationId, binding);
        if (receipt) return receipt;
        throw new Error('Existing native operation will not be replayed; retain its uncertain owner');
      }
      if (!latest || binding.scopeId !== scopeKey(scope) || JSON.stringify(binding) !== JSON.stringify(desktopBindingOf(latest))) throw new Error('Stale or foreign native desktop observation');
      if (action.kind === 'click' && (action.x >= binding.width || action.y >= binding.height)) throw new Error('Native click lies outside the captured screenshot');
      if (action.kind === 'type' && !action.text) throw new Error('Literal desktop text must not be empty');
      if (operations.size >= 128) throw new Error('Native receipt capacity reached; retained operations are preserved');
      operations.set(operationId, { binding, actionHash });
      let offered = false; busy = true;
      const waitAbort = action.waitForForeground ? new AbortController() : undefined;
      if (waitAbort) foregroundWaitAbort = waitAbort;
      const requestSignal = waitAbort ? signal ? AbortSignal.any([signal, waitAbort.signal]) : waitAbort.signal : signal;
      try {
        requestSignal?.throwIfAborted(); active(scope); latest = undefined; offered = true;
        const value: DesktopReceipt = receiptSchema.parse(await native().request('act', { operationId, binding, action }, requestSignal));
        if (value.operationId !== operationId || value.outcome === 'completed' && !value.executed || value.outcome === 'rejected' && value.executed) throw new Error('Native input receipt changed operation identity/outcome');
        uncertain = value.outcome === 'unknown'; operations.get(operationId)!.receipt = value; return value;
      } catch (error) {
        if (error instanceof NativeRejection) {
          const receipt: DesktopReceipt = { operationId, outcome: 'rejected', executed: false, reason: error.message.slice(0, 240) };
          operations.get(operationId)!.receipt = receipt; return receipt;
        }
        uncertain ||= offered;
        const receipt: DesktopReceipt = { operationId, outcome: offered ? 'unknown' : 'not_sent', executed: false, reason: 'Native input delivery lacks a terminal receipt; reconcile this exact operation before further input' };
        operations.get(operationId)!.receipt = receipt; return receipt;
      } finally { if (foregroundWaitAbort === waitAbort) foregroundWaitAbort = undefined; busy = false; settleIdle(); }
    },
    readExistingReceipt(operationIdValue, bindingValue, actionValue) {
      const operationId = z.string().uuid().parse(operationIdValue); const binding = desktopBindingSchema.parse(bindingValue);
      const existing = operations.get(operationId);
      if (!existing || JSON.stringify(existing.binding) !== JSON.stringify(binding)) return undefined;
      if (actionValue !== undefined && existing.actionHash !== hash(Buffer.from(JSON.stringify(desktopActionSchema.parse(actionValue))))) return undefined;
      const raw = transport?.readExistingReceipt?.(operationId, binding);
      if (raw !== undefined) {
        const parsed = receiptSchema.safeParse(raw);
        if (parsed.success && parsed.data.operationId === operationId
          && !(parsed.data.outcome === 'completed' && !parsed.data.executed || parsed.data.outcome === 'rejected' && parsed.data.executed)) existing.receipt = parsed.data;
      }
      uncertain = [...operations.values()].some(operation => operation.receipt?.outcome === 'unknown' || !operation.receipt);
      settleIdle();
      return existing.receipt ? structuredClone(existing.receipt) : undefined;
    },
    invalidate() { foregroundWaitAbort?.abort(); generation++; latest = undefined; if (!busy && transport) void transport.request('invalidate').catch(() => {}); },
    async close() {
      closed = true; enabled = false; generation++; latest = undefined; selectedSelection = undefined; const previous = transport; transport = undefined;
      if (previous) { closingOwners++; try { await previous.close(); } finally { closingOwners--; settleIdle(); } }
    },
  };
  return provider;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) return undefined;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const length = bytes.readUInt16BE(offset); if (length < 2 || offset + length > bytes.length) return undefined;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    offset += length;
  }
  return undefined;
}
