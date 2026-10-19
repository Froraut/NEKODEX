import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createMacosDesktopProvider, NativeDesktopHelperClient, type NativeDesktopTransport } from '../src/browser-companion/macos-desktop';
import { desktopBindingOf } from '../src/browser-companion/providers';
import type { ToolScope } from '../src/agent-tools/types';
const scope: ToolScope = { taskId: 'owned-task', generation: 1, toolCallId: 'desktop-call' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  let enabled = false; let selected = false; let uncertain = false; let active = true; let corrupt = false;
  let foreign = false; let foreignProperties = false; let closed = 0; const calls: string[] = [];
  const requests: { command: string; body: Record<string, unknown> }[] = [];
  let holdForeground = false; let expired = false; let pendingOperation: { operationId: string; binding: unknown } | undefined; let lateReceipt: unknown;
  // Marker-only synthetic bytes exercise dimension/hash ownership; native codec/rendering is a separate Cua flow.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 0, 0xff, 0xd9]);
  const selection = { windowId: '1', processId: '1:100', windowEpoch: 'a'.repeat(64) };
  const window = { ...selection, owner: 'Owned fixture', title: 'Synthetic window', foreground: false, frame: { x: 10, y: 10, width: 1, height: 1 } };
  const transport: NativeDesktopTransport = {
    get activeCount() { return pendingOperation && !lateReceipt ? 1 : 0; },
    async request(command, body = {}, signal) {
      calls.push(command); requests.push({ command, body: structuredClone(body) });
      if (command === 'observe' && body.waitForForeground === true && holdForeground) return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('fixture foreground wait aborted'));
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      });
      if (command === 'enable') { enabled = body.enabled as boolean; return { enabled }; }
      if (command === 'status') return { providerId: 'nekodex-macos-desktop-v1', enabled, uncertain: false,
        selected: selected ? window : null, selectionCurrent: selected, inputWindowBound: selected,
        screenCaptureGranted: true, accessibilityGranted: true, postEventGranted: false };
      if (command === 'listWindows') return { windows: [window] };
      if (command === 'select') { selected = true; return { selected: window, inputWindowBound: true }; }
      if (command === 'observe') return { kind: 'desktop', providerId: foreign ? 'foreign-provider' : 'nekodex-macos-desktop-v1',
        scopeId: body.scopeId, observationId: randomUUID(), platform: 'darwin', ...selection,
        frameId: 'window-1', frameEpoch: 'b'.repeat(64), screenshotId: digest(png), coordinateSpace: 'screenshot-pixels', width: 1, height: 1,
        screenshotResource: 'native-desktop:synthetic-owned-image' };
      if (command === 'properties') return { selection: foreignProperties ? { ...selection, windowId: '2' } : selection, observedAt: new Date().toISOString(), properties: [{ elementId: 'ax-stable-id', role: 'AXStaticText', value: 'Counter: 1' }] };
      if (command === 'image') return body.encoding === 'jpeg' ? { mimeType: 'image/jpeg', base64: jpeg.toString('base64'), sha256: digest(jpeg),
        sourceScreenshotId: corrupt ? '0'.repeat(64) : digest(png), width: 1, height: 1 } : { mimeType: 'image/png', base64: png.toString('base64'), sha256: corrupt ? '0'.repeat(64) : digest(png) };
      if (command === 'act') {
        if (expired) { pendingOperation = { operationId: body.operationId as string, binding: body.binding }; throw new Error('wait elapsed; input owner retained'); }
        return { operationId: body.operationId, outcome: uncertain ? 'unknown' : 'completed', executed: !uncertain, reason: 'ax-dispatched; result-unverified' };
      }
      if (command === 'invalidate') return { invalidated: true };
      throw new Error('Unexpected fixture command');
    },
    async close() { closed++; },
    readExistingReceipt(operationId, binding) { return operationId === pendingOperation?.operationId && JSON.stringify(binding) === JSON.stringify(pendingOperation.binding) ? lateReceipt : undefined; },
  };
  const provider = createMacosDesktopProvider({ helperExecutable: '/unlaunched-fixture-helper', helperSha256: 'a'.repeat(64),
    platform: 'darwin', isScopeActive: () => active, transportFactory: () => transport });
  return { provider, calls, requests, selection, unknown: () => { uncertain = true; }, foreign: () => { foreign = true; },
    corrupt: () => { corrupt = true; }, foreignProperties: () => { foreignProperties = true; }, stop: () => { active = false; }, closed: () => closed,
    holdForeground: () => { holdForeground = true; }, expireWait: () => { expired = true; }, completeLate: () => { lateReceipt = { operationId: pendingOperation!.operationId, outcome: 'completed', executed: true, reason: 'late ax dispatch receipt; result-unverified' }; } };
}

test('native provider defaults off and preserves exact observation ownership; AX input does not require post-event permission', async () => {
  const f = fixture();
  expect((await f.provider.capabilities(scope)).available).toBe(false); expect(f.calls).toEqual([]);
  await expect(f.provider.setEnabled(true, false)).rejects.toThrow('Explicit');
  await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true);
  expect((await f.provider.capabilities(scope)).available).toBe(true);
  const observed = await f.provider.observe(scope); const binding = desktopBindingOf(observed);
  expect((await f.provider.image(scope, observed)).sha256).toBe(observed.screenshotId);
  expect(await f.provider.modelImage(scope, observed)).toMatchObject({ mimeType: 'image/jpeg', sourceScreenshotId: observed.screenshotId, width: observed.width, height: observed.height });
  for (const changed of [{ ...binding, processId: '2:200' }, { ...binding, windowId: '2' }, { ...binding, frameEpoch: 'c'.repeat(64) }, { ...binding, screenshotId: 'd'.repeat(64) }]) {
    await expect(f.provider.act(scope, changed, { kind: 'click', x: 0, y: 0 })).rejects.toThrow('Stale');
  }
  await expect(f.provider.act(scope, binding, { kind: 'click', x: 1, y: 0 })).rejects.toThrow('outside');
  expect(f.calls.filter(command => command === 'act')).toHaveLength(0);
  expect(await f.provider.act(scope, binding, { kind: 'click', x: 0, y: 0 })).toMatchObject({ outcome: 'completed', executed: true, reason: 'ax-dispatched; result-unverified' });
  await expect(f.provider.act(scope, binding, { kind: 'click', x: 0, y: 0 })).rejects.toThrow('Stale');
  expect(f.calls.filter(command => command === 'act')).toHaveLength(1);
  await f.provider.close(); expect(f.closed()).toBe(1);
});

test('stable native operation retains an unknown wait and reconciles only its late receipt without new native work', async () => {
  const f = fixture(); await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true);
  const observed = await f.provider.observe(scope); const binding = desktopBindingOf(observed); const operationId = randomUUID(); f.expireWait();
  expect((await f.provider.actWithOperation(scope, binding, { kind: 'click', x: 0, y: 0 }, operationId)).outcome).toBe('unknown');
  const before = f.calls.length;
  expect(f.provider.readExistingReceipt(randomUUID(), binding)).toBeUndefined();
  expect(f.provider.readExistingReceipt(operationId, { ...binding, windowId: 'foreign' })).toBeUndefined();
  expect(f.provider.readExistingReceipt(operationId, binding, { kind: 'type', text: 'foreign action' })).toBeUndefined();
  expect(f.provider.readExistingReceipt(operationId, binding)?.outcome).toBe('unknown');
  expect(f.provider.passiveStatus()).toMatchObject({ activeCount: 1, uncertain: true, enabled: true });
  let idle = false; const waiting = f.provider.waitForIdle().then(() => { idle = true; }); await Promise.resolve(); expect(idle).toBe(false);
  expect(f.calls).toHaveLength(before); expect(f.closed()).toBe(0);
  f.completeLate();
  expect(f.provider.readExistingReceipt(operationId, binding)).toMatchObject({ operationId, outcome: 'completed', executed: true });
  expect(f.provider.passiveStatus()).toMatchObject({ activeCount: 0, uncertain: false, enabled: true });
  await waiting; expect(idle).toBe(true);
  expect(f.calls).toHaveLength(before);
  await f.provider.observe(scope); expect(f.calls.filter(command => command === 'act')).toHaveLength(1);
  await f.provider.close();
});

test('unknown native dispatch remains latched after invalidation/disable and corrupt images revoke input bindings', async () => {
  const f = fixture(); await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true);
  const observed = await f.provider.observe(scope); f.unknown();
  expect((await f.provider.act(scope, desktopBindingOf(observed), { kind: 'type', text: 'synthetic literal' })).outcome).toBe('unknown');
  f.provider.invalidate(); await expect(f.provider.observe(scope)).rejects.toThrow('uncertain');
  await f.provider.setEnabled(false, true); await expect(f.provider.setEnabled(true, true)).rejects.toThrow('Reconcile');
  expect(f.calls.filter(command => command === 'act')).toHaveLength(1); await f.provider.close();
  const image = fixture(); await image.provider.setEnabled(true, true); await image.provider.selectWindow(image.selection, true);
  const view = await image.provider.observe(scope); image.corrupt();
  await expect(image.provider.image(scope, view)).rejects.toThrow('screenshot bytes');
  await expect(image.provider.act(scope, desktopBindingOf(view), { kind: 'click', x: 0, y: 0 })).rejects.toThrow('Stale');
  expect(image.calls.filter(command => command === 'act')).toHaveLength(0); await image.provider.close();
});

test('foreign native observations and stopped task scopes cannot acquire input authority', async () => {
  const f = fixture(); await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true); f.foreign();
  await expect(f.provider.observe(scope)).rejects.toThrow('changed owner'); f.stop();
  expect((await f.provider.capabilities(scope)).available).toBe(false); await f.provider.close();
});


test('application property readback requires exact selected authority and preserves fresh native identity without capturing', async () => {
  const f = fixture();
  await expect(f.provider.applicationProperties(scope, f.selection)).rejects.toThrow('disabled'); expect(f.calls).toEqual([]);
  await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true);
  await expect(f.provider.applicationProperties(scope, { ...f.selection, windowId: '2' })).rejects.toThrow('exact selected');
  expect((await f.provider.applicationProperties(scope, f.selection)).properties).toEqual([{ elementId: 'ax-stable-id', role: 'AXStaticText', value: 'Counter: 1' }]);
  expect(f.calls.filter(command => command === 'properties')).toHaveLength(1);
  expect(f.calls.includes('observe') || f.calls.includes('image') || f.calls.includes('act')).toBe(false);
  f.foreignProperties(); await expect(f.provider.applicationProperties(scope, f.selection)).rejects.toThrow('owner changed');
  f.stop(); await expect(f.provider.applicationProperties(scope, f.selection)).rejects.toThrow('disabled');
  await f.provider.close();
});

test('revoked native enable cannot restore authority after an explicit disable completes', async () => {
  let reply!: (value: unknown) => void; let closes = 0;
  const transport: NativeDesktopTransport = { request: () => new Promise(resolve => { reply = resolve; }), async close() { closes++; } };
  const provider = createMacosDesktopProvider({ helperExecutable: '/never-launched', helperSha256: 'a'.repeat(64), platform: 'darwin', isScopeActive: () => true, transportFactory: () => transport });
  const enabling = provider.setEnabled(true, true);
  expect(provider.passiveStatus().activeCount).toBe(1);
  await provider.setEnabled(false, true); reply({ enabled: true });
  await expect(enabling).rejects.toThrow('revoked');
  expect(provider.passiveStatus()).toMatchObject({ enabled: false, activeCount: 0 }); expect(closes).toBe(1);
  await provider.close();
});

test('pre-dispatch native cancellation sends no input and does not create an uncertain owner', async () => {
  const f = fixture(); await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true);
  const observation = await f.provider.observe(scope); const controller = new AbortController(); controller.abort();
  const operationId = randomUUID(); const action = { kind: 'click' as const, x: 0, y: 0 }; const binding = desktopBindingOf(observation);
  expect(await f.provider.actWithOperation(scope, binding, action, operationId, controller.signal)).toMatchObject({ operationId, outcome: 'not_sent', executed: false });
  expect(f.calls.filter(command => command === 'act')).toHaveLength(0); expect(f.provider.passiveStatus().uncertain).toBe(false);
  expect(f.provider.readExistingReceipt(operationId, binding, action)?.outcome).toBe('not_sent');
  await f.provider.close();
});

test('oversized native protocol payload is refused before resolving or launching any helper', async () => {
  const client = new NativeDesktopHelperClient({ executable: '/nonexistent-no-helper-launch', sha256: 'a'.repeat(64) });
  await expect(client.request('properties', { selection: { windowId: '1'.repeat(70 * 1024) } })).rejects.toThrow('request exceeds');
  expect(client.activeCount).toBe(0); await client.close();
});

const helper = join(import.meta.dir, '..', 'launcher', 'electron', 'desktop-helper', `darwin-${process.arch}`, 'nekodex-desktop-helper');
test.skipIf(process.platform !== 'darwin' || !existsSync(helper))('compiled native helper reports passive permissions/metadata and closes without capture or input', async () => {
  const executable = realpathSync(helper); const client = new NativeDesktopHelperClient({ executable, sha256: digest(readFileSync(executable)), requestTimeoutMs: 3000 });
  try {
    const state = await client.request('status') as Record<string, unknown>;
    expect(state.enabled).toBe(false); expect(state.selected).toBeNull();
    expect(typeof state.screenCaptureGranted).toBe('boolean'); expect(typeof state.accessibilityGranted).toBe('boolean');
    expect(typeof state.postEventGranted).toBe('boolean'); expect(state.inputWindowBound).toBe(false);
    const inventory = await client.request('listWindows') as { windows: unknown[] }; expect(Array.isArray(inventory.windows)).toBe(true);
    expect(inventory.windows.length).toBeLessThanOrEqual(128);
    await expect(client.request('status', { command: 'act' })).rejects.toThrow('protocol ownership');
  } finally { await client.close(); }
  await expect(client.request('status')).rejects.toThrow('closed');
}, 5000);


test('explicit foreground handoff remains in native payload and operation identity without replacing the observation binding', async () => {
  const f = fixture(); await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true);
  const observed = await f.provider.observe(scope, undefined, true), binding = desktopBindingOf(observed);
  expect(f.requests.find(row => row.command === 'observe')?.body).toEqual({ scopeId: `${scope.taskId}\0${scope.generation}`, waitForForeground: true });
  const operationId = randomUUID();
  const action = { kind: 'click' as const, x: 0, y: 0, waitForForeground: true as const };
  expect((await f.provider.actWithOperation(scope, binding, action, operationId)).outcome).toBe('completed');
  expect(f.requests.find(row => row.command === 'act')?.body).toEqual({ operationId, binding, action });
  await expect(f.provider.actWithOperation(scope, binding, { kind: 'click', x: 0, y: 0 }, operationId)).rejects.toThrow('original payload');
  expect(f.calls.filter(command => command === 'act')).toHaveLength(1);
  expect(f.provider.readExistingReceipt(operationId, binding, { kind: 'click', x: 0, y: 0 })).toBeUndefined();
  await f.provider.close();
});


test('revoking an explicit foreground observation aborts its exact waiting request without another capture or input', async () => {
  const f = fixture(); await f.provider.setEnabled(true, true); await f.provider.selectWindow(f.selection, true); f.holdForeground();
  const pending = f.provider.observe(scope, undefined, true);
  f.provider.invalidate();
  await expect(pending).rejects.toThrow('foreground wait aborted');
  expect(f.calls.filter(command => command === 'observe')).toHaveLength(1);
  expect(f.calls.filter(command => command === 'act')).toHaveLength(0);
  expect(f.provider.passiveStatus().activeCount).toBe(0);
  await f.provider.close();
});
