import {expect,test} from 'bun:test';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPythonBuildSelectionService} from '../launcher/electron/python-build-selection.cjs';
import {createAgentPythonBuildDescriptorPublisher} from '../launcher/electron/agent-python-build-descriptor.cjs';
import {BrowserControlServer} from '../launcher/electron/control-server.cjs';
import {createLauncherPythonBuildSelectionBridge} from '../src/execution-environments/launcher-python-build-selection';

const config={name:'fixture',version:'1.0',backend:'backend',backendPath:['.'],buildRequires:[]};
test('native-selected snapshot crosses owned control listener as pinned raw bytes and rejects stale generation',async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'nekodex-selected-build-'))),source=join(root,'source');mkdirSync(source);writeFileSync(join(source,'pyproject.toml'),'[build-system]\nrequires=[]\nbuild-backend="backend"\nbackend-path=["."]\n');writeFileSync(join(source,'backend.py'),'# selected backend\n');writeFileSync(join(source,'empty.py'),'');writeFileSync(join(source,'.env'),'SECRET=must-not-cross\n');
  const scope={taskId:randomUUID(),generation:1,toolCallId:'picker'};let generation=1;const service=createPythonBuildSelectionService({assertScope(s){if(s.taskId!==scope.taskId||s.generation!==generation)throw new Error('stale');}});
  let instance:string|undefined;const logger={info(){},error(){}};
  const server=new BrowserControlServer({logger,getPythonBuildSelectionService:()=>service,getPythonBuildSelectionInstance:()=>instance} as never);
  try{
    const selected=await service.register(scope,{source:{kind:'tree',path:source},config},true);expect(selected.sourceFileCount).toBe(3);expect(selected.excludedEntries).toBe(1);expect(JSON.stringify(selected)).not.toContain(root);
    writeFileSync(join(source,'backend.py'),'changed after immutable selection');
    await server.start();const publisher=createAgentPythonBuildDescriptorPublisher({coreHome:root,profile:'development',control:server.descriptor()});instance=publisher.instanceId;publisher.publish();
    const client=createLauncherPythonBuildSelectionBridge({descriptorPath:publisher.path,expectedProfile:'development',requestWaitMs:3000});
    const result=await client.resolvePythonBuildSelection(selected.selectionId,{...scope,toolCallId:'review-call'});
    expect(result.source.kind).toBe('tree');if(result.source.kind==='tree'){expect(Buffer.from(result.source.files.find(f=>f.path==='backend.py')!.bytes).toString()).toBe('# selected backend\n');expect(result.source.files.some(f=>f.path==='.env')).toBe(false);expect(result.source.files.find(f=>f.path==='empty.py')!.bytes.length).toBe(0);}
    generation=2;await expect(client.resolvePythonBuildSelection(selected.selectionId,{...scope,toolCallId:'stale-call'})).rejects.toThrow('snapshot unavailable');
    await expect(client.resolvePythonBuildSelection(selected.selectionId,{...scope,generation:2,toolCallId:'new-call'})).rejects.toThrow('snapshot unavailable');
  }finally{await server.close();service.close();rmSync(root,{recursive:true,force:true});}
});

test('snapshot registration refuses linked files without exposing host paths',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'nekodex-selected-build-link-')));try{writeFileSync(join(root,'pyproject.toml'),'[build-system]\n');writeFileSync(join(root,'outside.txt'),'private');symlinkSync(join(root,'outside.txt'),join(root,'backend.py'));const service=createPythonBuildSelectionService({assertScope:()=>true});let caught:unknown;try{await service.register({taskId:randomUUID(),generation:1,toolCallId:'pick'},{source:{kind:'tree',path:root},config},true);}catch(e){caught=e;}expect(String(caught)).toBe('Error: Python build selection unavailable');expect(String(caught)).not.toContain(root);service.close();}finally{rmSync(root,{recursive:true,force:true});}
});

test('core rejects corrupted streamed bytes before returning a build selection',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'nekodex-selected-build-wire-')));const service=createPythonBuildSelectionService({assertScope:()=>true});
 try{writeFileSync(join(root,'pyproject.toml'),'[build-system]\n');const scope={taskId:randomUUID(),generation:1,toolCallId:'pick'},selection=await service.register(scope,{source:{kind:'tree',path:root},config},true);
 const publisher=createAgentPythonBuildDescriptorPublisher({coreHome:root,profile:'development',control:{endpoint:'http://127.0.0.1:1',token:'a'.repeat(43)}});publisher.publish();const opened=await service.open({selectionId:selection.selectionId,scope});const header=Buffer.from(JSON.stringify({...opened.header,instanceId:publisher.instanceId})),prefix=Buffer.alloc(4);prefix.writeUInt32BE(header.length);const wire=Buffer.concat([prefix,header,...opened.chunks]);wire[wire.length-1]^=1;
 const client=createLauncherPythonBuildSelectionBridge({descriptorPath:publisher.path,expectedProfile:'development',fetch:(async()=>new Response(wire,{headers:{'content-type':'application/vnd.nekodex.python-build-selection','x-nekodex-python-build-instance':publisher.instanceId}})) as typeof fetch});await expect(client.resolvePythonBuildSelection(selection.selectionId,scope)).rejects.toThrow('snapshot unavailable');
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});

test('known credential basenames are excluded from trees and refused by the shared guest archive path guard',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {PYTHON_BUILD_SOURCE_PATH_GUARD}=await import('../src/execution-environments/python-build-guest');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'nekodex-selected-build-credentials-'))),source=join(root,'source');mkdirSync(source);
 const service=createPythonBuildSelectionService({assertScope:()=>true}),scope={taskId:randomUUID(),generation:1,toolCallId:'credential-policy'};
 try{
  writeFileSync(join(source,'pyproject.toml'),'[build-system]\n');writeFileSync(join(source,'auth_client.py'),'# normal source stays selected\n');for(const name of ['auth.json','storage-state.json'])writeFileSync(join(source,name),'private fixture');for(const name of ['.codex','.claude','.gemini']){mkdirSync(join(source,name));writeFileSync(join(source,name,'session.json'),'private fixture');}
  const summary=await service.register(scope,{source:{kind:'tree',path:source},config},true);expect(summary.excludedEntries).toBe(5);expect(summary.sourceFileCount).toBe(2);const selected=await service.open({selectionId:summary.selectionId,scope});expect(selected.header.files.map(f=>f.path)).toEqual(['auth_client.py','pyproject.toml']);expect(Buffer.from(selected.chunks[0]).toString()).toBe('# normal source stays selected\n');
  // Execute only the trusted shared path guard and standard-library archive
  // metadata parsers on synthetic memory fixtures. No VM or backend runs.
  const program = `import io, pathlib, re, tarfile, zipfile
${PYTHON_BUILD_SOURCE_PATH_GUARD}
def refused(path):
    try:
        checked_path(path, source=True)
    except AssertionError:
        return
    raise AssertionError('known credential path accepted')
for name in ['project/auth.json', 'project/storage-state.json', 'project/.codex/session.json', 'project/.claude/session.json', 'project/.gemini/session.json']:
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as writer:
        writer.writestr(name, 'synthetic fixture')
    with zipfile.ZipFile(io.BytesIO(archive.getvalue())) as reader:
        refused(reader.infolist()[0].filename)
archive = io.BytesIO()
with tarfile.open(fileobj=archive, mode='w:gz', format=tarfile.PAX_FORMAT) as writer:
    entry = tarfile.TarInfo('project/safe.json')
    entry.size = 1
    entry.pax_headers = {'path': 'project/.gemini/session.json'}
    writer.addfile(entry, io.BytesIO(b'x'))
with tarfile.open(fileobj=io.BytesIO(archive.getvalue()), mode='r:gz') as reader:
    entry = next(iter(reader))
    assert entry.name == 'project/.gemini/session.json'
    refused(entry.name)
assert str(checked_path('project/auth_client.py', source=True)) == 'project/auth_client.py'
print('shared credential path guard: PASS')
`;
  const observed=spawnSync('/usr/bin/python3',['-I','-S','-c',program],{encoding:'utf8',timeout:5000,maxBuffer:4096});expect(observed.status).toBe(0);expect(observed.stdout.trim()).toBe('shared credential path guard: PASS');
 }finally{service.close();rmSync(root,{recursive:true,force:true});}
});
