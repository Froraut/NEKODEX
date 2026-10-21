'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { fileDigest, fail } = require('./owned-native-admission.cjs');
// Immutable owner source. No argv/environment/profile inspection or native CLI RPC.
const OBSERVER = String.raw`
import {dlopen,ptr} from 'bun:ffi';
import {readFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(process.argv[2],'utf8')),uid=process.getuid();
const lib=dlopen('/usr/lib/libproc.dylib',{proc_listpids:{args:['u32','u32','ptr','i32'],returns:'i32'},proc_pidpath:{args:['i32','ptr','u32'],returns:'i32'},proc_pidinfo:{args:['i32','i32','u64','ptr','i32'],returns:'i32'}});
const sys=dlopen('/usr/lib/libSystem.B.dylib',{sysctl:{args:['ptr','u32','ptr','ptr','ptr','u64'],returns:'i32'}});
const absent=pid=>{try{process.kill(pid,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw Error('unverified_pid');}};
function list(){const b=Buffer.alloc(65536),n=lib.symbols.proc_listpids(4,uid,ptr(b),b.length);if(n<=0||n%4||n>=b.length-4)throw Error('incomplete_process_inventory');const ids=[];for(let i=0;i<n;i+=4){const pid=b.readInt32LE(i);if(pid>0)ids.push(pid);}if(new Set(ids).size!==ids.length||ids.length>16000)throw Error('invalid_process_inventory');return ids.sort((a,b)=>a-b);}
// libproc cannot inspect an exited, unreaped child (SZOMB). Such a process has
// released its address space, descriptors and locks, so it cannot own Native
// state. Only a positive same-UID kernel kinfo_proc identity excludes it.
const zombies=new Map();
function zombie(pid){const mib=new Int32Array([1,14,1,pid]),k=Buffer.alloc(648),len=new BigUint64Array([648n]);if(sys.symbols.sysctl(ptr(mib),4,ptr(k),ptr(len),null,0)!==0||len[0]!==648n||k.readInt32LE(40)!==pid||k[36]!==5||k.readUInt32LE(392)!==uid||k.readUInt32LE(420)!==uid)return null;const sec=k.readBigInt64LE(0),usec=k.readInt32LE(8);if(sec<0n||usec<0||usec>999999)return null;return {pid,uid,start:sec+':'+usec};}
function info(pid){const b=Buffer.alloc(136);if(lib.symbols.proc_pidinfo(pid,3,0,ptr(b),b.length)!==b.length){if(absent(pid))return null;const z=zombie(pid);if(!z)throw Error('uninspectable_process');if(zombies.has(pid)&&zombies.get(pid).start!==z.start)throw Error('process_identity_changed');zombies.set(pid,z);return null;}if(b.readUInt32LE(12)!==pid||b.readUInt32LE(20)!==uid)throw Error('process_identity_changed');return {pid,uid,status:b.readUInt32LE(4),flags:b.readUInt32LE(0),shortName:b.subarray(48,64).toString('utf8').split('\0')[0],start:b.readBigUInt64LE(120)+':'+b.readBigUInt64LE(128),nativeName:b.subarray(64,96).toString('utf8').split('\0')[0]};}
try{if(input.uid!==uid||!Array.isArray(input.paths)||!Array.isArray(input.formerPids)||input.formerPids.some(pid=>!Number.isSafeInteger(pid)||pid<2))throw Error('invalid_observer_input');if(input.formerPids.some(pid=>!absent(pid)))throw Error('former_owner_live');const first=list(),matches=[];
const fixedNames=[...input.paths.map(name=>name.split('/').pop()),'nekodex-owned-native-worker','codex','sandbox-exec'];
const prefixOf=name=>Buffer.from(name,'utf8').subarray(0,15).toString('latin1');
const prefixes=new Set(fixedNames.map(prefixOf));
const longCandidate=name=>fixedNames.includes(name)||(Buffer.byteLength(name)>=15&&prefixes.has(prefixOf(name)));
function excludedImage(before,after){return before.pid===after.pid&&before.uid===after.uid&&before.start===after.start&&before.shortName===after.shortName&&before.nativeName===after.nativeName&&before.status===2&&after.status===2&&(before.flags&0x4000)!==0&&(after.flags&0x4000)!==0&&/^[\x20-\x7e]{1,15}$/u.test(before.shortName)&&!prefixes.has(before.shortName)&&!longCandidate(before.nativeName)&&!longCandidate(after.nativeName);}
function observePid(pid){
  if(pid===process.pid)return;
  const before=info(pid);if(!before)return;
  const b=Buffer.alloc(4096),n=lib.symbols.proc_pidpath(pid,ptr(b),b.length);
  if(n<=0||n>=b.length){
    if(absent(pid))return;
    const after=info(pid);if(!after)return;
    // Kernel accounting short name, unlike writable p_name/argv0, is fixed by
    // exec. Exclude only a stable noncandidate EXEC image, never a denied Native.
    if(excludedImage(before,after))return;
    throw Object.assign(Error('uninspectable_process_path'),{blockedProcess:{pid,uid,start:before.start,status:before.status}});
  }
  const end=b.indexOf(0),name=b.subarray(0,end<0?n:end).toString('utf8');
  if(!name.startsWith('/')||name.includes('\ufffd')||/[\x00-\x1f\x7f]/u.test(name))throw Error('invalid_process_path');
  const after=info(pid);if(!after)return;
  if(after.start!==before.start||after.nativeName!==before.nativeName||after.shortName!==before.shortName)throw Error('process_identity_changed');
  if(name.split('/').pop()==='nekodex-owned-native-worker'||before.nativeName==='nekodex-owned-native-worker'||before.shortName===prefixOf('nekodex-owned-native-worker'))matches.push({pid,uid,start:before.start,role:'owned-worker'});
  else if(input.paths.includes(name))matches.push({pid,uid,start:before.start,role:name==='/usr/bin/sandbox-exec'?'launch-carrier':'trusted-executable',executable:name});
}
for(const pid of first)observePid(pid);
const second=list(),firstSet=new Set(first),secondSet=new Set(second),removed=first.filter(pid=>!secondSet.has(pid)),added=second.filter(pid=>!firstSet.has(pid));
for(const pid of added)observePid(pid);
const removedAbsent=removed.every(absent);
if(!removedAbsent)throw Object.assign(Error('process_inventory_changed'),{inventoryDelta:{added:added.length,removed:removed.length,removedAbsent,addedAbsent:false}});
// A zombie is terminal: it may only be reaped. Anything else at its PID after the
// second enumeration is a reused or unobserved process and blocks recovery.
for(const z of zombies.values()){const again=zombie(z.pid);if(again?again.start!==z.start:!absent(z.pid))throw Object.assign(Error('process_identity_changed'),{blockedProcess:{pid:z.pid,uid,start:z.start,status:5}});}
if(zombies.size>256)throw Error('too_many_zombie_processes');
const excludedZombies=[...zombies.values()].sort((a,b)=>a.pid-b.pid);
const former=input.formerPids.map(pid=>({pid,absent:absent(pid)}));process.stdout.write(JSON.stringify({version:1,uid,complete:true,processCount:first.length,matches,excludedZombies,former}));
}catch(e){process.stdout.write(JSON.stringify({version:1,complete:false,reasonCode:/^[a-z_]{1,80}$/.test(e.message)?e.message:'process_observation_unavailable',...(e.blockedProcess?{blockedProcess:e.blockedProcess}:{}),...(e.inventoryDelta?{inventoryDelta:e.inventoryDelta}:{})}));process.exitCode=2;}finally{lib.close();sys.close();}
`;
function recoveryExecutableDigest(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || fs.realpathSync(file) !== file) throw fail('recovery_runtime_unavailable', 'Recovery requires a canonical pinned runtime');
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1n || before.uid !== BigInt(process.getuid()) || before.mode & 0o022n || before.size > 512n * 1024n * 1024n) throw fail('recovery_runtime_unavailable', 'Recovery executable metadata is untrusted');
  // Existing bounded 1MiB-chunk digest; reviewed DEV wrappers exceed 256MiB.
  const hash = fileDigest(file, 512 * 1024 * 1024), after = fs.lstatSync(file, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'uid', 'mode', 'nlink', 'mtimeNs', 'ctimeNs']) if (before[key] !== after[key]) throw fail('recovery_runtime_unavailable', 'Recovery executable changed during pinning');
  if (fs.realpathSync(file) !== file) throw fail('recovery_runtime_unavailable', 'Recovery executable path changed'); return hash;
}
// Exited, unreaped same-UID processes the observer positively identified.
function validExcludedZombies(rows) {
  return Array.isArray(rows) && rows.length <= 256 && new Set(rows.map(row => row?.pid)).size === rows.length
    && rows.every(row => row && Object.keys(row).length === 3 && Number.isSafeInteger(row.pid) && row.pid > 1 && row.uid === process.getuid() && typeof row.start === 'string' && /^\d+:\d{1,6}$/.test(row.start));
}
async function observeNativeRecoveryProcesses({ getMetadataRuntimePin, paths, formerPids }) {
  if (process.platform !== 'darwin' || typeof getMetadataRuntimePin !== 'function') throw fail('recovery_process_proof_unavailable', 'Recovery requires macOS executable ownership evidence');
  const pin = await getMetadataRuntimePin();
  if (typeof pin?.bunSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pin.bunSha256) || recoveryExecutableDigest(pin.bunPath) !== pin.bunSha256) throw fail('recovery_runtime_unavailable', 'Recovery runtime pin changed');
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-native-owner-observer-')));
  try {
    fs.chmodSync(directory, 0o700);
    for (const [name, bytes] of [['observer.mjs', OBSERVER], ['input.json', JSON.stringify({ uid: process.getuid(), paths, formerPids })], ['bunfig.toml', '[install]\nauto = "disable"\n']]) {
      const fd = fs.openSync(path.join(directory, name), 'wx', 0o400); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    // Hash again immediately before this exact fixed observer launch.
    if (recoveryExecutableDigest(pin.bunPath) !== pin.bunSha256) throw fail('recovery_runtime_unavailable', 'Recovery runtime changed before observation');
    let output;
    try { output = execFileSync(pin.bunPath, ['--no-install', '--no-env-file', `--config=${path.join(directory, 'bunfig.toml')}`, path.join(directory, 'observer.mjs'), path.join(directory, 'input.json')],
      { cwd: directory, env: { HOME: directory, TMPDIR: directory, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (error) {
      const refusal = fail('recovery_process_proof_unavailable', 'Native physical ownership could not be completely observed');
      try { const value = JSON.parse(String(error.stdout || '').slice(0, 65536)); if (value.version === 1 && value.complete === false && typeof value.reasonCode === 'string' && /^[a-z_]{1,80}$/.test(value.reasonCode)) { refusal.observationReason = value.reasonCode; const p = value.blockedProcess; if (p && Number.isSafeInteger(p.pid) && p.pid > 0 && p.uid === process.getuid() && Number.isSafeInteger(p.status) && p.status >= 0 && p.status <= 10 && typeof p.start === 'string' && /^\d+:\d+$/.test(p.start)) refusal.observationDiagnostic = { pid: p.pid, uid: p.uid, start: p.start, status: p.status }; const d = value.inventoryDelta; if (d && Number.isSafeInteger(d.added) && d.added >= 0 && d.added <= 16000 && Number.isSafeInteger(d.removed) && d.removed >= 0 && d.removed <= 16000 && typeof d.removedAbsent === 'boolean' && typeof d.addedAbsent === 'boolean') refusal.observationDiagnostic = { addedCount: d.added, removedCount: d.removed, removedAbsent: d.removedAbsent, addedAbsent: d.addedAbsent }; } } catch {}
      throw refusal;
    }
    const result = JSON.parse(output);
    if (result.version !== 1 || result.complete !== true || result.uid !== process.getuid() || !Number.isSafeInteger(result.processCount) || result.processCount < 1 || result.processCount > 16000
      || !Array.isArray(result.matches) || result.matches.length > 128 || result.matches.some(row => !Number.isSafeInteger(row.pid) || row.pid < 1 || row.uid !== process.getuid() || !/^\d+:\d+$/.test(row.start) || !(['owned-worker', 'launch-carrier', 'trusted-executable'].includes(row.role)) || (row.role === 'owned-worker' ? row.executable !== undefined : !paths.includes(row.executable)))
      || !validExcludedZombies(result.excludedZombies) || result.excludedZombies.some(row => result.matches.some(match => match.pid === row.pid))
      || !Array.isArray(result.former) || result.former.length !== formerPids.length || result.former.some((row, index) => row.pid !== formerPids[index] || typeof row.absent !== 'boolean')) throw fail('recovery_process_proof_unavailable', 'Native process proof is incomplete');
    return result;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { observeNativeRecoveryProcesses, recoveryExecutableDigest, validExcludedZombies, NATIVE_RECOVERY_OBSERVER_SOURCE: OBSERVER };
