import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { RemoteAgentBinding, RemoteAgentInvocation, RemoteAgentOutcome, RemoteAgentTaskScope, RemoteWorkspaceService } from '../launcher/electron/remote-workspace.cjs';
const { createRemoteWorkspaceService } = createRequire(import.meta.url)('../launcher/electron/remote-workspace.cjs');

// Inert filesystem transport: no SSH process, network, credentials, account or real host.
function fixture() {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-agent-remote-owner-')));
  const root = join(parent, 'data'); mkdirSync(root);
  writeFileSync(join(root, 'small.txt'), 'selected remote content\n');
  writeFileSync(join(root, 'large.txt'), '\u0001'.repeat(240 * 1024));
  const storagePath = join(parent, 'private', 'registry.json');
  let current: RemoteAgentTaskScope = { taskId: 'owned-task', familyId: 'owned-family', generation: 1, revision: 1 };
  const allowed = new Map<string, string>(); let commands = 0, reads = 0, connections = 0;
  let enter!: () => void, release!: (value: unknown) => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const open = (file = storagePath, callbacks = true, validateTask: () => RemoteAgentTaskScope | Promise<RemoteAgentTaskScope> = () => structuredClone(current)) => createRemoteWorkspaceService({ storagePath: file, agentInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transportFactory: () => {
      connections++;
      return { ready: Promise.resolve(), closed: false, close() { this.closed = true; },
        realpath: async (file: string) => realpathSync(file),
        stat: async (file: string) => { try { const s = lstatSync(file); return { size: s.size, mode: s.mode }; } catch { return null; } },
        read: async (file: string) => { reads++; try { return readFileSync(file); } catch { return null; } },
        list: async (file: string) => ({ truncated: false, entries: readdirSync(file).map(name => { const stat = lstatSync(join(file, name)); return { name, mode: stat.mode, size: stat.size }; }) }),
      };
    },
    commandRunner: async () => { commands++; enter(); return new Promise(resolve => { release = resolve; }); },
    ...(callbacks ? { validateAgentTask: validateTask, validateAgentIntent: (request: RemoteAgentInvocation) => {
      const approved = allowed.get(request.idempotencyKey);
      if (!approved || !isDeepStrictEqual(JSON.parse(approved), request)) throw new Error('No exact approved begun intent');
      return structuredClone(current);
    } } : {}),
  }) as RemoteWorkspaceService;
  return { parent, root, storagePath, open, allowed, entered, release: (value: unknown) => release(value),
    current: () => structuredClone(current), generation: (generation: number) => { current = { ...current, generation, revision: current.revision + 1 }; },
    counters: () => ({ commands, reads, connections }),
    host: { label: 'Inert selected host', hostname: 'never-connect.invalid', username: 'fixture', port: 22, root },
    close: () => rmSync(parent, { recursive: true, force: true }),
  };
}
const body = (outcome: RemoteAgentOutcome) => (outcome.result as { structuredContent: Record<string, any> }).structuredContent;
function invocation(binding: RemoteAgentBinding, name: 'list' | 'read' | 'command', key: string, extra: Record<string, unknown>): RemoteAgentInvocation {
  return { scope: { taskId: binding.taskId, generation: binding.generation, toolCallId: key }, tool: `remote/${name}`,
    arguments: { binding, ...extra }, idempotencyKey: key };
}

test('remote Agent owner binds exact current connection, bounds results and retains one command across lost observations, revoke and restart', async () => {
  const f = fixture(), service = f.open(); let reopened: RemoteWorkspaceService | undefined, crash: RemoteWorkspaceService | undefined;
  try {
    const host = service.addHost(f.host); expect(f.counters().connections).toBe(0);
    await expect(service.attachAgent({ hostId: host.id, scope: f.current(), explicitUserAction: true })).rejects.toThrow('Connect');
    await service.connect(host.id);
    await expect(service.attachAgent({ hostId: host.id, scope: { ...f.current(), revision: 99 }, explicitUserAction: true })).rejects.toThrow('changed');
    let binding = (await service.attachAgent({ hostId: host.id, scope: f.current(), explicitUserAction: true })).bindings[0]!;
    expect(binding.root).toBe(f.root); expect(binding.mainInstanceId).toBe(service.agentStatus().mainInstanceId);
    const list = invocation(binding, 'list', 'list-1', { path: '' }); f.allowed.set(list.idempotencyKey, JSON.stringify(list));
    expect(body(await service.executeAgentTool(list)).entries.map((e: { name: string }) => e.name)).toContain('small.txt');
    const read = invocation(binding, 'read', 'read-1', { path: 'small.txt' }); f.allowed.set(read.idempotencyKey, JSON.stringify(read));
    const small = await service.executeAgentTool(read); expect(body(small)).toMatchObject({ text: 'selected remote content\n', contentComplete: true, truncated: false });
    const reads = f.counters().reads;
    expect(await service.executeAgentTool(structuredClone(read))).toEqual(small); expect(f.counters().reads).toBe(reads);
    expect(() => service.agentReceipt({ ...read, arguments: { binding, path: 'large.txt' } })).toThrow('identity conflict');
    const large = invocation(binding, 'read', 'read-large', { path: 'large.txt' }); f.allowed.set(large.idempotencyKey, JSON.stringify(large));
    const bounded = await service.executeAgentTool(large);
    expect(body(bounded)).toMatchObject({ size: 240 * 1024, truncated: true, contentComplete: false });
    expect(body(bounded).revision).toMatch(/^[a-f0-9]{64}$/); expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(180 * 1024);
    const command = invocation(binding, 'command', 'command-once', { command: 'inert selected command', timeoutSeconds: 5 });
    await expect(service.executeAgentTool(command)).rejects.toThrow('No exact approved'); expect(f.counters().commands).toBe(0);
    f.allowed.set(command.idempotencyKey, JSON.stringify(command));
    const owned = service.executeAgentTool(command); await f.entered;
    const duplicate = service.executeAgentTool(structuredClone(command)); expect(duplicate).toBe(owned); expect(f.counters().commands).toBe(1);
    expect(service.agentReceipt(command)?.state).toBe('outcome_unknown');
    // A saved started snapshot represents process loss; opening it never adopts/replays work.
    const crashPath = join(f.parent, 'crash', 'registry.json'); mkdirSync(join(f.parent, 'crash'));
    copyFileSync(f.storagePath, crashPath); copyFileSync(f.storagePath + '.key', crashPath + '.key');
    crash = f.open(crashPath, false); expect(crash.agentStatus().bindings).toEqual([]); expect(crash.agentReceipt(command)?.state).toBe('outcome_unknown');
    expect(await crash.executeAgentTool(command)).toEqual(crash.agentReceipt(command)); expect(f.counters().commands).toBe(1);
    service.revokeAgent(command.scope); f.generation(2); service.invalidateAgentTask({ taskId: binding.taskId, familyId: binding.familyId, beforeGeneration: 2 });
    expect(service.agentStatus().bindings).toEqual([]); expect(service.currentOperation()).toContain('SSH command');
    expect(() => service.disconnect(host.id)).toThrow('active');
    f.release({ exitCode: 0, stdout: '\u0001'.repeat(200000), stderr: 'retained terminal output', stopped: null, truncated: false });
    const terminal = await owned; expect(await duplicate).toEqual(terminal);
    expect(terminal.state).toBe('completed'); expect(body(terminal)).toMatchObject({ exitCode: 0, truncated: true, stderr: 'retained terminal output' });
    expect(Buffer.byteLength(JSON.stringify(terminal))).toBeLessThanOrEqual(180 * 1024);
    expect(service.agentReceipt(command)).toEqual(terminal); expect(f.counters().commands).toBe(1);
    binding = (await service.attachAgent({ hostId: host.id, scope: f.current(), explicitUserAction: true })).bindings[0]!;
    await service.connect(host.id); expect(service.agentStatus().bindings).toEqual([]);
    const stale = invocation(binding, 'read', 'stale-connection', { path: 'small.txt' }); f.allowed.set(stale.idempotencyKey, JSON.stringify(stale));
    await expect(service.executeAgentTool(stale)).rejects.toThrow('Attach this exact');
    service.dispose(); reopened = f.open(f.storagePath, false);
    expect(reopened.agentStatus().bindings).toEqual([]); expect(reopened.agentStatus().hosts[0]?.connected).toBe(false);
    expect(reopened.agentReceipt(command)).toEqual(terminal); expect(await reopened.executeAgentTool(command)).toEqual(terminal);
    expect(f.counters().commands).toBe(1);
  } finally { await service.destroy(); await reopened?.destroy(); await crash?.destroy(); f.close(); }
}, 10000);

test('reconnect during held task validation cannot attach authority to the replacement connection', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const validating = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const service = f.open(f.storagePath, true, async () => { entered(); await held; return f.current(); });
  try {
    const host = service.addHost(f.host); await service.connect(host.id);
    const attachment = service.attachAgent({ hostId: host.id, scope: f.current(), explicitUserAction: true });
    await validating; await service.connect(host.id); release();
    await expect(attachment).rejects.toThrow('Remote connection changed');
    expect(service.agentStatus().bindings).toEqual([]); expect(f.counters().connections).toBe(2);
    expect(f.counters().commands).toBe(0);
    expect((await service.attachAgent({ hostId: host.id, scope: f.current(), explicitUserAction: true })).bindings).toHaveLength(1);
  } finally { release(); await service.destroy(); f.close(); }
}, 10000);
