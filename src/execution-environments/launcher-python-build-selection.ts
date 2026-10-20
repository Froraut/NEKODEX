import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import type {ToolScope} from '../agent-tools/types';
import type {PythonBuildSelection, PythonBuildArtifact} from './python-build';
import {sha256} from './protocol';
import {PYTHON_BUILD_SELECTION_LIMITS as L, parsePythonBuildSelectionRequest, parsePythonBuildSelectionHeader} from '../../launcher/electron/python-build-selection-contract.cjs';

const descriptorSchema = z.object({ version: z.literal(1), kind: z.literal("nekodex-agent-python-build-selection"), profile: z.enum(["production", "development"]),
  pid: z.number().int().positive(), instanceId: z.string().uuid(), createdAt: z.string().datetime(),
  control: z.object({ endpoint: z.string().max(128), token: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/) }).strict() }).strict();
type Descriptor = z.infer<typeof descriptorSchema>;
export interface LauncherPythonBuildSelectionBridgeOptions {
  /** Trusted exact core/runtime/launcher-agent-python-build.json; never model or renderer input. */
  descriptorPath: string;
  expectedProfile: "production" | "development";
  fetch?: typeof fetch;
  /** Bounds this passive byte observation; it grants no execution authority. */
  requestWaitMs?: number;
}
function readDescriptor(options: LauncherPythonBuildSelectionBridgeOptions): Descriptor {
  try {
  const file = options.descriptorPath, directory = dirname(file);
  if (!isAbsolute(file) || basename(file) !== "launcher-agent-python-build.json" || basename(directory) !== "runtime"
    || realpathSync(file) !== file || realpathSync(directory) !== directory) throw new Error("Python build selection launcher descriptor is not canonical");
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0
    || typeof process.getuid === "function" && parent.uid !== process.getuid()) throw new Error("Python build selection launcher directory is not private");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > 8192 || (before.mode & 0o077) !== 0
      || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("Python build selection launcher descriptor is not private");
    const buffer = Buffer.alloc(8193); let count = 0;
    while (count < buffer.length) { const size = readSync(fd, buffer, count, buffer.length - count, null); if (!size) break; count += size; }
    const after = fstatSync(fd), current = lstatSync(file);
    if (count > 8192 || after.ino !== before.ino || after.dev !== before.dev || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()
      || realpathSync(directory) !== directory) throw new Error("Python build selection launcher descriptor changed");
    const value = descriptorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count))));
    const endpoint = new URL(value.control.endpoint);
    if (value.profile !== options.expectedProfile || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
      || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new Error("Python build selection launcher descriptor scope differs");
    try { process.kill(value.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw new Error("Python build selection launcher is absent"); }
    return value;
  } finally { closeSync(fd); }
  } catch { throw new Error('Python build selection launcher descriptor unavailable'); }
}

/** Passive trusted core client. Only selected bytes cross this private listener;
 * no paths, package execution, VM operation or renderer secret is accepted. */
export function createLauncherPythonBuildSelectionBridge(options: LauncherPythonBuildSelectionBridgeOptions) {
  const waitMs = options.requestWaitMs ?? 50000;
  if (!Number.isSafeInteger(waitMs) || waitMs < 1 || waitMs > 60000) throw new Error('Invalid Python build selection observation wait');
  return { async resolvePythonBuildSelection(selectionId: string, scope: ToolScope): Promise<PythonBuildSelection> {
    const request = parsePythonBuildSelectionRequest({selectionId,scope});
    const descriptor = readDescriptor(options); const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),waitMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await (options.fetch ?? fetch)(`${descriptor.control.endpoint}/v1/agent-python-build/selection`,{method:'POST',redirect:'error',proxy:'',signal:controller.signal,
        headers:{authorization:`Bearer ${descriptor.control.token}`,'content-type':'application/json','x-nekodex-python-build-instance':descriptor.instanceId},body:JSON.stringify(request)});
      if (!response.ok || !response.body || response.headers.get('x-nekodex-python-build-instance') !== descriptor.instanceId || response.headers.get('content-type') !== 'application/vnd.nekodex.python-build-selection') throw new Error('invalid response');
      const maximum = L.bytes + L.headerBytes + 4, declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maximum) throw new Error('response limit');
      reader = response.body.getReader(); let pending: Uint8Array = new Uint8Array(), position = 0, received = 0;
      async function next() { controller.signal.throwIfAborted(); const value = await reader!.read(); controller.signal.throwIfAborted(); if(value.done) return false; received += value.value.length; if(received > maximum) throw new Error('response limit'); pending = value.value; position=0; return true; }
      async function take(size:number) { const bytes=Buffer.alloc(size);let written=0;while(written<size){if(position===pending.length && !await next())throw new Error('truncated response');const length=Math.min(size-written,pending.length-position);bytes.set(pending.subarray(position,position+length),written);position+=length;written+=length;}return bytes;}
      const headerBytes=(await take(4)).readUInt32BE(); if(headerBytes<1 || headerBytes>L.headerBytes) throw new Error('header limit');
      const header=parsePythonBuildSelectionHeader(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await take(headerBytes))));
      if(header.instanceId!==descriptor.instanceId || header.selectionId!==selectionId || header.scope.taskId!==scope.taskId || header.scope.generation!==scope.generation || header.scope.toolCallId!==scope.toolCallId) throw new Error('scope mismatch');
      const sources:{path:string;bytes:Uint8Array;sha256:string}[]=[],buildWheels:PythonBuildArtifact[]=[],runtimeWheels:PythonBuildArtifact[]=[];let archive:PythonBuildArtifact|undefined;
      for(const f of header.files){ const bytes=await take(f.bytes);if(sha256(bytes)!==f.sha256)throw new Error('snapshot mismatch');
        if(f.role==='source')sources.push({path:f.path,bytes,sha256:f.sha256});
        else {if(f.path.includes('/'))throw new Error('artifact filename mismatch');const a={filename:f.path,bytes,sha256:f.sha256};if(f.role==='source-archive')archive=a;else {if(!f.path.endsWith('.whl'))throw new Error('wheel filename mismatch');(f.role==='build-wheel'?buildWheels:runtimeWheels).push(a);}}
      }
      if(position!==pending.length || await next())throw new Error('extra response data');
      if(readDescriptor(options).instanceId!==descriptor.instanceId)throw new Error('launcher changed');
      const source:PythonBuildSelection['source']=header.sourceKind==='tree'?{kind:'tree',files:sources}:{kind:header.sourceKind,artifact:archive!};
      return {...header.config,source,buildWheels,runtimeWheels};
    } catch { throw new Error('Python build selected snapshot unavailable; select or review the exact current task again'); }
    finally { clearTimeout(timer); void reader?.cancel().catch(()=>{}); reader?.releaseLock(); }
  }};
}
