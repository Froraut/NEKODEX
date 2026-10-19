import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,realpathSync} from "node:fs";
import {basename,dirname,isAbsolute} from "node:path";
import {z} from "zod";
import {readRequestBodyBytes} from "../http-body";
import {ownedConversationScope} from "./owned-conversation";
import type {OwnedConversationHistoryScope} from "./types";
import type {OwnedConversationHistoryRequest} from "./http";
const id = z.string().min(1).max(512).regex(/^[^\u0000-\u001f]+$/u);
export const ownedConversationScopeSchema = z.object({kind:z.literal("owned-conversation"),mode:z.literal("canonical-text-v1"),conversationId:z.uuid(),threadId:id,sourceId:z.string().regex(/^[a-f0-9]{64}$/),profileId:z.uuid(),backendAccountId:id,authEpoch:z.uuid(),serverGeneration:z.uuid(),workerBindingId:z.uuid(),workerGeneration:z.number().int().positive()}).strict();
export const ownedConversationSelectionSchema = z.object({conversationId:z.uuid(),revision:z.number().int().nonnegative(),expectedContext:z.object({profileId:z.uuid(),epoch:z.uuid(),serverGeneration:z.uuid()}).strict()}).strict();
const descriptorSchema = z.object({version:z.literal(1),kind:z.literal("nekodex-owned-conversation-history"),profile:z.enum(["production","development"]),pid:z.number().int().positive(),instanceId:z.uuid(),control:z.object({endpoint:z.string().max(128),token:z.string().regex(/^[A-Za-z0-9_-]{40,256}$/)}).strict(),accepting:z.boolean(),scopes:z.array(ownedConversationScopeSchema).max(256),createdAt:z.iso.datetime()}).strict();
type Descriptor = z.infer<typeof descriptorSchema>;
export interface OwnedConversationHistoryBridgeOptions {descriptorPath:string;expectedProfile:"production"|"development";fetch?:typeof fetch;requestWaitMs?:number}
export interface OwnedConversationHistoryBridge {
  currentScope(conversationId:string):OwnedConversationHistoryScope|null;
  matchesInstance(instanceId:string):boolean;
  matchesCurrentClaim(instanceId:string,scope:OwnedConversationHistoryScope):boolean;
  resolveScope(input:Pick<OwnedConversationHistoryRequest,"conversationId"|"revision"|"expectedContext">):Promise<OwnedConversationHistoryScope|null>;
}
function readDescriptor(options:OwnedConversationHistoryBridgeOptions):Descriptor {
  const file = options.descriptorPath, directory = dirname(file);
  if (!isAbsolute(file) || basename(file) !== "launcher-owned-conversation-history.json" || basename(directory) !== "runtime" || realpathSync(file) !== file || realpathSync(directory) !== directory) throw new Error("Owned conversation descriptor is not canonical");
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode&0o077)!==0 || typeof process.getuid === "function" && parent.uid !== process.getuid()) throw new Error("Owned conversation directory is not private");
  const fd = openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size>512*1024 || (before.mode&0o077)!==0 || typeof process.getuid === "function" && before.uid !== process.getuid()) throw new Error("Owned conversation descriptor is not private");
    const buffer = Buffer.alloc(512*1024+1); let count = 0;
    while (count<buffer.length) {const read = readSync(fd,buffer,count,buffer.length-count,null);if (!read) break;count+=read;}
    const after = fstatSync(fd), current = lstatSync(file);
    if (count>512*1024 || after.ino!==before.ino || after.dev!==before.dev || after.mtimeMs!==before.mtimeMs || after.ctimeMs!==before.ctimeMs || current.ino!==before.ino || current.dev!==before.dev || current.isSymbolicLink() || realpathSync(directory)!==directory) throw new Error("Owned conversation descriptor changed");
    const value = descriptorSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,count))));
    const endpoint = new URL(value.control.endpoint);
    if (value.profile!==options.expectedProfile || endpoint.protocol!=="http:" || endpoint.hostname!=="127.0.0.1" || !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname!=="/" || endpoint.search || endpoint.hash || new Set(value.scopes.map(scope=>scope.conversationId)).size!==value.scopes.length || !value.accepting && value.scopes.length) throw new Error("Owned conversation descriptor scope differs");
    try {process.kill(value.pid,0);} catch (error) {if ((error as NodeJS.ErrnoException).code!=="EPERM") throw new Error("Owned conversation main is absent");}
    return value;
  } finally {closeSync(fd);}
}
function sameOwner(a:Descriptor,b:Descriptor) {return a.instanceId===b.instanceId && a.pid===b.pid && a.profile===b.profile && a.control.endpoint===b.control.endpoint && a.control.token===b.control.token;}
function sameScope(a:OwnedConversationHistoryScope,b:OwnedConversationHistoryScope) {return JSON.stringify(ownedConversationScope(a))===JSON.stringify(ownedConversationScope(b));}
/** Fresh private metadata for every write; the only remote operation resolves
 * selection metadata on the same authenticated main. No arbitrary RPC or text. */
export function createOwnedConversationHistoryBridge(options:OwnedConversationHistoryBridgeOptions):OwnedConversationHistoryBridge {
  const waitMs = options.requestWaitMs ?? 5000;
  if (!Number.isSafeInteger(waitMs) || waitMs<1 || waitMs>60000) throw new Error("Invalid owned conversation observation bound");
  return {
    matchesInstance(instanceId) {try {return readDescriptor(options).instanceId===instanceId;} catch {return false;}},
    currentScope(conversationId) {try {const source=readDescriptor(options);if (!source.accepting) return null;const scope=source.scopes.find(row=>row.conversationId===conversationId);return scope ? ownedConversationScope(scope) : null;} catch {return null;}},
    matchesCurrentClaim(instanceId,scope) {try {const source=readDescriptor(options);return source.accepting && source.instanceId===instanceId && source.scopes.some(row=>sameScope(row,scope));} catch {return false;}},
    async resolveScope(input) {
      const selection=ownedConversationSelectionSchema.parse(input),source=readDescriptor(options);
      if (!source.accepting) return null;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),waitMs);
      try {
        const response=await (options.fetch??fetch)(`${source.control.endpoint}/v1/owned-conversation/resolve-scope`,{method:"POST",redirect:"error",proxy:"",signal:controller.signal,headers:{authorization:`Bearer ${source.control.token}`,"content-type":"application/json","x-nekodex-owned-conversation-instance":source.instanceId},body:JSON.stringify(selection)});
        if (!response.ok) {void response.body?.cancel().catch(()=>{});throw new Error("Owned conversation main scope unavailable");}
        const bytes=await readRequestBodyBytes(new Request("http://127.0.0.1/owned-conversation-scope",{method:"POST",body:response.body,signal:controller.signal}),32*1024);
        const result=z.object({ok:z.literal(true),instanceId:z.literal(source.instanceId),value:ownedConversationScopeSchema.nullable()}).strict().parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
        // Resolving revision/context is not a lease. Re-read pins and claims
        // after the await so a late response cannot restore revoked authority.
        const current=readDescriptor(options);
        if (!sameOwner(source,current) || !current.accepting) throw new Error("Owned conversation main owner changed");
        if (result.value===null) return null;
        const scope=ownedConversationScope(result.value);
        if (scope.conversationId!==selection.conversationId || scope.profileId!==selection.expectedContext.profileId || scope.authEpoch!==selection.expectedContext.epoch || scope.serverGeneration!==selection.expectedContext.serverGeneration || !current.scopes.some(row=>sameScope(row,scope))) throw new Error("Owned conversation main claim changed");
        return scope;
      } finally {clearTimeout(timer);}
    },
  };
}
