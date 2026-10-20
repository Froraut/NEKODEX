'use strict';
const { createHash } = require('node:crypto');
const PYTHON_BUILD_SELECTION_LIMITS = Object.freeze({ bytes: 48 * 1024 * 1024, fileBytes: 16 * 1024 * 1024, files: 2080, headerBytes: 2 * 1024 * 1024, requestBytes: 4096 });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail() { throw new Error('Python build selection unavailable'); }
function object(x) { if (!x || Object.getPrototypeOf(x) !== Object.prototype) fail(); return x; }
function exact(x, allowed, required = allowed) { object(x); if (Object.keys(x).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(x, k))) fail(); }
function text(x, max = 512) { if (typeof x !== 'string' || !x.length || x.length > max || /[\x00-\x1f\x7f]/.test(x)) fail(); return x; }
function safePath(x) { text(x); if (!/^[A-Za-z0-9_.+@/-]+$/.test(x) || x.startsWith('/') || x.split('/').some(p => !p || p === '.' || p === '..')) fail(); return x; }
function parsePythonBuildScope(scope) { exact(scope, ['taskId', 'generation', 'toolCallId']); if (!uuid.test(scope.taskId) || !Number.isSafeInteger(scope.generation) || scope.generation < 1) fail(); return { taskId: scope.taskId, generation: scope.generation, toolCallId: text(scope.toolCallId, 200) }; }
function parsePythonBuildSelectionRequest(raw) { exact(raw, ['selectionId', 'scope']); if (!uuid.test(raw.selectionId)) fail(); return { selectionId: raw.selectionId, scope: parsePythonBuildScope(raw.scope) }; }
function strings(x, max = 128) { if (!Array.isArray(x) || x.length > max) fail(); return x.map(s => text(s, 4096)); }
function parsePythonBuildConfig(raw) {
  exact(raw, ['name','version','backend','backendPath','buildRequires','additionalBuildRequires','directArtifacts','configSettings','timeoutMs'], ['name','version','backend','buildRequires']);
  const value = { name: text(raw.name, 128), version: text(raw.version, 128), backend: text(raw.backend, 256), buildRequires: strings(raw.buildRequires) };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name) || !/^[A-Za-z0-9_.+!]+$/.test(value.version) || !/^[A-Za-z_][A-Za-z0-9_.]*(?::[A-Za-z_][A-Za-z0-9_.]*)?$/.test(value.backend)) fail();
  if (raw.backendPath !== undefined) value.backendPath = strings(raw.backendPath, 16).map(p => p === '.' ? p : safePath(p));
  if (raw.additionalBuildRequires !== undefined) value.additionalBuildRequires = strings(raw.additionalBuildRequires);
  if (raw.configSettings !== undefined) { object(raw.configSettings); if (Object.keys(raw.configSettings).length > 32) fail(); value.configSettings = {}; for (const [k,v] of Object.entries(raw.configSettings)) { text(k,128); Object.defineProperty(value.configSettings,k,{value: typeof v === 'string' ? text(v,4096) : strings(v,32), enumerable:true}); } }
  if (raw.timeoutMs !== undefined) { if (!Number.isSafeInteger(raw.timeoutMs) || raw.timeoutMs < 1000 || raw.timeoutMs > 600000) fail(); value.timeoutMs = raw.timeoutMs; }
  if (raw.directArtifacts !== undefined) { if (!Array.isArray(raw.directArtifacts) || raw.directArtifacts.length > 256) fail(); value.directArtifacts = raw.directArtifacts.map(p => { exact(p,['url','artifactSha256']); const u = new URL(text(p.url,4096)); if (!['file:','https:'].includes(u.protocol) || u.username || u.password || u.search || !/\.whl$/i.test(u.pathname) || u.hash && !/^#sha256=[a-f0-9]{64}$/i.test(u.hash) || !/^[a-f0-9]{64}$/.test(p.artifactSha256)) fail(); return {url:p.url,artifactSha256:p.artifactSha256}; }); }
  if (Buffer.byteLength(JSON.stringify(value)) > 65536) fail(); return value;
}
function selectionDigest(header) { const {version,selectionId,scope,config,sourceKind,files} = header; return createHash('sha256').update(JSON.stringify({version,selectionId,scope:{taskId:scope.taskId,generation:scope.generation},config,sourceKind,files})).digest('hex'); }
function parsePythonBuildSelectionHeader(raw) {
  exact(raw,['version','selectionId','scope','config','sourceKind','files','snapshotDigest','instanceId']);
  if (raw.version !== 1 || !uuid.test(raw.selectionId) || !uuid.test(raw.instanceId) || !['tree','zip','tar.gz'].includes(raw.sourceKind) || !Array.isArray(raw.files) || !raw.files.length || raw.files.length > PYTHON_BUILD_SELECTION_LIMITS.files) fail();
  const scope = parsePythonBuildScope(raw.scope), config = parsePythonBuildConfig(raw.config), names = new Set(); let total = 0, source = 0, archive = 0, build = 0, runtime = 0;
  const files = raw.files.map(f => { exact(f,['role','path','sha256','bytes']); if (!['source','source-archive','build-wheel','runtime-wheel'].includes(f.role) || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.role !== 'source' && f.bytes === 0 || f.bytes > PYTHON_BUILD_SELECTION_LIMITS.fileBytes) fail(); const path = safePath(f.path), key = f.role + ':' + path.toLowerCase(); if (names.has(key)) fail(); names.add(key); total += f.bytes; if (f.role === 'source') source++; if (f.role === 'source-archive') archive++; if (f.role === 'build-wheel') build++; if (f.role === 'runtime-wheel') runtime++; return {role:f.role,path,sha256:f.sha256,bytes:f.bytes}; });
  if (total > PYTHON_BUILD_SELECTION_LIMITS.bytes || source > 2048 || build > 16 || runtime > 16 || (raw.sourceKind === 'tree' ? source < 1 || archive !== 0 : source !== 0 || archive !== 1)) fail();
  const h = {version:1,selectionId:raw.selectionId,scope,config,sourceKind:raw.sourceKind,files,snapshotDigest:raw.snapshotDigest,instanceId:raw.instanceId}; if (selectionDigest(h) !== h.snapshotDigest) fail(); return h;
}
module.exports = {PYTHON_BUILD_SELECTION_LIMITS, parsePythonBuildScope, parsePythonBuildConfig, parsePythonBuildSelectionRequest, parsePythonBuildSelectionHeader, selectionDigest, safePythonBuildPath:safePath};
