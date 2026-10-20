import {z} from "zod";
import {readJsonRequestBody} from "../http-body";
import {ownedConversationScopeSchema,type OwnedConversationHistoryBridge} from "./owned-conversation-bridge";
import type {ConversationHistoryStore} from "./store";
import type {OwnedConversationLease} from "./owned-conversation";
const id=z.string().min(1).max(512).regex(/^[^\u0000-\u001f]+$/u);
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const leaseSchema=z.object({leaseId:z.uuid(),scope:ownedConversationScopeSchema,actionId:id,nativeActionId:id,afterCursor:z.number().int().nonnegative(),captureEpoch:z.uuid(),consentRevision:z.number().int().nonnegative(),recordingEpoch:z.number().int().nonnegative(),policyVersion:z.literal("owned-conversation-text-v1")}).strict();
const provenanceSchema=z.object({actionId:id,nativeActionId:id,serverGeneration:z.uuid(),workerBindingId:z.uuid(),workerGeneration:z.number().int().positive(),messageId:id,turnId:id,threadId:id,timestampMs:z.number().int().nonnegative()}).strict();
const upsertSchema=z.object({kind:z.literal("upsert"),cursor:z.number().int().positive(),itemId:id,sourceRevision:sha,revisionNumber:z.number().int().positive(),role:z.enum(["user","assistant"]),attribution:z.enum(["direct-human","automatic-host","assistant","unknown"]),text:z.string().max(512*1024),coverage:z.enum(["complete","partial"]),coverageReason:z.string().max(1024).optional(),originalBytes:z.number().int().min(0).max(512*1024),exclusionReason:z.enum(["known-secret-content","generated-instructions-or-schema"]).nullable(),phase:z.enum(["commentary","final_answer"]).nullable()});
const deleteSchema=z.object({kind:z.literal("delete"),cursor:z.number().int().positive(),itemId:id,sourceRevision:sha,revisionNumber:z.number().int().positive()}).strict();
const gapSchema=z.object({kind:z.literal("gap"),cursor:z.number().int().positive(),reason:z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/)}).strict();
const recordInputSchema=z.union([
  z.object({lease:leaseSchema.nullable(),scope:ownedConversationScopeSchema,provenance:provenanceSchema,event:z.discriminatedUnion("kind",[upsertSchema,deleteSchema])}).strict(),
  z.object({lease:leaseSchema.nullable(),scope:ownedConversationScopeSchema,provenance:provenanceSchema.optional(),event:gapSchema}).strict(),
]);
const common={instanceId:z.uuid()};
const requestSchema=z.discriminatedUnion("action",[
  z.object({...common,action:z.literal("owned-conversation-begin"),input:z.object({scope:ownedConversationScopeSchema,actionId:id,nativeActionId:id,afterCursor:z.number().int().nonnegative(),captureEpoch:z.uuid(),enableConsent:z.object({consent:z.literal(true),acknowledgeUnknownSecrets:z.literal(true)}).strict().optional()}).strict()}).strict(),
  z.object({...common,action:z.literal("owned-conversation-record"),input:recordInputSchema}).strict(),
  z.object({...common,action:z.literal("owned-conversation-release"),input:z.object({lease:leaseSchema.nullable()}).strict()}).strict(),
]);
/** Main-only capture boundary. Public renderer history IPC must never forward
 * these actions. Core bearer plus fresh exact descriptor claim are both needed. */
export function createOwnedConversationHistoryControlRoutes(options:{history:()=>ConversationHistoryStore;bridge:OwnedConversationHistoryBridge;authorize:(request:Request)=>boolean;canStart?:()=>boolean}) {
  return async(request:Request):Promise<Response>=>{
    if (!options.authorize(request)) return Response.json({ok:false,error:"unauthorized"},{status:401});
    if (request.method!=="POST") return Response.json({ok:false,error:"method_not_allowed"},{status:405});
    try {
      const body=requestSchema.parse(await readJsonRequestBody(request,600000,600000));
      const scope=body.action==="owned-conversation-release" ? body.input.lease?.scope : body.input.scope;
      // Releasing the exact retained lease grants no content/capture authority.
      // Keep that cleanup possible after this same main removes its claims.
      if (body.action === "owned-conversation-release" ? !options.bridge.matchesInstance(body.instanceId) : !scope || !options.bridge.matchesCurrentClaim(body.instanceId,scope)) throw new Error("stale main claim");
      const history=options.history().ownedConversation;
      let value:unknown;
      if (body.action==="owned-conversation-begin") {
        if (options.canStart && !options.canStart()) throw new Error("capture admission draining");
        if (body.input.enableConsent) history.setConsent({scope:body.input.scope,enabled:true,...body.input.enableConsent});
        value=history.begin(body.input);
      } else if (body.action==="owned-conversation-record") value=history.record(body.input);
      else value={released:history.release(body.input.lease as OwnedConversationLease|null)};
      return Response.json({ok:true,value});
    } catch(error) {return Response.json({ok:false,error:error instanceof z.ZodError ? "invalid_owned_conversation_capture_request" : "owned_conversation_capture_scope_conflict"},{status:error instanceof z.ZodError ? 400 : 409});}
  };
}
