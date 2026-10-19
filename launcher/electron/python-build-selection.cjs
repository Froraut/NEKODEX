'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const {PYTHON_BUILD_SELECTION_LIMITS:L,parsePythonBuildScope,parsePythonBuildConfig,parsePythonBuildSelectionRequest,selectionDigest,safePythonBuildPath} = require('./python-build-selection-contract.cjs');
const {excludedPythonBuildSourceName} = require('./python-build-source-policy.cjs');
const hash = b => createHash('sha256').update(b).digest('hex');
function fail() { throw new Error('Python build selection unavailable'); }
function same(a,b) { return a.taskId === b.taskId && a.generation === b.generation; }
/** Native-picker/main-only paths. Renderer receives no source bytes or host paths. */
function createPythonBuildSelectionService({assertScope}) {
  if (typeof assertScope !== 'function') fail(); const selections = new Map(); let retainedBytes = 0;
  async function current(scope) { try { const result = await assertScope({...scope}); if (result === false) fail(); } catch { fail(); } }
  async function register(scopeInput, input, explicitUserAction) {
    const scope = parsePythonBuildScope(scopeInput); if (explicitUserAction !== true || selections.size >= 8) fail(); await current(scope);
    try {
      const config = parsePythonBuildConfig(input.config), files = [], chunks = [], pins = []; let total = 0, visited = 0, excluded = 0;
      const skip = excludedPythonBuildSourceName;
      function pin(p,directory = false) { const s = fs.lstatSync(p,{bigint:true}); if (fs.realpathSync(p) !== p || s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n)) fail(); return {p,s,directory}; }
      function unchanged(q) { const s = fs.lstatSync(q.p,{bigint:true}); if (fs.realpathSync(q.p) !== q.p || ['dev','ino','size','mtimeNs','ctimeNs','mode'].some(k => q.s[k] !== s[k])) fail(); }
      function add(p,role,name) {
        const q = pin(p); if (q.s.size < 0n || role !== 'source' && q.s.size === 0n || q.s.size > BigInt(L.fileBytes) || files.length >= L.files || (total += Number(q.s.size)) > L.bytes || retainedBytes + total > 64 * 1024 * 1024) fail();
        const fd = fs.openSync(p,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); let bytes;
        try { const opened = fs.fstatSync(fd,{bigint:true}); if (opened.ino !== q.s.ino || opened.dev !== q.s.dev) fail(); bytes = Buffer.alloc(Number(q.s.size)); let n = 0; while(n < bytes.length) { const got = fs.readSync(fd,bytes,n,bytes.length-n,null); if (!got) fail(); n += got; } const extra = Buffer.alloc(1); if (fs.readSync(fd,extra,0,1,null)) fail(); unchanged(q); } finally { fs.closeSync(fd); }
        pins.push(q); files.push({role,path:safePythonBuildPath(name),sha256:hash(bytes),bytes:bytes.length}); chunks.push(bytes);
      }
      if (!input.source || !['tree','zip','tar.gz'].includes(input.source.kind) || !path.isAbsolute(input.source.path)) fail();
      const sourceRoot = input.source.path;
      if (input.source.kind === 'tree') {
        function walk(dir,relative) { const q = pin(dir,true); pins.push(q); const names = fs.readdirSync(dir).sort(); if (names.length > 4096 || (visited += names.length) > 8192) fail(); for (const name of names) { if (skip(name)) { excluded++; continue; } const absolute = path.join(dir,name), rel = relative ? relative + '/' + name : name; const s = fs.lstatSync(absolute); if (s.isDirectory()) walk(absolute,rel); else { if (files.filter(f => f.role === 'source').length >= 2048) fail(); add(absolute,'source',rel); } } }
        walk(sourceRoot,''); if (!files.some(f => f.role === 'source' && f.path === 'pyproject.toml')) fail();
      } else add(sourceRoot,'source-archive',path.basename(sourceRoot));
      for (const [role,paths] of [['build-wheel',input.buildWheelPaths ?? []],['runtime-wheel',input.runtimeWheelPaths ?? []]]) { if (!Array.isArray(paths) || paths.length > 16) fail(); for (const p of paths) { if (!path.isAbsolute(p) || !/\.whl$/.test(p)) fail(); add(p,role,path.basename(p)); } }
      pins.forEach(unchanged); await current(scope);
      const selectionId = randomUUID(), packet = {version:1,selectionId,scope,config,sourceKind:input.source.kind,files}; packet.snapshotDigest = selectionDigest(packet);
      if (Buffer.byteLength(JSON.stringify(packet)) > L.headerBytes || selections.size >= 8 || retainedBytes + total > 64 * 1024 * 1024) fail(); selections.set(selectionId,{packet,chunks,total}); retainedBytes += total;
      return {selectionId,name:config.name,version:config.version,sourceKind:input.source.kind,sourceFileCount:files.filter(f=>f.role==='source').length,buildWheelCount:files.filter(f=>f.role==='build-wheel').length,runtimeWheelCount:files.filter(f=>f.role==='runtime-wheel').length,bytes:total,snapshotDigest:packet.snapshotDigest,excludedEntries:excluded};
    } catch { fail(); }
  }
  async function open(raw) { const request = parsePythonBuildSelectionRequest(raw); await current(request.scope); const row = selections.get(request.selectionId); if (!row || !same(row.packet.scope,request.scope)) fail(); return { header: structuredClone({...row.packet,scope:request.scope}), chunks: [...row.chunks], assertCurrent:async()=>{if(selections.get(request.selectionId)!==row)fail();await current(request.scope);} }; }
  function revoke(selectionId) { const row = selections.get(selectionId); if(row) {retainedBytes -= row.total;selections.delete(selectionId);} }
  return Object.freeze({register,open,revoke,close(){selections.clear();retainedBytes=0;}});
}
module.exports = {createPythonBuildSelectionService};
