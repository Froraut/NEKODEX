"use strict";

// This is a fixed protocol, not a command template. Repository data enters only
// JSON/stdin or literal paths after `--`; no renderer-supplied Git options run.
const REMOTE_GIT_REVIEW_HELPER = String.raw`import os,sys,json,subprocess,time,re,hashlib,stat,base64,selectors,errno
phase='preflight'; mutated=False; accepted=True; ledger=None; ledger_path=None; ledger_durable=False; write_uncertain=False; owned_lock=None
MAX_OUTPUT=1048576; MAX_FILE=262144; MAX_SELECTED=393216
class Refusal(Exception): pass
def refuse(message): raise Refusal(message)
def packed(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')
def digest(value): return hashlib.sha256(packed(value)).hexdigest()
def sha(data): return hashlib.sha256(data).hexdigest()
def oid(value): return isinstance(value,str) and re.fullmatch(r'(?:[a-f0-9]{40}|[a-f0-9]{64})',value) is not None
def directory(path):
 if not isinstance(path,str) or os.path.realpath(path)!=path: refuse('Canonical directory changed')
 s=os.lstat(path)
 if not stat.S_ISDIR(s.st_mode): refuse('Repository directory is unsafe')
 return str(s.st_dev)+':'+str(s.st_ino)
def relative(value):
 if not isinstance(value,str) or not value or len(value.encode('utf-8'))>4096 or value.startswith('/') or any(c in value for c in '\0\r\n') or any(ord(c)<32 for c in value): refuse('Unsupported Git path')
 if any(part in ('','.', '..','.git') for part in value.split('/')): refuse('Unsupported Git path')
 return value
def read_file(path,limit,private=False):
 try: fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 except FileNotFoundError: return None
 with os.fdopen(fd,'rb') as f:
  before=os.fstat(f.fileno())
  if not stat.S_ISREG(before.st_mode) or before.st_size>limit: refuse('File exceeds the supported read boundary')
  if private and (before.st_uid!=os.getuid() or before.st_nlink!=1 or before.st_mode&0o077): refuse('Private action record is unsafe')
  data=f.read(limit+1); after=os.fstat(f.fileno()); final=os.lstat(path)
  signature=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  if len(data)>limit or signature(before)!=signature(after) or signature(after)!=signature(final): refuse('File changed during capture')
  return data
def sync_directory(path):
 global write_uncertain
 try:
  fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try: os.fsync(fd)
  finally: os.close(fd)
 except BaseException:
  write_uncertain=True
  raise
def private_directory(path):
 try: os.mkdir(path,0o700); sync_directory(os.path.dirname(path))
 except FileExistsError: pass
 directory(path); s=os.lstat(path)
 if s.st_uid!=os.getuid() or s.st_mode&0o077: refuse('Action directory must be private')
def durable(path,value,create=False):
 data=packed(value)
 if len(data)>MAX_OUTPUT: refuse('Action record exceeds its boundary')
 if create:
  fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
  try:
   with os.fdopen(fd,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
  except BaseException: raise
 else:
  read_file(path,MAX_OUTPUT,True)
  temporary=path+'.next-'+str(os.getpid())
  fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
  try:
   with os.fdopen(fd,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
   os.replace(temporary,path)
  finally:
   if os.path.lexists(temporary): os.unlink(temporary)
 sync_directory(os.path.dirname(path))
def persist_record(path,value,create=False):
 global write_uncertain
 if write_uncertain: refuse('Durable action state requires exact inspection')
 try: durable(path,value,create)
 except BaseException:
  # Rename/fsync may already have published newer evidence. Never overwrite it
  # with an older in-memory record from a subsequent exception handler.
  write_uncertain=True
  raise
def save(**fields):
 global ledger,ledger_durable
 next_record=dict(ledger); next_record.update(fields)
 persist_record(ledger_path,next_record)
 ledger=next_record; ledger_durable=True
def identity_stat(s): return [str(s.st_dev),str(s.st_ino),str(s.st_size),str(s.st_mtime_ns),str(s.st_ctime_ns),str(s.st_mode)]
def process_identity(pid):
 if sys.platform.startswith('linux'):
  try:
   with open('/proc/'+str(pid)+'/stat','rb') as f: value=f.read(8192)
  except FileNotFoundError: return None
  fields=value[value.rfind(b') ')+2:].split()
  if len(fields)<20: refuse('Cannot establish remote mutation owner')
  if fields[0] in (b'Z',b'X'): return None
  return {'pid':pid,'start':fields[19].decode('ascii')}
 if sys.platform=='darwin':
  import ctypes,struct
  lib=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True); buffer=ctypes.create_string_buffer(136)
  lib.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
  count=lib.proc_pidinfo(pid,3,0,buffer,136)
  if count!=136:
   if ctypes.get_errno()==errno.ESRCH: return None
   refuse('Cannot establish remote mutation owner')
  seconds,micros=struct.unpack_from('=QQ',buffer.raw,120)
  return {'pid':pid,'start':str(seconds)+':'+str(micros)}
 refuse('Remote mutation owner observation is unsupported on this platform')
def work_file(path,include=False):
 relative(path); full=os.path.join(root,path)
 parent=os.path.dirname(full)
 if os.path.realpath(parent)!=parent or os.path.commonpath([root,parent])!=root: refuse('Selected path has a symbolic-link parent')
 try: before=os.lstat(full)
 except FileNotFoundError: return {'revision':None,'mode':'000000','remove':True}
 if stat.S_ISLNK(before.st_mode):
  data=os.fsencode(os.readlink(full)); mode='120000'
 elif stat.S_ISREG(before.st_mode):
  data=read_file(full,MAX_FILE); mode='100755' if before.st_mode&0o111 else '100644'
 else: refuse('Only regular files and symbolic links are supported')
 if len(data)>MAX_FILE or identity_stat(before)!=identity_stat(os.lstat(full)): refuse('Selected file changed or exceeds the file boundary')
 result={'revision':digest({'identity':identity_stat(before),'sha256':sha(data),'mode':mode}),'mode':mode,'sha256':sha(data),'bytes':len(data)}
 if include: result['data']=base64.b64encode(data).decode('ascii')
 return result
try:
 line=sys.stdin.buffer.readline(2097153)
 if len(line)>2097152: refuse('Request exceeds the protocol boundary')
 r=json.loads(line); root=r['root']; scope=r['scope']; action=r['action']; p=r.get('payload',{})
 accepted=action in ('apply','inspect')
 directory(root)
 if not isinstance(scope,dict) or not isinstance(scope.get('fingerprint'),str) or not isinstance(scope.get('username'),str): refuse('Missing connected repository scope')
 stable_scope={k:v for k,v in scope.items() if k!='connectionId'}
 env={k:v for k,v in os.environ.items() if not k.startswith('GIT_') and k not in ('SSH_ASKPASS','GIT_ASKPASS','GIT_EDITOR','VISUAL','EDITOR','PAGER')}
 env.update({'PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','GIT_OPTIONAL_LOCKS':'0','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_LITERAL_PATHSPECS':'1','GIT_LFS_SKIP_SMUDGE':'1','GIT_ALLOW_PROTOCOL':'','GIT_PROTOCOL_FROM_USER':'0','GIT_ASKPASS':'','SSH_ASKPASS':'','GIT_PAGER':'','GIT_EDITOR':'false','GIT_SEQUENCE_EDITOR':'false','LC_ALL':'C','GIT_ATTR_NOSYSTEM':'1'})
 opts=['--no-pager','--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','core.untrackedCache=false','-c','submodule.recurse=false','-c','diff.external=','-c','credential.helper=','-c','core.askPass=','-c','core.sshCommand=false','-c','protocol.allow=never','-c','protocol.ssh.allow=never','-c','protocol.ext.allow=never','-c','protocol.file.allow=never','-c','commit.gpgSign=false','-c','tag.gpgSign=false','-c','core.pager=','-c','core.attributesFile=/dev/null','-c','gc.auto=0','-c','maintenance.auto=false']
 def git(args,data=None,allowed=(0,),writing=False,extra_env=None,attribute_policy=True):
  child_env=env.copy()
  if extra_env: child_env.update(extra_env)
  selected_opts=opts
  if not attribute_policy:
   selected_opts=[]; i=0
   while i<len(opts):
    if opts[i:i+2]==['-c','core.attributesFile=/dev/null']: i+=2; continue
    selected_opts.append(opts[i]); i+=1
  child=subprocess.Popen(['/usr/bin/git']+selected_opts+['-C',root]+args,env=child_env,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  output=bytearray(); errors=bytearray(); selector=selectors.DefaultSelector(); start=time.monotonic(); offset=0
  for stream,label in [(child.stdout,'out'),(child.stderr,'err')]: os.set_blocking(stream.fileno(),False); selector.register(stream,selectors.EVENT_READ,label)
  if data is not None:
   os.set_blocking(child.stdin.fileno(),False)
   if data: selector.register(child.stdin,selectors.EVENT_WRITE,'in')
   else: child.stdin.close()
  try:
   while selector.get_map():
    if not writing and time.monotonic()-start>10: refuse('Git read deadline reached')
    for key,events in selector.select(.05):
     if key.data=='in':
      try: sent=os.write(key.fd,data[offset:offset+16384]); offset+=sent
      except BrokenPipeError: offset=len(data)
      if offset==len(data): selector.unregister(key.fileobj); key.fileobj.close()
     else:
      block=os.read(key.fd,65536)
      if not block: selector.unregister(key.fileobj); key.fileobj.close()
      else:
       (output if key.data=='out' else errors).extend(block)
       if len(output)+len(errors)>MAX_OUTPUT: refuse('Git output exceeds the protocol boundary')
   code=child.wait()
  except BaseException:
   if child.poll() is None: child.terminate(); child.wait()
   raise
  finally: selector.close()
  if code not in allowed: refuse('Git operation failed; retained action evidence must be inspected')
  return bytes(output)
 def text(args,**kwargs): return git(args,**kwargs).decode('utf-8','strict').strip()
 # config only parses data here; it never opens the configured attributes file.
 # Detect local/worktree explicit policy without our attributes override hiding
 # it. Global/system config is deliberately excluded by the fixed environment.
 configured_attributes=bool(git(['config','--null','--get-all','core.attributesFile'],allowed=(0,1),attribute_policy=False))
 isolated_policy='global_and_system_git_configuration_and_attributes_disabled'
 # Enumerate configured drivers before status/diff, then override every
 # executable filter field. No repository-controlled program is invoked.
 config=git(['config','--null','--name-only','--get-regexp',r'^filter\..*\.(clean|smudge|process|required)$'],allowed=(0,1))
 drivers=set()
 for rawkey in config.split(b'\0'):
  if not rawkey: continue
  match=re.fullmatch(r'filter\.(.+)\.(clean|smudge|process|required)',rawkey.decode('utf-8'),re.I)
  if not match or not re.fullmatch(r'[A-Za-z0-9._/-]{1,200}',match[1]): refuse('Unsupported Git callback configuration')
  drivers.add(match[1])
 if len(drivers)>128: refuse('Too many Git callback drivers')
 for driver in sorted(drivers):
  for field in ['clean','smudge','process','required']: opts.extend(['-c','filter.'+driver+'.'+field+'='+('false' if field=='required' else '')])
 if os.path.realpath(text(['rev-parse','--show-toplevel']))!=root: refuse('Selected root must be the canonical Git top-level directory')
 gitdir=os.path.realpath(text(['rev-parse','--absolute-git-dir']))
 common=os.path.realpath(os.path.join(root,text(['rev-parse','--git-common-dir'])))
 directory(gitdir); directory(common)
 index=os.path.join(gitdir,'index')
 gate_directory=os.path.join(common,'.nekodex-git-review'); gate_path=os.path.join(gate_directory,'owner.json')
 def index_digest():
  data=read_file(index,MAX_OUTPUT)
  return None if data is None else sha(data)
 def index_metadata():
  try: value=os.lstat(index)
  except FileNotFoundError: return None
  if not stat.S_ISREG(value.st_mode): refuse('Git index is not a regular file')
  return {'identity':str(value.st_dev)+':'+str(value.st_ino),'mode':stat.S_IMODE(value.st_mode),'uid':value.st_uid,'gid':value.st_gid,'bytes':value.st_size,'mtime':str(value.st_mtime_ns),'ctime':str(value.st_ctime_ns)}
 def merge_state():
  result={}
  for name in ['MERGE_HEAD','MERGE_MSG','MERGE_MODE']:
   data=read_file(os.path.join(gitdir,name),MAX_FILE)
   result[name]=None if data is None else {'sha256':sha(data),'data':base64.b64encode(data).decode('ascii')}
  return result
 def repository():
  head=text(['rev-parse','--verify','HEAD^{commit}'],allowed=(0,128,1)) or None
  ref=text(['symbolic-ref','-q','HEAD'],allowed=(0,1)) or None
  if head is not None and not oid(head): refuse('Unsupported HEAD identity')
  if ref is not None and not re.fullmatch(r'refs/heads/[^\x00-\x20~^:?*\[\\]+',ref): refuse('Unsupported HEAD reference')
  if head is None and ref is None: refuse('HEAD is neither a commit nor an unborn branch')
  merge=merge_state(); heads=[]
  if merge['MERGE_HEAD']:
   heads=base64.b64decode(merge['MERGE_HEAD']['data']).decode('ascii').splitlines()
   if not heads or len(heads)>8 or any(not oid(v) for v in heads) or head is None: refuse('Unsupported merge parent state')
   if len(set(heads))!=len(heads) or head in heads: refuse('Merge parent set contains duplicate commits')
  fmt=text(['rev-parse','--show-object-format'])
  if fmt not in ('sha1','sha256'): refuse('Unsupported object format')
  return {'rootIdentity':directory(root),'gitDir':gitdir,'gitIdentity':directory(gitdir),'commonDir':common,'commonIdentity':directory(common),'headOid':head,'headRef':ref,'indexDigest':index_digest(),'mergeHeads':heads,'mergeStateDigest':digest(merge),'objectFormat':fmt}
 def index_entries():
  result=[]
  for entry in git(['ls-files','--stage','-z']).split(b'\0'):
   if not entry: continue
   meta,path=entry.split(b'\t',1); mode,obj,stage=meta.decode('ascii').split(' '); path=relative(path.decode('utf-8'))
   if mode not in ('100644','100755','120000','160000') or not oid(obj) or stage not in ('0','1','2','3'): refuse('Unsupported index entry')
   result.append({'path':path,'mode':mode,'oid':obj,'stage':int(stage)})
  return result
 def limitations(entries):
  limits=[isolated_policy]
  if configured_attributes: limits.append('configured_attributes_file_not_supported')
  if any(e['mode']=='160000' for e in entries): limits.append('submodules_not_supported')
  for name in ['rebase-merge','rebase-apply','sequencer','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_START','AUTO_MERGE']:
   if os.path.lexists(os.path.join(gitdir,name)):
    # AUTO_MERGE is left by modern Git after a normal conflict and is not
    # workflow authority. It is intentionally retained, not consumed.
    if name!='AUTO_MERGE': limits.append('sequencer_not_supported')
  if os.path.lexists(os.path.join(gitdir,'MERGE_AUTOSTASH')): limits.append('merge_autostash_not_supported')
  if text(['config','--bool','--get','core.sparseCheckout'],allowed=(0,1))=='true': limits.append('sparse_checkout_not_supported')
  if text(['rev-parse','--shared-index-path']): limits.append('split_index_not_supported')
  flags=git(['ls-files','-v','-z'])
  if any(v and (v[:1] in (b'S',b's') or v[:1].islower()) for v in flags.split(b'\0')): limits.append('index_skip_or_assume_flags_not_supported')
  return sorted(set(limits))
 def base_selection(repo,selection):
  ref=selection.get('baseRef')
  if ref is None: current=repo['headOid']
  else:
   if not isinstance(ref,str) or not re.fullmatch(r'refs/(?:heads|remotes)/[^\x00-\x20~^:?*\[\\]+',ref): refuse('Unsupported comparison reference')
   current=text(['rev-parse','--verify',ref+'^{commit}'],allowed=(0,1,128)) or None
   if not oid(current): refuse('Comparison reference is unavailable')
  if 'baseOid' in selection and selection['baseOid']!=current: refuse('Selected comparison reference changed')
  return current,ref
 def capture(selection):
  before=repository(); index_meta=index_metadata(); indexed=index_entries(); entries=[]
  # Explicit rename detection avoids config-dependent status semantics.
  pieces=git(['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=all','--renames']).split(b'\0')
  cursor=0
  while cursor<len(pieces):
   item=pieces[cursor]; cursor+=1
   if not item: continue
   if len(item)<4 or item[2:3]!=b' ': refuse('Malformed Git status response')
   x,y=chr(item[0]),chr(item[1]); path=relative(item[3:].decode('utf-8')); entry={'path':path,'indexStatus':x,'worktreeStatus':y,'kind':'untracked' if x+y=='??' else 'conflict' if 'U' in x+y or x+y in ('AA','DD') else 'tracked'}
   if x in ('R','C') or y in ('R','C'):
    if cursor>=len(pieces) or not pieces[cursor]: refuse('Malformed Git rename response')
    entry['originalPath']=relative(pieces[cursor].decode('utf-8')); cursor+=1
   if entry['kind']=='conflict': entry['stages']=[{'stage':e['stage'],'mode':e['mode'],'oid':e['oid']} for e in indexed if e['path']==path and e['stage']]
   entries.append(entry)
  if len(entries)>256: refuse('Status exceeds the supported file count')
  revisions={}
  for e in entries:
   for path in [e['path']]+([e['originalPath']] if e.get('originalPath') else []): revisions[path]=work_file(path)
  base,ref=base_selection(before,selection); merge=merge_state(); limits=limitations(indexed)
  after=repository()
  if before!=after or index_meta!=index_metadata(): refuse('Repository changed during capture')
  value={'repository':before,'baseOid':base,'baseRef':ref,'entries':entries,'revisions':revisions,'indexEntries':indexed,'indexMetadata':index_meta,'mergeState':merge,'truncated':False,'limitations':limits,'scopeDigest':digest(scope)}
  value['fingerprint']=digest(value)
  return value
 def fresh(expected):
  if not isinstance(expected,dict) or not re.fullmatch(r'[a-f0-9]{64}',str(expected.get('fingerprint',''))): refuse('Missing reviewed capture')
  check=dict(expected); claimed=check.pop('fingerprint')
  if digest(check)!=claimed or expected.get('scopeDigest')!=digest(scope): refuse('Capture binding is invalid')
  actual=capture({'baseRef':expected.get('baseRef'),'baseOid':expected.get('baseOid')})
  if actual['fingerprint']!=claimed: refuse('Reviewed repository capture is stale')
  return actual
 def selected_paths(value,captured):
  if not isinstance(value,list) or not 1<=len(value)<=32: refuse('Select between one and 32 literal paths')
  paths=sorted(set(relative(v) for v in value))
  if len(paths)!=len(value): refuse('Duplicate selected path')
  known={e['path'] for e in captured['entries']}|{e['originalPath'] for e in captured['entries'] if e.get('originalPath')}
  if not set(paths)<=known: refuse('Selected path is absent from the reviewed status')
  for entry in captured['entries']:
   if entry.get('originalPath') and ({entry['path'],entry['originalPath']}&set(paths)) and not {entry['path'],entry['originalPath']}<=set(paths): refuse('A rename must be reviewed as both linked paths')
  return paths
 def conversion_check(paths):
  for key in ['core.autocrlf','core.safecrlf','core.checkRoundtripEncoding']:
   value=text(['config','--get',key],allowed=(0,1)).lower()
   if value and value not in ('false','0','no','off'): refuse('Git conversion policy is unsupported for exact-byte staging')
  attrs=git(['check-attr','-z','--stdin','filter','text','eol','working-tree-encoding','ident'],data=b''.join(v.encode('utf-8')+b'\0' for v in paths)).split(b'\0')
  if attrs and attrs[-1]==b'': attrs.pop()
  if len(attrs)!=len(paths)*15: refuse('Git attribute response is incomplete')
  for i in range(0,len(attrs),3):
   if attrs[i+2] not in (b'unspecified',b'unset'): refuse('Selected path has an unsupported Git attribute conversion')
  return sha(b'\0'.join(attrs))
 def author_value(value):
  if not isinstance(value,dict) or set(value)!=set(['name','email']): refuse('Explicit commit author is required')
  for key in ['name','email']:
   if not isinstance(value[key],str) or not value[key].strip() or len(value[key].encode('utf-8'))>256 or any(ord(c)<32 or c in '<>' for c in value[key]): refuse('Unsupported commit author')
  if '@' not in value['email']: refuse('Commit author email is invalid')
  return value
 def prepare(payload):
  captured=fresh(payload.get('capture')); operation=payload.get('operation')
  if any(v!=isolated_policy for v in captured['limitations']): refuse('Repository has a declared unsupported mutation state')
  if operation not in ('stage','unstage','commit'): refuse('Unsupported Git mutation')
  plan={'captureFingerprint':captured['fingerprint'],'capture':captured,'repository':captured['repository'],'operation':operation,'paths':[],'files':[],'parents':([captured['repository']['headOid']] if captured['repository']['headOid'] else [])+captured['repository']['mergeHeads'],'scopeDigest':digest(scope),'limitations':captured['limitations']}
  if operation in ('stage','unstage'):
   paths=selected_paths(payload.get('paths'),captured); plan['paths']=paths
   if operation=='stage':
    plan['attributeDigest']=conversion_check(paths); total=0
    for path in paths:
     f=work_file(path,True); total+=f.get('bytes',0)
     if total>MAX_SELECTED: refuse('Selected file bytes exceed the aggregate boundary')
     plan['files'].append(dict(f,path=path))
   else:
    for path in paths:
     target=[]
     if captured['repository']['headOid']:
      listing=git(['ls-tree','-z',captured['repository']['headOid'],'--',path])
      for item in listing.split(b'\0'):
       if not item: continue
       meta,name=item.split(b'\t',1); mode,kind,obj=meta.decode('ascii').split(' ')
       if name.decode('utf-8')!=path or kind!='blob' or mode not in ('100644','100755','120000') or not oid(obj): refuse('Unstage baseline is unsupported')
       target.append({'path':path,'mode':mode,'oid':obj,'revision':captured['revisions'].get(path,{}).get('revision')})
     plan['files'].extend(target or [{'path':path,'mode':'000000','revision':captured['revisions'].get(path,{}).get('revision'),'remove':True}])
  else:
   if any(e['stage'] for e in captured['indexEntries']): refuse('Resolve and explicitly stage all conflicts before commit')
   message=payload.get('message')
   if not isinstance(message,str) or not message.strip() or len(message.encode('utf-8'))>16384 or '\0' in message: refuse('Commit message is required and bounded')
   plan.update({'message':message,'author':author_value(payload.get('author')),'mergeState':captured['mergeState'],'indexEntries':captured['indexEntries']})
   if not captured['indexEntries'] and captured['repository']['headOid'] is None: refuse('An empty initial index cannot be committed')
  plan['summary']={'operation':operation,'pathCount':len(plan['paths']),'stagedEntryCount':len(captured['indexEntries']),'headOid':captured['repository']['headOid'],'headRef':captured['repository']['headRef'],'parents':plan['parents'],'coverage':'complete-index' if operation=='commit' else 'selected-paths','worktreeUnchanged':True,'callbacksDisabled':True}
  # Re-read the complete capture after attributes/file preparation as well.
  fresh(captured); plan['planDigest']=digest(plan)
  if len(packed(plan))>786432: refuse('Immutable review plan exceeds the protocol boundary')
  return plan
 def ledger_file(action_id):
  if not isinstance(action_id,str) or not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',action_id): refuse('Invalid action identity')
  return os.path.join(gitdir,'nekodex-review-actions',action_id+'.json')
 def load_record(path,bind_scope=True):
  raw=read_file(path,MAX_OUTPUT,True)
  if raw is None: return None
  value=json.loads(raw)
  saved_repo=value.get('repository',{})
  if value.get('version')!=1 or value.get('root')!=root or (bind_scope and value.get('scopeDigest')!=digest(stable_scope)) or saved_repo.get('rootIdentity')!=directory(root) or saved_repo.get('gitDir')!=gitdir or saved_repo.get('gitIdentity')!=directory(gitdir) or saved_repo.get('commonDir')!=common or saved_repo.get('commonIdentity')!=directory(common): refuse('Action receipt scope does not match')
  return value
 def read_gate():
  if not os.path.lexists(gate_directory): return None
  directory(gate_directory); s=os.lstat(gate_directory)
  if s.st_uid!=os.getuid() or s.st_mode&0o077: refuse('Shared repository gate directory is unsafe')
  raw=read_file(gate_path,16384,True)
  return None if raw is None else json.loads(raw)
 def gate_matches(gate,record):
  return gate.get('version')==1 and gate.get('actionId')==record['actionId'] and gate.get('requestDigest')==record['requestDigest'] and gate.get('root')==record['root'] and gate.get('rootIdentity')==record['repository']['rootIdentity'] and gate.get('gitDir')==record['repository']['gitDir'] and gate.get('gitIdentity')==record['repository']['gitIdentity'] and gate.get('commonIdentity')==record['repository']['commonIdentity'] and gate.get('owner')==record.get('owner')
 def settle_gate(record,own_terminal=False):
  gate=read_gate()
  if gate is None: return False
  if not gate_matches(gate,record): return True
  owner=record.get('owner')
  if not owner: return True
  alive=process_identity(owner['pid'])==owner
  if alive and not (own_terminal and owner['pid']==os.getpid() and owned_lock is None): return True
  if record.get('state') not in ('completed','failed'): return True
  # This is physical ownership cleanup of this exact private gate, never a Git
  # operation or a deletion of index.lock/another action's gate.
  before=os.lstat(gate_path)
  if read_gate()!=gate: refuse('Shared repository gate changed during settlement')
  after=os.lstat(gate_path)
  if (before.st_dev,before.st_ino)!=(after.st_dev,after.st_ino): refuse('Shared repository gate was replaced')
  os.unlink(gate_path); sync_directory(gate_directory)
  return False
 def effect_proven(record,observed):
  repo=record['repository']
  if record['operation'] in ('stage','unstage'):
   return record.get('publicationIntent') is True and record.get('afterIndexDigest') is not None and observed['indexDigest']==record['afterIndexDigest'] and observed['headOid']==repo['headOid'] and observed['headRef']==repo['headRef'] and observed['mergeStateDigest']==repo['mergeStateDigest']
  if not record.get('refIntent') or not oid(record.get('candidateCommitOid')): return False
  if observed['headRef']!=repo['headRef'] or observed['headOid']!=record['candidateCommitOid'] or observed['indexDigest']!=repo['indexDigest']: return False
  details=git(['cat-file','-p',record['candidateCommitOid']]); header=details.split(b'\n\n',1)[0].splitlines()
  parents=[v[7:].decode('ascii') for v in header if v.startswith(b'parent ')]; trees=[v[5:].decode('ascii') for v in header if v.startswith(b'tree ')]
  if parents!=record.get('parents') or trees!=[record.get('stagedTree')]: return False
  if repo['mergeHeads'] and merge_state()!={k:None for k in ['MERGE_HEAD','MERGE_MSG','MERGE_MODE']}: return False
  return True
 def unpublished_proven(record,observed):
  if observed!=record['repository'] or record.get('refIntent'): return False
  if not record.get('publicationIntent'): return True
  if record['operation'] not in ('stage','unstage'): return False
  lock=record.get('indexLock',{}); path=lock.get('path')
  if path!=index+'.lock' or not lock.get('identity'): return False
  try: before=os.lstat(path)
  except FileNotFoundError: return False
  if identity_stat(before)!=lock['identity'] or before.st_uid!=os.getuid() or before.st_nlink!=1: return False
  data=read_file(path,MAX_OUTPUT)
  return data is not None and sha(data)==record.get('afterIndexDigest')
 def settle_record_locks(record):
  # Only a physically retired helper with terminal repository proof may leave
  # these exact locks behind. Never unlink a replacement or a Git child's lock.
  owner=record.get('owner')
  if not owner or process_identity(owner['pid'])==owner: return
  gate=read_gate()
  if gate is None or not gate_matches(gate,record): return
  locks=([record['indexLock']] if record.get('indexLock') else [])+record.get('mergeLocks',[])
  allowed={index+'.lock'}|{os.path.join(gitdir,name+'.lock') for name in ['MERGE_HEAD','MERGE_MSG','MERGE_MODE']}
  for lock in locks:
   path=lock.get('path')
   if path not in allowed: refuse('Retained lock ownership is invalid')
   try: before=os.lstat(path)
   except FileNotFoundError: continue
   if str(before.st_dev)!=lock.get('dev') or str(before.st_ino)!=lock.get('ino'): continue
   # Inode numbers can be reused after a user replaces a stale lock. Legacy
   # records without the exact creation signature remain inspection-only.
   if lock.get('identity')!=identity_stat(before): continue
   if not stat.S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or before.st_nlink!=1: refuse('Retained lock ownership is unsafe')
   after=os.lstat(path)
   if identity_stat(before)!=identity_stat(after): refuse('Retained lock changed during settlement')
   os.unlink(path); sync_directory(gitdir)
 def inspect_record(record,path):
  state=record.get('state','unknown'); operation=record['operation']; repo=record['repository']; observed=repository(); evidence={'indexDigest':observed['indexDigest'],'headOid':observed['headOid'],'headRef':observed['headRef'],'mergeStateDigest':observed['mergeStateDigest']}
  if record.get('state') in ('completed','failed'):
   gate=read_gate()
   if gate is not None and gate_matches(gate,record) and record['state']=='completed' and not effect_proven(record,observed):
    return {'actionId':record['actionId'],'requestDigest':record['requestDigest'],'state':'unknown','operation':operation,'result':record.get('result'),'reason':'Known Git result is retained but shared-gate postconditions changed','evidence':evidence,'ownerHeld':True,'replayed':False}
   settle_record_locks(record); held=settle_gate(record)
   return {'actionId':record['actionId'],'requestDigest':record['requestDigest'],'state':'unknown' if held else record['state'],'operation':operation,'result':record.get('result'),'reason':'Shared repository gate is still held' if held else record.get('reason'),'evidence':evidence,'ownerHeld':held,'replayed':False}
  owner=record.get('owner')
  if not owner or process_identity(owner['pid'])==owner:
   return {'actionId':record['actionId'],'requestDigest':record['requestDigest'],'state':'unknown','operation':operation,'reason':'Remote mutation owner has not physically settled','evidence':evidence,'ownerHeld':True,'replayed':False}
  proven=effect_proven(record,observed)
  if proven:
   result={'indexDigest':observed['indexDigest'],'reconciled':True}
   if operation=='commit': result.update({'commitOid':record['candidateCommitOid'],'treeOid':record['stagedTree']})
   next_record=dict(record); next_record.update({'state':'completed','phase':'reconciled','result':record.get('result') or result}); persist_record(path,next_record); record=next_record; state='completed'
  elif unpublished_proven(record,observed):
   next_record=dict(record); next_record.update({'state':'failed','phase':'reconciled','reason':'No reviewed index/ref transition was published'}); persist_record(path,next_record); record=next_record; state='failed'
  else: state='unknown'
  if state in ('completed','failed'): settle_record_locks(record)
  held=settle_gate(record) if state in ('completed','failed') else True
  return {'actionId':record['actionId'],'requestDigest':record['requestDigest'],'state':'unknown' if held else state,'operation':operation,'result':record.get('result'),'reason':'Shared repository gate is still held' if held else record.get('reason'),'evidence':evidence,'ownerHeld':held,'replayed':False}
 def release_lock():
  global owned_lock
  if owned_lock:
   path,dev,ino=owned_lock
   try:
    s=os.lstat(path)
    if (s.st_dev,s.st_ino)==(dev,ino): os.unlink(path); sync_directory(gitdir)
   except FileNotFoundError: pass
   owned_lock=None
 def apply(payload):
  global ledger,ledger_path,ledger_durable,owned_lock,phase,mutated,accepted
  action_id=payload.get('actionId'); request_digest=payload.get('requestDigest'); plan=payload.get('plan'); ledger_path=ledger_file(action_id)
  accepted=os.path.lexists(ledger_path)
  if not isinstance(request_digest,str) or not re.fullmatch(r'[a-f0-9]{64}',request_digest): refuse('Invalid request digest')
  existing=load_record(ledger_path)
  if existing:
   if existing['requestDigest']!=request_digest: refuse('Action identity already belongs to a different request')
   return inspect_record(existing,ledger_path)
  if not isinstance(plan,dict): refuse('Missing reviewed mutation plan')
  check=dict(plan); claimed=check.pop('planDigest',None)
  if claimed!=digest(check) or plan.get('scopeDigest')!=digest(scope): refuse('Mutation plan digest is invalid')
  # Regenerate from immutable fields; never trust client-supplied candidate
  # objects, removal flags, parent sets or prepared raw bytes independently.
  rebuilt=prepare({'capture':plan.get('capture'),'operation':plan.get('operation'),'paths':plan.get('paths'),'message':plan.get('message'),'author':plan.get('author')})
  if rebuilt!=plan: refuse('Mutation plan no longer matches the reviewed source')
  repo=plan['repository']; operation=plan['operation']; parent=os.path.dirname(ledger_path); private_directory(parent)
  # Any unresolved remote action holds the repo even after local transport loss.
  names=os.listdir(parent)
  if len(names)>1024: refuse('Action ledger requires maintenance before another mutation')
  for name in names:
   if re.fullmatch(r'[a-f0-9-]{36}\.candidate-index(?:\.lock)?',name) or re.fullmatch(r'[a-f0-9-]{36}\.json\.next-[0-9]+',name): continue
   if not re.fullmatch(r'[a-f0-9-]{36}\.json',name): refuse('Unexpected action ledger entry')
   previous=load_record(os.path.join(parent,name),False)
   if previous and previous.get('state') not in ('completed','failed'): refuse('An unresolved Git action holds this repository')
  owner=process_identity(os.getpid())
  if owner is None: refuse('Cannot establish remote mutation owner')
  ledger={'version':1,'actionId':action_id,'requestDigest':request_digest,'planDigest':claimed,'root':root,'scopeDigest':digest(stable_scope),'repository':repo,'operation':operation,'parents':plan['parents'],'state':'prepared','phase':'prepared','effectsStarted':False,'owner':owner,'createdAt':int(time.time()*1000)}
  accepted=True; persist_record(ledger_path,ledger,True); ledger_durable=True; phase='prepared'
  private_directory(gate_directory)
  gate={'version':1,'actionId':action_id,'requestDigest':request_digest,'root':root,'rootIdentity':repo['rootIdentity'],'gitDir':gitdir,'gitIdentity':repo['gitIdentity'],'commonIdentity':repo['commonIdentity'],'owner':owner}
  try: durable(gate_path,gate,True)
  except FileExistsError:
   save(state='failed',phase='failed',reason='A held remote action owns this shared repository'); refuse('A held remote action owns this shared repository')
  lockpath=index+'.lock'
  try: lockfd=os.open(lockpath,os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_NOFOLLOW,0o600)
  except FileExistsError:
   save(state='failed',phase='failed',reason='Git index is locked by another owner'); refuse('Git index is locked by another owner')
  lockstat=os.fstat(lockfd); owned_lock=(lockpath,lockstat.st_dev,lockstat.st_ino)
  candidate=os.path.join(parent,action_id+'.candidate-index'); candidate_stat=None; merge_locks=[]
  try:
   save(indexLock={'path':lockpath,'dev':str(lockstat.st_dev),'ino':str(lockstat.st_ino),'identity':identity_stat(lockstat)})
   fresh(plan['capture'])
   original=read_file(index,MAX_OUTPUT)
   fd=os.open(candidate,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
   candidate_stat=os.fstat(fd)
   with os.fdopen(fd,'wb') as f:
    if original is not None: f.write(original)
    f.flush(); os.fsync(f.fileno())
   if original is None: os.unlink(candidate)
   candidate_env={'GIT_INDEX_FILE':candidate}
   phase='working'; save(state='working',phase=phase,effectsStarted=True); mutated=True
   if operation in ('stage','unstage'):
    lines=[]; zero='0'*(64 if repo['objectFormat']=='sha256' else 40)
    if original is None: git(['read-tree','--empty'],writing=True,extra_env=candidate_env)
    for f in plan['files']:
     path=f['path']; mode=f.get('mode'); obj=None
     if not f.get('remove'):
      if operation=='stage':
       data=base64.b64decode(f['data'],validate=True)
       obj=text(['hash-object','-w','--no-filters','--stdin'],data=data,writing=True)
      else: obj=f['oid']
      if not oid(obj): refuse('Candidate blob identity is invalid')
     # Remove all conflict stages before setting an exact stage-zero entry.
     lines.append(('0 '+zero+'\t'+path).encode('utf-8')+b'\0')
     if obj: lines.append((mode+' '+obj+'\t'+path).encode('utf-8')+b'\0')
    git(['update-index','-z','--index-info'],data=b''.join(lines),writing=True,extra_env=candidate_env)
    candidate_bytes=read_file(candidate,MAX_OUTPUT); after_digest=sha(candidate_bytes)
    # Before publication retain every worktree/index/ref/attribute pin.
    fresh(plan['capture'])
    if operation=='stage' and conversion_check(plan['paths'])!=plan['attributeDigest']: refuse('Selected Git attributes changed')
    os.ftruncate(lockfd,0); os.lseek(lockfd,0,os.SEEK_SET)
    with os.fdopen(os.dup(lockfd),'wb') as f: f.write(candidate_bytes); f.flush(); os.fsync(f.fileno())
    metadata=plan['capture']['indexMetadata']
    if metadata is not None:
     if os.fstat(lockfd).st_gid!=metadata['gid']: os.fchown(lockfd,-1,metadata['gid'])
     os.fchmod(lockfd,metadata['mode'])
    else:
     mask=os.umask(0); os.umask(mask); os.fchmod(lockfd,0o644&~mask)
    os.fsync(lockfd)
    save(publicationIntent=True,afterIndexDigest=after_digest,indexLock={'path':lockpath,'dev':str(lockstat.st_dev),'ino':str(lockstat.st_ino),'identity':identity_stat(os.fstat(lockfd))},phase='index-publication')
    if repository()!=repo or index_digest()!=repo['indexDigest'] or index_metadata()!=metadata: refuse('Index or reference changed before publication')
    if identity_stat(os.fstat(lockfd))[:2]!=[str(owned_lock[1]),str(owned_lock[2])]: refuse('Owned index lock changed')
    s=os.lstat(lockpath)
    if (s.st_dev,s.st_ino)!=(owned_lock[1],owned_lock[2]): refuse('Owned index lock was replaced')
    os.replace(lockpath,index); owned_lock=None; sync_directory(gitdir)
    result={'indexDigest':after_digest,'paths':plan['paths'],'worktreeUnchanged':True}
   else:
    if original is None: refuse('No staged index exists')
    if repo['mergeHeads']:
     for name in ['MERGE_HEAD','MERGE_MSG','MERGE_MODE']:
      expected=plan['mergeState'][name]
      path=os.path.join(gitdir,name+'.lock')
      try: mf=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
      except FileExistsError: refuse('Merge metadata is locked by another owner')
      ms=os.fstat(mf); os.close(mf); merge_locks.append((path,ms.st_dev,ms.st_ino))
      save(mergeLocks=[{'path':v[0],'dev':str(v[1]),'ino':str(v[2]),'identity':identity_stat(os.lstat(v[0]))} for v in merge_locks])
     if merge_state()!=plan['mergeState']: refuse('Reviewed merge metadata changed')
    tree=text(['write-tree'],writing=True,extra_env=candidate_env)
    if not oid(tree): refuse('Staged tree identity is invalid')
    if repo['headOid'] and not repo['mergeHeads'] and tree==text(['rev-parse',repo['headOid']+'^{tree}']): refuse('The staged tree has no changes to commit')
    stamp=str(int(time.time()))+' +0000'; a=plan['author']; authorenv=dict(candidate_env,GIT_AUTHOR_NAME=a['name'],GIT_AUTHOR_EMAIL=a['email'],GIT_COMMITTER_NAME=a['name'],GIT_COMMITTER_EMAIL=a['email'],GIT_AUTHOR_DATE=stamp,GIT_COMMITTER_DATE=stamp)
    args=['commit-tree','--no-gpg-sign',tree]
    for parentoid in plan['parents']: args+=['-p',parentoid]
    commit=text(args,data=plan['message'].encode('utf-8'),writing=True,extra_env=authorenv)
    if not oid(commit): refuse('Candidate commit identity is invalid')
    save(stagedTree=tree,candidateCommitOid=commit,phase='commit-created')
    fresh(plan['capture'])
    if repo['mergeHeads'] and merge_state()!=plan['mergeState']: refuse('Reviewed merge metadata changed')
    target=repo['headRef'] or 'HEAD'; old=repo['headOid'] or ('0'*(64 if repo['objectFormat']=='sha256' else 40))
    save(refIntent=True,phase='ref-publication')
    git(['update-ref','--no-deref','-m','NEKODEX reviewed staged commit',target,commit,old],writing=True)
    if repo['mergeHeads']:
     if merge_state()!=plan['mergeState']: refuse('Commit published but merge metadata changed; inspect required')
     save(mergeCleanupIntent=True,phase='merge-cleanup')
     for name in ['MERGE_HEAD','MERGE_MSG','MERGE_MODE']:
      expected=plan['mergeState'][name]
      if expected is not None:
       data=read_file(os.path.join(gitdir,name),MAX_FILE)
       if data is None or sha(data)!=expected['sha256']: refuse('Merge cleanup is partial; inspect required')
       os.unlink(os.path.join(gitdir,name)); sync_directory(gitdir)
    result={'commitOid':commit,'treeOid':tree,'parents':plan['parents'],'indexDigest':repo['indexDigest'],'headRef':repo['headRef'],'worktreeUnchanged':True}
   save(state='completed',phase='completed',result=result); phase='completed'
   return {'actionId':action_id,'requestDigest':request_digest,'state':'completed','operation':operation,'result':result,'ownerHeld':True,'replayed':False}
  except BaseException:
   if ledger and not write_uncertain and ledger.get('state') not in ('completed','failed'):
    if not ledger.get('effectsStarted'): save(state='failed',phase='failed',reason='Mutation was refused before Git effects')
    else: save(state='unknown',phase='unknown',reason='Git action requires exact receipt inspection')
   raise
  finally:
   os.close(lockfd); release_lock()
   for path,dev,ino in merge_locks:
    try:
     s=os.lstat(path)
     if (s.st_dev,s.st_ino)==(dev,ino): os.unlink(path); sync_directory(gitdir)
    except FileNotFoundError: pass
   if candidate_stat is not None and os.path.lexists(candidate):
    # Git atomically replaces the candidate while updating it; the private
    # action directory and exact per-action name remain its ownership proof.
    s=os.lstat(candidate)
    if stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1: os.unlink(candidate); sync_directory(parent)
 if action=='bases':
  repo=repository(); choices=[{'kind':'head','ref':None,'oid':repo['headOid']}]
  refs=git(['for-each-ref','--count=129','--format=%(refname)%00%(objectname)%00%(objecttype)','refs/heads/','refs/remotes/']); rows=refs.splitlines()
  for row in rows[:128]:
   ref,obj,kind=row.decode('utf-8').split('\0')
   if kind!='commit' or not oid(obj): continue
   choices.append({'kind':'local' if ref.startswith('refs/heads/') else 'remote','ref':ref,'oid':obj})
  if repository()!=repo: refuse('Repository changed during base capture')
  result={'repository':repo,'choices':choices,'truncated':len(rows)>128}
 elif action=='capture': result=capture(p)
 elif action=='prepare': result=prepare(p)
 elif action=='apply': result=apply(p)
 elif action=='inspect':
  path=ledger_file(p.get('actionId')); accepted=os.path.lexists(path); record=load_record(path)
  if record is None:
   result={'actionId':p['actionId'],'state':'unknown','ownerHeld':True,'reason':'Remote action record is absent','replayed':False}
   if isinstance(p.get('requestDigest'),str) and re.fullmatch(r'[a-f0-9]{64}',p['requestDigest']): result['requestDigest']=p['requestDigest']
   if p.get('operation') in ('stage','unstage','commit'): result['operation']=p['operation']
  elif p.get('requestDigest') and p['requestDigest']!=record['requestDigest']: refuse('Request digest differs from retained action')
  else: result=inspect_record(record,path)
 elif action=='diff':
  expected=p.get('capture'); state='current'; current=None
  if not isinstance(expected,dict): refuse('Missing reviewed diff capture')
  fallback={'state':'unavailable','text':'','binary':False,'truncated':False,'headOid':expected.get('repository',{}).get('headOid'),'baseOid':expected.get('baseOid')}
  try:
   try: current=fresh(expected)
   except Refusal:
    state='stale'; fallback['state']='stale'
    current=capture({'baseRef':expected.get('baseRef')})
   fallback.update({'headOid':current['repository']['headOid'],'baseOid':current['baseOid']})
   kind=p.get('kind'); path=p.get('path'); binary=False
   if path is not None: relative(path)
   if kind=='conflict':
    stage=p.get('stage')
    if path is None or stage not in (1,2,3): refuse('Select a conflict path and stage')
    matches=[v for v in current['indexEntries'] if v['path']==path and v['stage']==stage]
    if len(matches)!=1: refuse('Conflict stage is absent')
    size=text(['cat-file','-s',matches[0]['oid']])
    if not size.isdecimal() or int(size)>MAX_FILE: refuse('Conflict stage exceeds the supported file boundary')
    blob=git(['cat-file','blob',matches[0]['oid']]); binary=b'\0' in blob
    try: rendered=blob.decode('utf-8','strict')
    except UnicodeDecodeError: binary=True; rendered=''
    result={'state':state,'text':'' if binary else rendered,'binary':binary,'truncated':False,'headOid':current['repository']['headOid'],'baseOid':current['baseOid']}
   elif kind in ('worktree','staged','base'):
    if path and kind=='worktree' and any(e['path']==path and e['kind']=='untracked' for e in current['entries']):
     f=work_file(path,True); blob=base64.b64decode(f.get('data','')); binary=b'\0' in blob
     output=b'' if binary else b'Untracked file: '+path.encode('utf-8')+b'\n'+blob
    else:
     args=['diff','--no-ext-diff','--no-textconv','--no-color','--no-renames','--ignore-submodules=all']
     if kind=='staged': args+=['--cached']
     if kind=='base':
      if current['baseOid'] is None: refuse('No comparison commit exists')
      args+=[current['baseOid']]
     args+=['--']+([path] if path else [])
     output=git(args); binary=b'Binary files ' in output or b'GIT binary patch' in output
    try: rendered=output.decode('utf-8','strict')
    except UnicodeDecodeError: binary=True; rendered=''
    result={'state':state,'text':rendered,'binary':binary,'truncated':False,'headOid':current['repository']['headOid'],'baseOid':current['baseOid']}
    if binary and not rendered: result['reason']='Content has no supported UTF-8 text view'
   else: refuse('Unsupported diff view')
  except Refusal as unavailable:
   fallback['reason']=str(unavailable); result=fallback
  rendered=result['text'].encode('utf-8')
  if len(rendered)>524288:
   result['text']=rendered[:524288].decode('utf-8','ignore'); result['truncated']=True
  if result['state']=='current':
   try: fresh(current)
   except Refusal:
    result.update({'state':'stale','text':'','reason':'Repository changed while reading the reviewed diff'})
 else: refuse('Unsupported Git Review operation')
 # apply() has returned through all exact-lock/candidate cleanup. No further
 # Git calls follow gate release. Main still owns SSH until physical close.
 if action=='apply' and ledger:
  if write_uncertain or not ledger_durable:
   result.update({'state':'unknown','ownerHeld':True,'reason':'Durable action or cleanup state requires exact inspection'})
  elif ledger.get('state') in ('completed','failed'):
   held=settle_gate(ledger,True)
   result['ownerHeld']=held
   if held:
    result['state']='unknown'; result['reason']='Git outcome is retained but shared-gate cleanup is unresolved'
 response={'ok':True,'result':result,'phase':phase,'mutated':mutated,'accepted':accepted}
 if len(packed(response))>MAX_OUTPUT: refuse('Response exceeds the protocol boundary')
 sys.stdout.write(packed(response).decode('ascii')+'\n')
except BaseException as error:
 # Never expose stderr, credentials, raw exception messages or callback config.
 message=str(error) if isinstance(error,Refusal) else 'Git Review could not establish a safe result'
 if ledger and ledger_durable and not write_uncertain and ledger.get('state')=='failed' and owned_lock is None:
  # A refusal before accepted Git effects may still have acquired our remote
  # gate. Settle only that exact gate after the apply cleanup has returned.
  # A foreign/unresolved gate is an explicit held outcome, never false failure.
  try: held=settle_gate(ledger,True)
  except BaseException: held=True
  response={'ok':True,'result':{'actionId':ledger['actionId'],'requestDigest':ledger['requestDigest'],'state':'unknown' if held else 'failed','operation':ledger['operation'],'ownerHeld':held,'reason':'Shared repository gate cleanup is unresolved' if held else ledger.get('reason',message),'replayed':False},'phase':phase,'mutated':mutated,'accepted':True}
 elif ledger:
  # Durable acceptance, private-gate/setup faults and lost cleanup proof are
  # held even if no Git effect has yet been observed. mutated:false alone is
  # never authority to retire an accepted action's recovery identity.
  try:
   if not write_uncertain: save(state='unknown',phase='unknown',reason='Accepted remote action requires exact inspection')
  except BaseException: pass
  response={'ok':True,'result':{'actionId':ledger['actionId'],'requestDigest':ledger['requestDigest'],'state':'unknown','operation':ledger['operation'],'ownerHeld':True,'reason':'Accepted remote action requires exact inspection','replayed':False},'phase':phase,'mutated':mutated,'accepted':True}
 else: response={'ok':False,'error':message,'phase':phase,'mutated':mutated,'accepted':accepted}
 sys.stdout.write(json.dumps(response,separators=(',',':'))+'\n')
`;

module.exports = { REMOTE_GIT_REVIEW_HELPER };
