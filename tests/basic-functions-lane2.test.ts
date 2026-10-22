import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemoteWorkspaceService } from '../launcher/electron/remote-workspace.cjs';
import { createExternalUsageService } from '../launcher/electron/external-usage.cjs';
import { createLocalWorkspaceService } from '../launcher/electron/local-workspace.cjs';
import { registerWorkspaceIpc } from '../launcher/electron/ipc/workspace.cjs';

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-basic-functions-'));
test('host upsert preserves id, label-independent authority and drafts across restart; destination change is guarded', () => {
  const dir = temporary(), storagePath = path.join(dir, 'hosts.json');
  let spawned = 0;
  const make = () => createRemoteWorkspaceService({ storagePath, spawnProcess: () => { spawned++; throw Error('No transport permitted'); } } as any);
  const input = { label: 'Original', hostname: 'invalid.example', username: 'fixture', port: 22, root: '/fixture' };
  let service = make();
  try {
    const host = service.addHost(input);
    service.retainDraft(host.id, { path: 'note.txt', text: 'retained', expectedRevision: null });
    const renamed = service.addHost({ ...input, id: host.id, label: 'Renamed' });
    expect(renamed).toMatchObject({ id: host.id, label: 'Renamed', fingerprint: host.fingerprint });
    expect(service.listDrafts(host.id)[0]!.text).toBe('retained');
    service.dispose(); service = make();
    expect(service.listHosts()[0]).toMatchObject({ id: host.id, label: 'Renamed', fingerprint: host.fingerprint });
    expect(() => service.addHost({ ...input, id: host.id, root: '/other' })).toThrow('draft');
    service.discardDraft(host.id, service.listDrafts(host.id)[0]!.id);
    const edited = service.addHost({ ...input, id: host.id, hostname: 'replacement.invalid' });
    expect(edited.id).toBe(host.id); expect(edited.fingerprint).not.toBe(host.fingerprint); expect(edited.connected).toBe(false);
    expect(service.listHosts()).toHaveLength(1); expect(spawned).toBe(0);
    expect(() => service.addHost({ ...input, id: 'unknown' })).toThrow();
  } finally { service.dispose(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('usage rename changes metadata only and preserves imported rows/cursors through restart', async () => {
  const dir = temporary(), logs = path.join(dir, 'logs'), statePath = path.join(dir, 'state.json'); fs.mkdirSync(logs);
  const make = () => createExternalUsageService({ statePath, pickDirectory: async () => logs });
  const service = make();
  try {
    fs.writeFileSync(path.join(logs, 'session.jsonl'), JSON.stringify({type:'assistant',sessionId:'fixture',uuid:'a',version:'2.1.0',message:{id:'m',model:'fixture',usage:{input_tokens:10,output_tokens:2}}})+'\n');
    const source = (await service.selectRoot({client:'claude',accountPseudonym:'old',scope:'external-only',consent:true})).sources[0]!;
    await service.request({ action: 'import', sourceId: source.id });
    const before = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(Object.keys(before.records).length).toBeGreaterThan(0);
    await service.request({ action: 'rename-source', sourceId: source.id, accountPseudonym: 'corrected' });
    const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const expected = structuredClone(before); expected.sources[0].accountPseudonym = 'corrected';
    expect(after).toEqual(expected);
    expect(make().snapshot().sources[0]).toMatchObject({ id: source.id, accountPseudonym: 'corrected', reportedRecords: 1 });
    await expect(service.request({action:'rename-source',sourceId:source.id,accountPseudonym:'bad label'})).rejects.toThrow();
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toEqual(after);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('file-manager IPC opens only fresh validated granted directory; never a renderer path', async () => {
  const handlers = new Map<string, (...args:any[]) => any>(); const opened: string[] = [];
  registerWorkspaceIpc({ registerIpcHandler: (name:string, fn:any) => handlers.set(name,fn), service: { resolveGrant(id:string) { if (id !== 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') throw Error('Unknown grant'); return {id,path:'/exact/granted/root'}; } }, manageRoot: (directory:string) => opened.push(directory) });
  const invoke = handlers.get('launcher:workspace-manage-root')!;
  await invoke(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); expect(opened).toEqual(['/exact/granted/root']);
  expect(() => invoke(null, '/arbitrary/file')).toThrow();
  expect(() => invoke(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '/arbitrary/file')).toThrow();
});

test('existing workspace save creates zero-byte file and refuses replacement without current revision', async () => {
  const dir = temporary(), root = path.join(dir,'root'); fs.mkdirSync(root);
  const service = createLocalWorkspaceService({ pickDirectory: async () => root, registryPath: path.join(dir,'registry.json') });
  try {
    const grant = (await service.pickRoot())!;
    const result = service.save(grant.id, {path:'empty.txt',text:'',expectedRevision:null});
    expect(result.state).toBe('saved'); expect(fs.statSync(path.join(root,'empty.txt')).size).toBe(0);
    expect(service.save(grant.id,{path:'empty.txt',text:'overwrite',expectedRevision:null}).state).toBe('conflict');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
