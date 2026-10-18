import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { remoteHostForRoot } from '../launcher/src/remote-workspace-types';
const require = createRequire(import.meta.url);
const { createRemoteWorkspaceService, sshArgs, validateHost } = require('../launcher/electron/remote-workspace.cjs');
const { resolveSshConfigAlias, assertSshConfigSnapshot } = require('../launcher/electron/remote-ssh-config.cjs');

test('explicit bounded SSH aliases inherit pinned connection data, preserve direct routes and refuse drift/unsupported config without execution', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-ssh-config-')));
  const ssh = join(home, '.ssh'); mkdirSync(ssh, { mode: 0o700 });
  const configPath = join(ssh, 'config'), key = join(ssh, 'selected key');
  writeFileSync(key, 'inert key metadata fixture; never read by alias resolver', { mode: 0o600 });
  const context = { home, configPath, username: 'local-fixture' };
  const configuration = 'Host unrelated\n ProxyCommand forbidden-never-run\nHost work_box !work_other\n HostName = selected.invalid\n User remote-user\n Port 2202\n IdentityFile "~/.ssh/selected key"\n IdentitiesOnly yes\n HostKeyAlias pinned-host\n StrictHostKeyChecking YeS\n ConnectTimeout 15\n ServerAliveInterval 30\n ServerAliveCountMax 3\nHost *\n User ignored-later-user\n';
  const write = (text: string) => writeFileSync(configPath, text, { mode: 0o600 }); write(configuration);
  const direct = { label: 'Legacy direct', hostname: 'direct.invalid', username: 'direct-user', port: 22, root: '/srv/project' };
  const alias = { label: 'Selected alias', hostname: 'work_box', username: '', port: null, root: '/srv/project', connectionMode: 'ssh-config-alias' };
  const argv = sshArgs(direct, true);
  expect(validateHost(direct)).toEqual(direct);
  expect(argv).toEqual(['-F', process.platform === 'win32' ? 'NUL' : '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', '22', '-l', 'direct-user', '-s', '--', 'direct.invalid', 'sftp']);
  const snapshot = resolveSshConfigAlias(alias, context);
  expect(snapshot).toMatchObject({ alias: 'work_box', hostname: 'selected.invalid', username: 'remote-user', port: 2202 });
  expect(snapshot.options).toEqual(['-o', 'IdentitiesOnly=yes', '-o', 'HostKeyAlias=pinned-host', '-i', key]);
  expect(snapshot.connectionOptions).toEqual({ ConnectTimeout: 15, ServerAliveInterval: 30, ServerAliveCountMax: 3 });
  expect(snapshot.sourceSha256).toBe(createHash('sha256').update(configuration).digest('hex'));
  expect(JSON.stringify(snapshot)).not.toContain('inert key metadata fixture');
  expect(resolveSshConfigAlias({ ...alias, username: 'explicit-user', port: 2203 }, context)).toMatchObject({ username: 'explicit-user', port: 2203 });
  assertSshConfigSnapshot(snapshot);
  const calls: { config: any; argv: string[] }[] = []; let commands = 0;
  const service = createRemoteWorkspaceService({ storagePath: join(home, 'state', 'registry.json'), sshConfigContext: context,
    transportFactory(config: any) {
      calls.push({ config, argv: sshArgs(config, true) });
      return { ready: Promise.resolve(), closed: false, close() { this.closed = true; },
        async realpath(path: string) { return path; }, async stat() { return { mode: 0o40700 }; },
        async list() { return { truncated: false, entries: [] }; } };
    },
    commandRunner(config: any) { calls.push({ config, argv: sshArgs(config, false) }); commands++; return Promise.resolve({ exitCode: 0, stdout: 'inert result', stderr: '' }); },
  });
  try {
    const host = service.addHost(alias); expect(calls).toHaveLength(0); expect(host.aliasResolved).toBe(false);
    const saved = JSON.parse(readFileSync(join(home, 'state', 'registry.json'), 'utf8'));
    expect(saved.hosts[0].config).toEqual(alias); expect(JSON.stringify(saved)).not.toContain('selected.invalid');
    const connected = await service.connect(host.id);
    expect(connected).toMatchObject({ hostname: 'selected.invalid', username: 'remote-user', port: 2202, sshAlias: 'work_box', aliasResolved: true });
    const worktreeRoot = '/srv/.nekodex-worktrees/fixture';
    expect(remoteHostForRoot(connected, worktreeRoot, 'Worktree')).toEqual({ ...alias, label: 'Worktree', root: worktreeRoot });
    expect(connected.fingerprint).not.toBe(host.fingerprint);
    expect(calls[0].argv.slice(-7)).toEqual(['2202', '-l', 'remote-user', '-s', '--', 'selected.invalid', 'sftp']);
    expect(calls[0].argv.filter(value => value.startsWith('StrictHostKeyChecking='))).toEqual(['StrictHostKeyChecking=yes']);
    expect(calls[0].argv.filter(value => /^(ConnectTimeout|ServerAliveInterval|ServerAliveCountMax)=/.test(value))).toEqual(['ConnectTimeout=15', 'ServerAliveInterval=30', 'ServerAliveCountMax=3']);
    const approval = service.approveCommand(host.id, { command: 'literal fixture command', timeoutSeconds: 5 });
    expect(approval).toMatchObject({ hostname: 'selected.invalid', username: 'remote-user', port: 2202, fingerprint: connected.fingerprint });
    await service.executeCommand(host.id, approval.token); expect(commands).toBe(1);
    expect(calls[1].config.sshConfigSnapshot.fingerprint).toBe(calls[0].config.sshConfigSnapshot.fingerprint);
    const oldApproval = service.approveCommand(host.id, { command: 'must not run after drift', timeoutSeconds: 5 });
    write(configuration.replace('selected.invalid', 'changed.invalid'));
    expect(() => assertSshConfigSnapshot(snapshot)).toThrow('reconnect');
    expect(() => sshArgs(calls[0].config, false)).toThrow('reconnect');
    await expect(service.executeCommand(host.id, oldApproval.token)).rejects.toThrow('reconnect'); expect(commands).toBe(1);
    const reconnected = await service.connect(host.id); expect(reconnected.fingerprint).not.toBe(connected.fingerprint);
    await expect(service.executeCommand(host.id, oldApproval.token)).rejects.toThrow('Review'); expect(commands).toBe(1);
    expect(service.agentStatus().hosts[0]).toMatchObject({ hostname: 'changed.invalid', username: 'remote-user', port: 2202 });
    expect(service.agentStatus().hosts[0]).not.toHaveProperty('connectionMode');
    service.disconnect(host.id);
    for (const value of ['no', 'ask', 'accept-new', 'off', 'true']) {
      write(configuration.replace('StrictHostKeyChecking YeS', `StrictHostKeyChecking ${value}`));
      const before = calls.length;
      await expect(service.connect(host.id)).rejects.toThrow('StrictHostKeyChecking must be yes'); expect(calls).toHaveLength(before);
    }
    write(configuration + ' StrictHostKeyChecking no\n');
    await expect(service.connect(host.id)).rejects.toThrow('StrictHostKeyChecking must be yes');
    for (const [directive, max] of [['ConnectTimeout', 60], ['ServerAliveInterval', 300], ['ServerAliveCountMax', 10]] as const) {
      for (const value of ['0', '-1', String(max + 1), '1.5', '15s', '"15;touch injected"', '15 -oProxyCommand=never']) {
        write(configuration + ` ${directive} ${value}\n`);
        const before = calls.length;
        await expect(service.connect(host.id)).rejects.toThrow(); expect(calls).toHaveLength(before);
      }
    }
    write(configuration.replace('ConnectTimeout 15', 'ConnectTimeout 17'));
    const timingChanged = resolveSshConfigAlias(alias, context);
    expect(timingChanged.fingerprint).not.toBe(snapshot.fingerprint);
    expect(() => assertSshConfigSnapshot(snapshot)).toThrow('reconnect');
    const timingArgv = sshArgs({ ...calls[0].config, sshConfigSnapshot: timingChanged }, true);
    expect(timingArgv.filter((value: string) => value.startsWith('ConnectTimeout='))).toEqual(['ConnectTimeout=17']);
    expect(timingArgv).toContain('ServerAliveInterval=30');
    for (const directive of ['Include other.conf', 'Match exec "never-run"', 'ProxyCommand never-run', 'ProxyJump never-connect', 'LocalCommand never-run']) {
      write(`Host work_box\n HostName selected.invalid\n ${directive}\n`);
      const before = calls.length;
      await expect(service.connect(host.id)).rejects.toThrow('unsupported'); expect(calls).toHaveLength(before);
    }
    write('#' + 'x'.repeat(65536)); const beforeOversize = calls.length;
    await expect(service.connect(host.id)).rejects.toThrow('64 KiB'); expect(calls).toHaveLength(beforeOversize);
    write('Host work_box\n HostName selected.invalid\n');
    expect(resolveSshConfigAlias(alias, context)).toMatchObject({ username: 'local-fixture', port: 22 });
    write(configuration);
    const explicitAlias = { ...alias, username: 'explicit-user', port: 2203 };
    const explicitHost = service.addHost(explicitAlias);
    const explicitConnected = await service.connect(explicitHost.id);
    expect(explicitConnected).toMatchObject({ hostname: 'selected.invalid', username: 'explicit-user', port: 2203 });
    const clonedInput = remoteHostForRoot(explicitConnected, worktreeRoot, 'Explicit worktree');
    expect(clonedInput).toEqual({ ...explicitAlias, label: 'Explicit worktree', root: worktreeRoot });
    const clonedHost = service.addHost(clonedInput);
    expect(clonedHost).toMatchObject({ hostname: 'work_box', username: 'explicit-user', port: 2203, connectionMode: 'ssh-config-alias', connected: false });
    expect(remoteHostForRoot(service.addHost(direct), worktreeRoot, 'Direct worktree')).toEqual({ ...direct, label: 'Direct worktree', root: worktreeRoot });
    const pinned = resolveSshConfigAlias(alias, context);
    writeFileSync(key, 'rotated inert bytes', { mode: 0o600 }); expect(() => assertSshConfigSnapshot(pinned)).toThrow('metadata changed');
    expect(sshArgs(direct, true)).toEqual(argv);
    for (const input of [{ ...direct, port: null }, { ...alias, hostname: '-oProxyCommand=x' }, { ...alias, username: 'invalid user' }]) expect(() => validateHost(input)).toThrow();
  } finally { service.dispose(); rmSync(home, { recursive: true, force: true }); }
}, 5000);
