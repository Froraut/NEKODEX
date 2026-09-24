import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LauncherBrowserHelperClient } from '../src/adapters/chatgpt-web/launcher-helper-client';
import { LAUNCHER_BROWSER_HOST_KIND, LAUNCHER_BROWSER_IDLE_URL } from '../src/launcher-browser-descriptor';

test('invalid helper event rejects the reached turn and retires its exact child', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nekodex-helper-protocol-'));
  const helper = join(root, 'invalid-helper.cjs');
  const reached = join(root, 'reached.json');
  const descriptor = join(root, 'browser.json');
  const releases: unknown[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    releases.push(await request.json());
    return Response.json({ ok: true, cancelledByUser: false });
  } });
  writeFileSync(helper, `
    const fs = require('node:fs');
    const lines = require('node:readline').createInterface({ input: process.stdin });
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (message.type !== 'run') return;
      fs.writeFileSync(${JSON.stringify(reached)}, JSON.stringify({ id: message.id, pid: process.pid }));
      process.stdout.write(JSON.stringify({ type: 'event', id: message.id, event: 'unknown_future_event' }) + '\\n');
    });
    process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n');
  `);
  writeFileSync(descriptor, JSON.stringify({ version: 3, kind: LAUNCHER_BROWSER_HOST_KIND,
    profile: 'development', pid: process.pid, endpoint: 'http://127.0.0.1:39110',
    control: { endpoint: `http://127.0.0.1:${server.port}`, token: 't'.repeat(40) },
    helper: { executable: process.execPath, script: helper }, partition: 'persist:codex-web-gpt-dev-chatgpt',
    idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId: 'a'.repeat(32),
    surfaceTargets: { ['a'.repeat(32)]: 'protocol-test-target' }, createdAt: new Date().toISOString(),
  }), { mode: 0o600 });
  const client = new LauncherBrowserHelperClient({ appName: 'Protocol fixture', browserHost: 'launcher',
    browserHostDescriptorPath: descriptor, browserHelperScriptPath: helper,
    storageStatePath: join(root, 'unused-state.json'), chromeExecutablePath: '/unused-chrome',
    turnTimeoutMs: 1000, headed: true, autoApproveToolCalls: false, useSavedChats: false });
  try {
    await expect(client.run({ traceId: 'protocol-cleanup-turn', modelId: 'chatgpt-web/medium',
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: false },
      prepare: async () => ({ text: 'fixture', images: [], release() {} }), onTextDelta() {},
    })).rejects.toThrow('invalid protocol data: Launcher browser helper emitted an unknown event');
    const owner = JSON.parse(readFileSync(reached, 'utf8'));
    expect(owner.id).toBe('protocol-cleanup-turn');
    expect(releases).toEqual([expect.objectContaining({ phase: 'end', traceId: owner.id,
      helperPid: owner.pid, status: 'failed' })]);
    const stopped = () => { try { process.kill(owner.pid, 0); return false; } catch { return true; } };
    const deadline = Date.now() + 2000;
    while (!stopped() && Date.now() < deadline) await Bun.sleep(10);
    expect(stopped()).toBe(true);
  } finally {
    await client.close();
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 5000);
