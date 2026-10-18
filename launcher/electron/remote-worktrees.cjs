"use strict";
const posix = require('node:path').posix;
const { randomUUID } = require('node:crypto');
const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function fail(message) { throw new Error(message); }

// Fixed protocol program. Host/root/action payloads enter as JSON, while every
// Git invocation is a fixed argv list. No repository-controlled callbacks run.
const REMOTE_GIT_HELPER = String.raw`import os,sys,json,subprocess,tempfile,time,re,hashlib,stat
r=json.loads(sys.stdin.buffer.readline(131073)); phase='preflight'; mutated=False
root=r['root']; action=r['action']; p=r.get('payload',{}); scope=r['scope']
def canonical(directory):
 if os.path.realpath(directory)!=directory or not os.path.isdir(directory): raise RuntimeError('Canonical remote directory changed')
 return directory
def identity(directory):
 s=os.lstat(directory)
 if not stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode): raise RuntimeError('Directory identity is unsafe')
 return str(s.st_dev)+':'+str(s.st_ino)
canonical(root)
env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
env.update({'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_NO_LAZY_FETCH':'1','GIT_LFS_SKIP_SMUDGE':'1','GIT_ALLOW_PROTOCOL':'','GIT_PROTOCOL_FROM_USER':'0','GIT_ASKPASS':'','SSH_ASKPASS':'','GIT_PAGER':'cat'})
opts=['--no-pager','--no-optional-locks','-c','core.hooksPath=','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','core.sparseCheckout=false','-c','submodule.recurse=false','-c','diff.external=','-c','credential.helper=','-c','core.askPass=','-c','core.sshCommand=false','-c','protocol.allow=never','-c','protocol.ssh.allow=never','-c','protocol.ext.allow=never','-c','protocol.file.allow=never']
def raw(args,directory=root,mutation=False,allowed=(0,)):
 with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err:
  child=subprocess.Popen(['git']+opts+['-C',directory]+args,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err)
  start=time.monotonic()
  while child.poll() is None:
   excessive=os.fstat(out.fileno()).st_size+os.fstat(err.fileno()).st_size>1048576
   if excessive or (not mutation and time.monotonic()-start>10):
    child.terminate(); child.wait(); raise RuntimeError('Git output or read bound reached; inspect operation state')
   time.sleep(.02)
  if os.fstat(out.fileno()).st_size+os.fstat(err.fileno()).st_size>1048576: raise RuntimeError('Git response exceeds bound')
  if child.returncode not in allowed: raise RuntimeError('Git operation failed (exit '+str(child.returncode)+'); existing checkout and intent retained')
  out.seek(0); return out.read().decode('utf-8','strict')
try:
 def suppressFilters(directory):
  config=raw(['config','--null','--name-only','--get-regexp',r'^filter\..*\.(clean|smudge|process|required)$'],directory,allowed=(0,1))
  names=set()
  for key in config.split('\0'):
   if not key: continue
   match=re.fullmatch(r'filter\.(.+)\.(clean|smudge|process|required)',key,re.I)
   if not match or not re.fullmatch(r'[A-Za-z0-9._/-]{1,200}',match[1]): raise RuntimeError('Unsupported Git callback configuration')
   names.add(match[1])
   if len(names)>128: raise RuntimeError('Too many Git filter drivers')
  for name in names:
   for field in ['clean','smudge','process','required']: opts.extend(['-c','filter.'+name+'.'+field+'='+('false' if field=='required' else '')])
 suppressFilters(root)
 top=os.path.realpath(raw(['rev-parse','--show-toplevel']).strip())
 if top!=root: raise RuntimeError('Selected remote root must be the Git top-level folder')
 common=os.path.realpath(os.path.join(root,raw(['rev-parse','--git-common-dir']).strip()))
 sourceIdentity=identity(root); commonIdentity=identity(common)
 def snapshot():
  head=raw(['rev-parse','--verify','HEAD^{commit}']).strip()
  if not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}',head): raise RuntimeError('Invalid captured Git HEAD')
  listing=raw(['worktree','list','--porcelain','-z'])
  return {'headOid':head,'worktreeDigest':hashlib.sha256(listing.encode()).hexdigest(),'sourceIdentity':sourceIdentity,'commonDir':common,'commonIdentity':commonIdentity,'parent':os.path.dirname(root),'parentIdentity':identity(os.path.dirname(root))}
 def ownership(record):
  if record['sourceRoot']!=root or record['hostFingerprint']!=scope['fingerprint'] or record['sourceIdentity']!=sourceIdentity or record['commonDir']!=common or record['commonIdentity']!=commonIdentity: raise RuntimeError('Managed worktree source ownership changed')
  parent=record['parent']; canonical(parent)
  if parent!=os.path.dirname(root) or identity(parent)!=record['parentIdentity']: raise RuntimeError('Remote parent grant changed')
  managed=os.path.join(parent,'.nekodex-worktrees'); canonical(managed)
  if record['path']!=os.path.join(managed,record['id']) or record['marker']!=os.path.join(managed,'.owners',record['id']+'.json'): raise RuntimeError('Managed path is outside its exact parent grant')
  marker=record['marker']; ms=os.lstat(marker)
  if not stat.S_ISREG(ms.st_mode) or stat.S_ISLNK(ms.st_mode) or ms.st_size>32768: raise RuntimeError('Ownership marker is unsafe')
  fd=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd) as f: saved=json.load(f)
  for key in ['id','sourceRoot','hostFingerprint','branch','headOid','commonDir','commonIdentity','sourceIdentity','parent','parentIdentity','path','marker']:
   if saved.get(key)!=record.get(key): raise RuntimeError('Remote ownership marker does not match the creation intent')
  canonical(record['path'])
  if record.get('identity') and identity(record['path'])!=record['identity']: raise RuntimeError('Managed checkout directory identity changed')
  actualCommon=os.path.realpath(os.path.join(record['path'],raw(['rev-parse','--git-common-dir'],record['path']).strip()))
  actualTop=os.path.realpath(raw(['rev-parse','--show-toplevel'],record['path']).strip())
  branch=raw(['symbolic-ref','--short','HEAD'],record['path']).strip()
  if actualCommon!=common or actualTop!=record['path'] or branch!=record['branch']: raise RuntimeError('Managed Git worktree identity or branch changed')
  listing=raw(['worktree','list','--porcelain','-z'])
  if ('worktree '+record['path']+'\0') not in listing or ('branch refs/heads/'+record['branch']+'\0') not in listing: raise RuntimeError('Git no longer registers this owned checkout')
  suppressFilters(record['path'])
  dirty=raw(['status','--porcelain=v1','-z','--untracked-files=all','--ignored=matching'],record['path'])
  head=raw(['rev-parse','--verify','HEAD^{commit}'],record['path']).strip()
  result={'headOid':head,'dirty':bool(dirty),'statusDigest':hashlib.sha256(dirty.encode()).hexdigest(),'identity':identity(record['path'])}
  archiveRef='refs/nekodex/remote-archives/'+record['id']
  archived=raw(['rev-parse','--verify',archiveRef],allowed=(0,128)).strip()
  if archived: result.update({'archiveRef':archiveRef,'archivedHeadOid':archived,'checkoutRetained':True})
  return result
 if action=='inspect-source': result=snapshot()
 elif action=='create':
  current=snapshot(); expected=p['snapshot']
  if current!=expected: raise RuntimeError('Captured source HEAD, worktree list or directory identity is stale; inspect again')
  record=p['record']
  if not re.fullmatch(r'[a-f0-9-]{36}',record['id']) or not re.fullmatch(r'codex/[a-z][a-z0-9-]{0,47}',record['branch']) or record['headOid']!=current['headOid']: raise RuntimeError('Invalid reviewed worktree plan')
  if record['parent']!=current['parent'] or record['parentIdentity']!=current['parentIdentity'] or record['hostFingerprint']!=scope['fingerprint']: raise RuntimeError('Parent or host grant does not match')
  parent=canonical(current['parent']); managed=os.path.join(parent,'.nekodex-worktrees')
  if not os.path.lexists(managed): os.mkdir(managed,0o700)
  canonical(managed)
  if os.lstat(managed).st_uid!=os.getuid() or os.lstat(managed).st_mode&0o077: raise RuntimeError('Managed parent must be owner-only')
  owners=os.path.join(managed,'.owners')
  if not os.path.lexists(owners): os.mkdir(owners,0o700)
  canonical(owners)
  if os.lstat(owners).st_uid!=os.getuid() or os.lstat(owners).st_mode&0o077: raise RuntimeError('Ownership marker parent must be owner-only')
  if record['path']!=os.path.join(managed,record['id']) or record['marker']!=os.path.join(owners,record['id']+'.json') or os.path.lexists(record['path']): raise RuntimeError('Managed target already exists or differs from the reviewed plan')
  phase='remote-intent'; mutated=True
  fd=os.open(record['marker'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as f: json.dump(record,f); f.flush(); os.fsync(f.fileno())
  phase='git-create'
  raw(['worktree','add','--no-guess-remote','--no-track','-b',record['branch'],'--',record['path'],record['headOid']],mutation=True)
  phase='verify-created'; result=ownership(record)
 elif action in ['inspect-owned','archive']:
  record=p['record']; result=ownership(record)
  if action=='archive':
   if result!=p['expected']: raise RuntimeError('Managed worktree changed after archive review; inspect again')
   phase='git-archive'; mutated=True
   ref='refs/nekodex/remote-archives/'+record['id']
   raw(['update-ref',ref,result['headOid'],'0'*len(result['headOid'])],mutation=True)
   # Archive preserves tracked, untracked and ignored bytes in the same checkout.
   # No worktree remove/reset/clean or implicit directory deletion is performed.
   result.update({'archiveRef':ref,'checkoutRetained':True})
 else: raise RuntimeError('Unsupported remote Git operation')
 print(json.dumps({'ok':True,'result':result,'phase':phase,'mutated':mutated}))
except Exception as error: print(json.dumps({'ok':False,'message':str(error),'phase':phase,'mutated':mutated}))
`;

function createRemoteWorktreeController({ withHost, getRecords, storeRecords, begin, finish }) {
  const sourceCaptures = new Map(); const plans = new Map(); const archivePlans = new Map();
  const scopeMatch = (a, s) => a.hostId === s.hostId && a.fingerprint === s.fingerprint && a.connectionId === s.connectionId && a.root === s.root;
  const publicScope = s => ({ hostId: s.hostId, fingerprint: s.fingerprint, connectionId: s.connectionId, root: s.root, hostname: s.hostname, username: s.username, port: s.port });
  const observed = (record, result) => ({ ...result, headOid: record.headOid, currentHeadOid: result.headOid });
  function update(record, changes) { const value = { ...record, ...changes }; storeRecords(getRecords().map(r => r.id === record.id ? value : r)); return value; }
  function recordOf(id, worktreeId, scope) { const record = getRecords().find(r => r.id === worktreeId && r.hostId === id); if (!record || record.hostFingerprint !== scope.fingerprint || record.sourceRoot !== scope.root) fail('Select an owned worktree for this exact remote host and root.'); return record; }
  async function checked(run, action, payload) { const response = await run(action, payload); if (!response?.ok) throw Object.assign(new Error(response?.message || 'Remote Git returned no terminal result.'), { remoteMutated: response?.mutated, phase: response?.phase }); return response.result; }
  return {
    inspect: id => withHost(id, async (s, run) => { const snapshot = await checked(run, 'inspect-source', {}); const capture = { ...publicScope(s), captureId: randomUUID(), ...snapshot }; sourceCaptures.set(capture.captureId, capture); while (sourceCaptures.size > 24) sourceCaptures.delete(sourceCaptures.keys().next().value); return capture; }, 'worktree-inspect'),
    prepare: (id, input) => withHost(id, async (s) => {
      if (!input || typeof input.name !== 'string' || !NAME.test(input.name)) fail('Use a lowercase worktree name beginning with a letter (up to 48 characters).');
      const capture = sourceCaptures.get(input.captureId); if (!capture || !scopeMatch(capture, s)) fail('Inspect the source on this connection before reviewing a worktree.');
      const { captureId, hostId, fingerprint, connectionId, root, hostname, username, port, ...snapshot } = capture;
      const resourceId = randomUUID(); const managed = posix.join(capture.parent, '.nekodex-worktrees');
      const record = { id: resourceId, hostId: id, hostFingerprint: s.fingerprint, sourceRoot: s.root, sourceIdentity: capture.sourceIdentity, commonDir: capture.commonDir, commonIdentity: capture.commonIdentity, parent: capture.parent, parentIdentity: capture.parentIdentity, path: managed + '/' + resourceId, marker: managed + '/.owners/' + resourceId + '.json', branch: 'codex/' + input.name, headOid: capture.headOid, state: 'creating', createdAt: new Date().toISOString() };
      const plan = { ...publicScope(s), token: randomUUID(), record, snapshot }; plans.set(plan.token, plan); for (const [token, other] of plans) if (token !== plan.token && other.hostId === id) plans.delete(token); return plan;
    }, 'worktree-review'),
    create: (id, token) => withHost(id, async (s, run) => {
      const plan = plans.get(token); if (!plan || !scopeMatch(plan, s)) fail('Review this exact worktree on the current host connection first.'); plans.delete(token);
      if (getRecords().length >= 24) fail('Managed remote worktree limit reached.'); const record = plan.record; storeRecords([...getRecords(), record]);
      const receipt = begin(id, 'worktree-create', { state: 'started', path: record.path, branch: record.branch, headOid: record.headOid, worktreeId: record.id, approvalId: token });
      try { const result = await checked(run, 'create', { record, snapshot: plan.snapshot }); const saved = update(record, { state: 'ready', ...observed(record, result) }); return { worktree: saved, receipt: finish(receipt.id, { state: 'completed', path: saved.path }) }; }
      catch (error) { const uncertain = error.remoteMutated !== false; const saved = update(record, { state: uncertain ? 'needs-inspection' : 'failed', message: error.message }); return { worktree: saved, receipt: finish(receipt.id, { state: uncertain ? 'unknown' : 'failed', message: error.message }) }; }
    }, 'worktree-create', true),
    list: id => withHost(id, async s => getRecords().filter(r => r.hostId === id && r.hostFingerprint === s.fingerprint && r.sourceRoot === s.root), 'worktree-inspect'),
    inspectOwned: (id, worktreeId) => withHost(id, async (s, run) => { const record = recordOf(id, worktreeId, s); const result = await checked(run, 'inspect-owned', { record }); return update(record, { ...observed(record, result), state: record.state === 'archived' || result.archiveRef ? 'archived' : 'ready', inspectedAt: new Date().toISOString() }); }, 'worktree-inspect'),
    prepareArchive: (id, worktreeId) => withHost(id, async (s, run) => { const record = recordOf(id, worktreeId, s); if (record.state !== 'ready') fail('Inspect this worktree successfully before archive review.'); const expected = await checked(run, 'inspect-owned', { record }); const plan = { ...publicScope(s), token: randomUUID(), record, expected }; for (const [token, previous] of archivePlans) if (previous.hostId === id) archivePlans.delete(token); archivePlans.set(plan.token, plan); return plan; }, 'worktree-review'),
    archive: (id, token) => withHost(id, async (s, run) => { const plan = archivePlans.get(token); if (!plan || !scopeMatch(plan, s)) fail('Review this exact owned checkout before archiving.'); archivePlans.delete(token); const record = recordOf(id, plan.record.id, s); update(record, { state: 'archiving' }); const receipt = begin(id, 'worktree-archive', { state: 'started', path: record.path, worktreeId: record.id, approvalId: token });
      try { const result = await checked(run, 'archive', { record, expected: plan.expected }); return { worktree: update(record, { ...observed(record, result), state: 'archived', archivedAt: new Date().toISOString() }), receipt: finish(receipt.id, { state: 'completed', checkoutRetained: true }) }; }
      catch (error) { const uncertain = error.remoteMutated !== false; return { worktree: update(record, { state: uncertain ? 'needs-inspection' : 'ready', message: error.message }), receipt: finish(receipt.id, { state: uncertain ? 'unknown' : 'failed', message: error.message }) }; }
    }, 'worktree-archive', true),
  };
}
module.exports = { REMOTE_GIT_HELPER, createRemoteWorktreeController };
