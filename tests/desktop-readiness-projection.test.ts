import { expect, test } from 'bun:test';
import { createElement } from '../launcher/node_modules/react';
import { renderToStaticMarkup } from '../launcher/node_modules/react-dom/server';
import { AgentDesktopTools } from '../launcher/src/AgentDesktopTools';
import { createAgentDesktopToolsProvider } from '../src/browser-companion/agent-desktop-tools';
import { createMacosDesktopProvider, NativeDesktopHelperClient, type NativeDesktopTransport } from '../src/browser-companion/macos-desktop';

const scope = { taskId: 'readiness', generation: 1, toolCallId: 'control' };
const selection = { windowId: '1', processId: '20:1', windowEpoch: 'a'.repeat(64) };
function fixture() {
  let enabled = false, selected = false, transportClosed = false;
  const calls: string[] = [];
  const window = { ...selection, owner: 'Synthetic owner', title: 'Synthetic window', foreground: true, frame: { x: 0, y: 0, width: 1, height: 1 } };
  const transport: NativeDesktopTransport = {
    get isClosed() { return transportClosed; },
    async request(command) {
      calls.push(command);
      if (transportClosed) throw new Error('Native desktop helper is closed; no automatic restart');
      if (command === 'enable') { enabled = true; return { enabled: true }; }
      if (command === 'listWindows') return { windows: [window, { ...window, windowId: '2' }] };
      if (command === 'select') { selected = true; return { selected: window, inputWindowBound: true }; }
      if (command === 'status') return { providerId: 'nekodex-macos-desktop-v1', enabled, uncertain: false,
        selected: selected ? window : null, selectionCurrent: selected, inputWindowBound: selected,
        screenCaptureGranted: true, accessibilityGranted: true, postEventGranted: true,
        permissionClient: { selfResponsible: true, bundleIdentifier: 'fixture', name: 'Fixture', bundlePath: '/unlaunched' } };
      if (command === 'observe') throw new Error('human-input-changed');
      if (command === 'invalidate') return { invalidated: true };
      throw new Error(`Unexpected command ${command}`);
    },
    async close() { transportClosed = true; },
  };
  const controller = createAgentDesktopToolsProvider({ platform: 'darwin', isScopeActive: () => true,
    createProvider: () => createMacosDesktopProvider({ platform: 'darwin', helperExecutable: '/unlaunched', helperSha256: 'f'.repeat(64),
      isScopeActive: () => true, transportFactory: () => transport }) });
  const render = () => renderToStaticMarkup(createElement(AgentDesktopTools, { desktop: controller.status(), scope, locked: false,
    api: { request: async () => { throw new Error('Rendering must remain passive'); } }, choose: en => en,
    act: async () => { throw new Error('Rendering must remain passive'); }, refresh: async () => {} }));
  return { controller, calls, render, closeTransport: () => { transportClosed = true; } };
}
function buttonDisabled(html: string, name: string) {
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2]!.replace(/<[^>]*>/g, '') === name);
  expect(button).toBeDefined(); return /\bdisabled(?:=|\s|$)/.test(button![1]!);
}

test('a rejected desktop read clears stale readiness but permits explicit inspection on the same enabled helper', async () => {
  const f = fixture();
  try {
    await f.controller.setEnabled(true, true); await f.controller.listWindows(true); await f.controller.selectAndBind(scope, selection, true);
    const outcome = await f.controller.execute({ scope: { ...scope, toolCallId: 'observe' }, tool: 'desktop/observe', arguments: { selection }, idempotencyKey: 'observe-once' });
    expect(outcome.state).toBe('failed'); expect(outcome.reason).toBe('human-input-changed');
    expect((outcome.result as any).structuredContent.outcome).toBe('not_sent');
    expect(f.calls.filter(command => command === 'observe')).toHaveLength(1);
    expect(f.controller.status()).toMatchObject({ enabled: true, available: false, helperClosed: false, nativeStatus: null, permissions: null });
    const beforeRender = f.calls.length, html = f.render(); expect(f.calls).toHaveLength(beforeRender);
    expect(html).toContain('Inspection required'); expect(html).not.toContain('Desktop helper unavailable');
    expect(html).not.toContain('Choose Disable and release desktop access, then Enable');
    expect(buttonDisabled(html, 'Inspect permissions without prompting')).toBe(false);
    expect(buttonDisabled(html, 'List window metadata')).toBe(false);
    expect(buttonDisabled(html, 'Add this window to the task')).toBe(true);
    await f.controller.listWindows(true);
    expect(f.controller.status()).toMatchObject({ nativeStatus: null, reason: null });
    expect(f.render()).toContain('Inspection required');
    expect(buttonDisabled(f.render(), 'Add this window to the task')).toBe(true);
    await f.controller.inspectPermissions(true);
    expect(f.controller.status()).toMatchObject({ enabled: true, available: true, helperClosed: false, reason: null });
    expect(f.render()).toContain('Enabled by explicit action');
    expect(buttonDisabled(f.render(), 'Add this window to the task')).toBe(false);
    expect(f.calls.filter(command => command === 'enable')).toHaveLength(1);
    expect(f.calls.filter(command => command === 'observe')).toHaveLength(1);
    expect(f.calls).not.toContain('act');
  } finally { await f.controller.close(); }
});

test('passive transport closure fences cached readiness and keeps explicit release recovery distinct', async () => {
  const f = fixture();
  try {
    await f.controller.setEnabled(true, true); await f.controller.listWindows(true); await f.controller.selectAndBind(scope, selection, true);
    expect(f.controller.status().available).toBe(true);
    f.closeTransport(); const beforeStatus = f.calls.length;
    expect(f.controller.status()).toMatchObject({ enabled: true, available: false, helperClosed: true, reason: 'Native desktop helper is closed; no automatic restart' });
    expect(f.calls).toHaveLength(beforeStatus);
    const html = f.render(); expect(html).toContain('Desktop helper unavailable');
    expect(buttonDisabled(html, 'Inspect permissions without prompting')).toBe(true);
    expect(buttonDisabled(html, 'Add this window to the task')).toBe(true);
    expect(buttonDisabled(html, 'Disable and release desktop access')).toBe(false);
    const client = new NativeDesktopHelperClient({ executable: '/unlaunched', sha256: 'f'.repeat(64) });
    expect(client.isClosed).toBe(false); await client.close(); expect(client.isClosed).toBe(true);
    expect(f.calls.filter(command => command === 'enable')).toHaveLength(1);
  } finally { await f.controller.close(); }
});
