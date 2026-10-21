import { expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
  const permissionClient = { selfResponsible: true, bundleIdentifier: 'dev.nekodex.desktop-provider.v1', name: 'NEKODEX Desktop Helper', bundlePath: '/fixture/NEKODEX Desktop Helper.app' };
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
        screenCaptureGranted: true, accessibilityGranted: true, postEventGranted: false, permissionClient };
      if (command === 'listWindows') return { windows: [window] };
      if (command === 'openPermissionSettings') return { screenCaptureGranted: true, accessibilityGranted: true, postEventGranted: false, permissionClient,
        pane: body.permission === 'screenCapture' ? 'Privacy_ScreenCapture' : 'Privacy_Accessibility', registered: true };
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

test('permission settings control is explicit, fixed to three permissions and parsed strictly', async () => {
  const f = fixture();
  await expect(f.provider.openPermissionSettings('accessibility', false)).rejects.toThrow('Explicit permission settings');
  await expect(f.provider.openPermissionSettings('fullDiskAccess' as never, true)).rejects.toThrow();
  expect(f.calls).not.toContain('openPermissionSettings');
  const opened = await f.provider.openPermissionSettings('screenCapture', true);
  expect(opened).toMatchObject({ pane: 'Privacy_ScreenCapture', registered: true, permissionClient: { selfResponsible: true, bundleIdentifier: 'dev.nekodex.desktop-provider.v1' } });
  expect(f.requests.find(row => row.command === 'openPermissionSettings')?.body).toEqual({ permission: 'screenCapture' });
  expect((await f.provider.status()).permissionClient.name).toBe('NEKODEX Desktop Helper');
  // Settings never enables the provider, selects a window, captures or dispatches input.
  expect(f.calls.filter(command => ['enable', 'select', 'observe', 'image', 'act'].includes(command))).toEqual([]);
  await f.provider.close();
});

test.skipIf(process.platform !== 'darwin')('enable waits for the helper-owned user confirmation without the request deadline', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-enable-wait-')));
  try {
    // Inert stand-in for a helper whose confirmation alert is still open: it reads and never answers.
    const executable = join(root, 'helper'); writeFileSync(executable, '#!/bin/sh\nexec /bin/cat >/dev/null\n', { mode: 0o755 });
    const client = new NativeDesktopHelperClient({ executable, sha256: digest(readFileSync(executable)), requestTimeoutMs: 50 });
    let settled = false;
    const enabling = client.request('enable', { enabled: true }).then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    await client.close(); await enabling;
    const listing = new NativeDesktopHelperClient({ executable, sha256: digest(readFileSync(executable)), requestTimeoutMs: 50 });
    await expect(listing.request('listWindows')).rejects.toThrow('timed out'); await listing.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('oversized native protocol payload is refused before resolving or launching any helper', async () => {
  const client = new NativeDesktopHelperClient({ executable: '/nonexistent-no-helper-launch', sha256: 'a'.repeat(64) });
  await expect(client.request('properties', { selection: { windowId: '1'.repeat(70 * 1024) } })).rejects.toThrow('request exceeds');
  expect(client.activeCount).toBe(0); await client.close();
});

const swiftCompilerPresent = process.platform === 'darwin' && spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8', timeout: 15000 }).status === 0;
const helper = join(import.meta.dir, '..', 'launcher', 'electron', 'desktop-helper', `darwin-${process.arch}`, 'NEKODEX Desktop Helper.app', 'Contents', 'MacOS', 'nekodex-desktop-helper');
test.skipIf(process.platform !== 'darwin' || !existsSync(helper))('compiled native helper reports passive permissions/metadata and closes without capture or input', async () => {
  const executable = realpathSync(helper); const client = new NativeDesktopHelperClient({ executable, sha256: digest(readFileSync(executable)), requestTimeoutMs: 3000 });
  try {
    const state = await client.request('status') as Record<string, unknown>;
    expect(state.enabled).toBe(false); expect(state.selected).toBeNull();
    expect(typeof state.screenCaptureGranted).toBe('boolean'); expect(typeof state.accessibilityGranted).toBe('boolean');
    expect(typeof state.postEventGranted).toBe('boolean'); expect(state.inputWindowBound).toBe(false);
    // Permissions are judged for the helper bundle itself, never for the process that started it.
    expect(state.permissionClient).toEqual({ selfResponsible: true, bundleIdentifier: 'dev.nekodex.desktop-provider.v1', name: 'NEKODEX Desktop Helper',
      bundlePath: dirname(dirname(dirname(executable))) });
    const inventory = await client.request('listWindows') as { windows: unknown[] }; expect(Array.isArray(inventory.windows)).toBe(true);
    expect(inventory.windows.length).toBeLessThanOrEqual(128);
    await expect(client.request('status', { command: 'act' })).rejects.toThrow('protocol ownership');
  } finally { await client.close(); }
  await expect(client.request('status')).rejects.toThrow('closed');
}, 5000);


// Live 6.1.33-nekodex.8: under NEKODEX the helper's responsibility record named itself by pid but
// NEKODEX.app by path, so a pid-only check skipped the disclaim and TCC judged NEKODEX for screen
// capture. This launcher reproduces that record (disclaimed spawn, then exec of the helper).
test.skipIf(process.platform !== 'darwin' || !existsSync(helper) || !swiftCompilerPresent)('helper disclaims when its responsible pid is itself but its responsible path is another binary', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-stale-responsibility-')));
  try {
    const source = join(root, 'stale.swift'), launcher = join(root, 'stale');
    writeFileSync(source, `import Darwin
typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
let arguments = CommandLine.arguments
if arguments.count == 3, arguments[1] == "exec" {
    var argv: [UnsafeMutablePointer<CChar>?] = [strdup(arguments[2]), nil]; execv(arguments[2], &argv); exit(1)
}
let disclaim = unsafeBitCast(dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim")!, to: Disclaim.self)
var attributes: posix_spawnattr_t?; posix_spawnattr_init(&attributes); _ = disclaim(&attributes, 1)
var argv: [UnsafeMutablePointer<CChar>?] = [strdup(arguments[0]), strdup("exec"), strdup(arguments[1]), nil]; var child: pid_t = 0
guard posix_spawn(&child, arguments[0], nil, &attributes, &argv, environ) == 0 else { exit(1) }
var status: Int32 = 0; waitpid(child, &status, 0); exit(0)
`);
    const built = spawnSync('/usr/bin/xcrun', ['swiftc', '-O', source, '-o', launcher], { encoding: 'utf8', timeout: 170000 });
    if (built.status !== 0) throw new Error(`launcher compilation failed: ${built.stderr}`);
    const child = spawn(launcher, [realpathSync(helper)], { stdio: ['pipe', 'pipe', 'ignore'] });
    try {
      const reply = await new Promise<Record<string, any>>((resolve, reject) => {
        let bytes = ''; child.stdout.on('data', chunk => { bytes += chunk; if (bytes.includes('\n')) resolve(JSON.parse(bytes.slice(0, bytes.indexOf('\n')))); });
        child.once('exit', () => reject(new Error('launcher exited before replying')));
        child.stdin.write(JSON.stringify({ version: 1, id: randomUUID(), command: 'status' }) + '\n');
      });
      expect(reply.value.permissionClient.selfResponsible).toBe(true);
      // The exec'd helper (the launcher's own child) became a supervisor of a disclaimed helper.
      const exec = spawnSync('/usr/bin/pgrep', ['-P', String(child.pid)], { encoding: 'utf8' }).stdout.trim();
      expect(exec).toMatch(/^\d+$/);
      expect(spawnSync('/usr/bin/pgrep', ['-P', exec], { encoding: 'utf8' }).stdout.trim()).toMatch(/^\d+$/);
    } finally { child.stdin.end(); child.kill('SIGTERM'); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 180000);

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

const helperSource = join(import.meta.dir, '..', 'launcher', 'native', 'desktop-provider.swift');
const swiftCompiler = process.platform === 'darwin' ? spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8', timeout: 15000 }).status === 0 : false;
// Live P13: postToPid of a CGEvent built from a global point reached the app without a window and
// was dropped. The real helper source is compiled with an inert entry point that only encodes
// events; it never selects a window, captures or posts input. Target-side delivery is live evidence.
test.skipIf(!swiftCompiler)('pixel click events address the selected window with its window-relative point, never a bare global point', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-pixel-events-')));
  try {
    const harness = join(root, 'harness.swift'); const executable = join(root, 'harness');
    writeFileSync(harness, `import AppKit
@main struct PixelEventHarness {
    @MainActor static func main() {
        let port = DesktopPort()
        func encode(_ local: CGPoint) -> Any {
            guard let events = port.pixelClickEvents(window: 4242, local: local) else { return NSNull() }
            return events.map { event -> [String: Any] in ["type": Int(event.type.rawValue), "x": event.location.x, "y": event.location.y,
                "window": NSEvent(cgEvent: event)?.windowNumber ?? -1, "clickState": event.getIntegerValueField(.mouseEventClickState),
                "button": event.getIntegerValueField(.mouseEventButtonNumber), "flags": event.flags.rawValue] }
        }
        let value: [String: Any] = ["display": CGDisplayBounds(CGMainDisplayID()).height > 0, "center": encode(CGPoint(x: 124, y: 168)),
            "fractional": encode(CGPoint(x: 0.5, y: 311.5)), "negative": encode(CGPoint(x: -1, y: 4)), "infinite": encode(CGPoint(x: CGFloat.infinity, y: 4))]
        print(String(data: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!)
    }
}
`);
    const built = spawnSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-Onone', '-D', 'NEKODEX_DESKTOP_HELPER_HARNESS', helperSource, harness, '-o', executable],
      { encoding: 'utf8', timeout: 170000 });
    if (built.status !== 0) throw new Error(`harness compilation failed: ${built.stderr}`);
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 15000 });
    if (run.status !== 0) throw new Error(`harness failed: ${run.stderr}`);
    const value = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(value.negative).toBeNull(); expect(value.infinite).toBeNull();
    // Without a main display there is no flip reference; the helper then refuses as event-unavailable.
    if (value.display !== true) { expect(value.center).toBeNull(); return; }
    const modifiers = 0x10000 | 0x20000 | 0x40000 | 0x80000 | 0x100000 | 0x200000 | 0x400000 | 0x800000;
    for (const [name, x, y] of [['center', 124, 168], ['fractional', 0.5, 311.5]] as const) {
      const events = value[name] as { type: number; x: number; y: number; window: number; clickState: number; button: number; flags: number }[];
      expect(events.map(event => event.type)).toEqual([5, 1, 2]); // mouseMoved, leftMouseDown, leftMouseUp
      expect(events.map(event => event.clickState)).toEqual([0, 1, 1]);
      for (const event of events) {
        expect(event).toMatchObject({ x, y, window: 4242, button: 0 });
        expect(event.flags & modifiers).toBe(0);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 180000);
