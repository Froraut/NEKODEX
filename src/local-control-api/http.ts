import { z } from "zod";
import { readJsonRequestBody } from "../http-body";
import { LocalControlApiPolicy } from "./policy";
import type { ControlTaskMetadata, LocalControlApiRouteOptions } from "./types";
const peerLoopback = new Set(["127.0.0.1","::1","::ffff:127.0.0.1"]);
const identity=z.string().min(1).max(128);
const actionSchema=z.object({taskId:identity,actionId:identity,familyId:identity,generation:z.number().int().nonnegative(),revision:z.number().int().nonnegative(),operation:z.enum(["pause","resume","stop","step","review"]),explicitUserAction:z.literal(true)}).strict();
function result(value:unknown,status=200){const body=JSON.stringify({apiVersion:"1",ok:true,value});if(Buffer.byteLength(body)>2*1024*1024)return fail("response_limit_exceeded_reduce_page",413);return new Response(body,{status,headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}});}
function fail(code:string,status:number){return Response.json({apiVersion:"1",ok:false,error:{code}},{status,headers:{"cache-control":"no-store"}});}
function number(value:string|null,fallback:number,max:number){if(value===null)return fallback;if(!/^\d{1,7}$/.test(value))throw new Error("Invalid pagination");const n=Number(value);if(!Number.isSafeInteger(n)||n>max)throw new Error("Invalid pagination");return n;}
const safeId=(value:unknown)=>typeof value==="string"&&value.length>0&&Buffer.byteLength(value)<=512&&!/[\u0000-\u001f]/u.test(value)?value:undefined;
function metadata(row:ControlTaskMetadata){
  const id=safeId(row?.id),state=safeId(row?.state);if(!id||!state)throw new Error("Invalid source metadata");
  return {id,state,...Object.fromEntries(["kind","mode"].flatMap(field=>{const value=safeId(row[field as keyof ControlTaskMetadata]);return value?[[field,value]]:[];})),
    ...Object.fromEntries(["generation","revision","createdAt","updatedAt"].flatMap(field=>{const value=row[field as keyof ControlTaskMetadata];return typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?[[field,value]]:[];}))};
}
function page(rows:readonly ControlTaskMetadata[],limit:number,offset:number){return {items:rows.slice(offset,offset+limit).map(metadata),total:rows.length,limit,offset,hasMore:offset+limit<rows.length,content:"metadata-only"};}
/** Mount before other auth dispatch. Read credentials are rejected on every
 * non-versioned route, including admin routes, even when their format is forged. */
export function createLocalControlApiRoutes(options:LocalControlApiRouteOptions):(request:Request)=>Promise<Response|undefined>{
  const policy=new LocalControlApiPolicy(options.coreHome);
  return async request=>{
    const url=new URL(request.url),token=/^Bearer (\S+)$/i.exec(request.headers.get("authorization")??"")?.[1]??"";
    const candidate=url.pathname.startsWith("/api/v1/")||url.pathname==="/admin/local-control-api"||url.pathname==="/admin/local-control-api-action"||token.startsWith("nk-read-");
    if(!candidate)return undefined;
    const rejection=options.localGuard(request,url,options.port());if(rejection)return rejection;
    if(!peerLoopback.has(options.peerAddress(request)??""))return fail("loopback_peer_required",403);
    try {
      if(url.pathname==="/admin/local-control-api"||url.pathname==="/admin/local-control-api-action"){
        if(token.startsWith("nk-read-")||!options.authorizeAdmin(request))return fail("admin_authority_required",403);
        if(request.method!=="POST")return fail("method_not_allowed",405);
        const body=await readJsonRequestBody(request,16384,16384);
        if(url.pathname.endsWith("-action")){
          if(!options.agentAction)return fail("action_owner_unavailable",503);
          const input=actionSchema.parse(body);
          // Delegate once to the existing owner/outbox. No retry, scheduler or sender here.
          return result(await options.agentAction(input),202);
        }
        const input=z.object({action:z.enum(["status","enable","disable","rotate","history-consent"]),consent:z.boolean().optional(),enabled:z.boolean().optional()}).strict().parse(body);
        return result(input.action==="status"?{status:policy.status()}:policy.change(input.action,input));
      }
      if(!url.pathname.startsWith("/api/v1/"))return fail("read_credential_route_forbidden",403);
      const state=policy.admit(token);if(!state)return policy.status().enabled?fail("invalid_read_credential",401):fail("api_disabled",404);
      if(request.method!=="GET")return fail("read_only_credential",403);
      const allowed=new Set(["limit","offset",...(url.pathname==="/api/v1/history"?["view","clientId","threadId"]:[])]);
      if([...url.searchParams.keys()].some(key=>!allowed.has(key)))return fail("unsupported_query",400);
      const limit=number(url.searchParams.get("limit"),30,100),offset=number(url.searchParams.get("offset"),0,1000000);if(limit<1)return fail("invalid_pagination",400);
      if(url.pathname==="/api/v1/status"){
        const source=options.sources.status();if(!source)return fail("source_unavailable",503);
        const version=safeId(source.version);if(!version||typeof source.ready!=="boolean")return fail("source_unavailable",503);
        return result({version,ready:source.ready,permissions:state.permissions,...Object.fromEntries(["activeHttpTurns","activeAgentTasks"].flatMap(field=>{const value=source[field as keyof typeof source];return typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?[[field,value]]:[];}))});
      }
      if(url.pathname==="/api/v1/tasks"||url.pathname==="/api/v1/agent-tasks"){
        const source=url.pathname.endsWith("/agent-tasks")?options.sources.agentTasks:options.sources.tasks;
        const rows=source?.();if(!rows)return fail("source_unavailable",503);return result(page(rows,limit,offset));
      }
      if(url.pathname==="/api/v1/history"){
        const history=options.sources.history?.();if(!history)return fail("source_unavailable",503);
        const view=url.searchParams.get("view")??"coverage";
        if(view==="coverage"){
          const status=history.status();return result({recordingEnabled:status.recordingEnabled,totalMessages:status.totalMessages,indexedMessages:status.indexedMessages,incompleteMessages:status.incompleteMessages,transcriptCoverage:"unknown",contentAccess:state.historyContent});
        }
        if(!state.historyContent)return fail("history_content_consent_required",403);
        if(view==="threads")return result(history.listThreads({limit,offset}));
        if(view==="messages")return result(history.getThread({clientId:url.searchParams.get("clientId")??"",threadId:url.searchParams.get("threadId")??"",limit,offset}));
        return fail("unsupported_history_view",400);
      }
      return fail("route_not_found",404);
    }catch(error){
      if(error instanceof z.ZodError)return fail("invalid_request",400);
      // No SQL/path/model/prompt error text is reflected into external responses.
      return fail(url.pathname.endsWith("-action")?"action_conflict":"request_rejected",url.pathname.endsWith("-action")?409:400);
    }
  };
}
