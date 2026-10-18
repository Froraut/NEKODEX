import { readJsonRequestBody } from "../http-body";
import type { ConversationHistoryStore } from "./store";
import type { MessageIdentity, ThreadIdentity } from "./types";
import type { OwnedNativeHistoryScope } from "./types";
import { z } from "zod";
const ownedAction = z.object({ action: z.enum(["owned-native-status", "owned-native-consent"]), taskId: z.string().min(1).max(128),
  scope: z.object({ familyId: z.string().min(1).max(128), generation: z.number().int().positive(), revision: z.number().int().positive() }).strict(),
  enabled: z.boolean().optional(), consent: z.boolean().optional(), acknowledgeUnknownSecrets: z.boolean().optional() }).strict();

/** Caller must enforce the existing local request + control-token guards first. */
export async function conversationHistoryRequest(req: Request, getStore: () => ConversationHistoryStore, options: {
  /** Resolves actual current task/model source. Incoming IDs never assert account authority. */
  resolveOwnedNativeScope?: (input: z.infer<typeof ownedAction>) => OwnedNativeHistoryScope | null;
} = {}): Promise<Response> {
  try {
    const body = await readJsonRequestBody(req, 600_000, 600_000) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") throw new Error("History action required");
    if (["owned-native-status", "owned-native-consent"].includes(body.action) && !options.resolveOwnedNativeScope) throw new Error("Owned Native history task authority is unavailable");
    const store = getStore();
    if (["owned-native-status", "owned-native-consent"].includes(body.action)) {
      const input = ownedAction.parse(body), scope = options.resolveOwnedNativeScope?.(input);
      if (!scope) {
        const revoked = input.action === "owned-native-consent" && input.enabled === false
          ? store.ownedNative.revokeTaskGeneration({ taskId: input.taskId, generation: input.scope.generation }) : undefined;
        if (input.action === "owned-native-consent" && input.enabled !== false) throw new Error("The current Native history source is unavailable");
        return Response.json({ ok: true, value: { available: false, recordingEnabled: store.status().recordingEnabled,
          ...(revoked ? { enabled: false, revokedScopes: revoked.revokedScopes } : {}), mode: "future-validated-final-summaries", transcriptCoverage: "partial", unknownSecretsPossible: true } });
      }
      const revoked = input.action === "owned-native-consent" && input.enabled === false
        ? store.ownedNative.revokeTaskGeneration({ taskId: input.taskId, generation: input.scope.generation }) : undefined;
      const value = input.action === "owned-native-status" || revoked ? { ...store.ownedNative.status(scope), ...(revoked ? { revokedScopes: revoked.revokedScopes } : {}) }
        : store.ownedNative.setConsent({ scope, enabled: z.boolean().parse(input.enabled), consent: input.consent, acknowledgeUnknownSecrets: input.acknowledgeUnknownSecrets });
      return Response.json({ ok: true, value: { ...value, available: true } });
    }
    const thread = { clientId: body.clientId, threadId: body.threadId } as ThreadIdentity;
    const identity = { ...thread, messageId: body.messageId } as MessageIdentity;
    const page = { limit: body.limit, offset: body.offset } as {limit?:number;offset?:number};
    let value: unknown;
    switch (body.action) {
      case "canonical-status": value=store.canonical.status(body.sourceId as string,body.threadId as string); break;
      case "canonical-consent": value=store.canonical.setConsent({sourceId:body.sourceId as string,threadId:body.threadId as string,enabled:body.enabled as boolean,consent:body.consent as boolean,acknowledgeUnknownSecrets:body.acknowledgeUnknownSecrets as boolean}); break;
      case "canonical-lease": value=store.canonical.lease(body.sourceId as string,body.threadId as string); break;
      case "canonical-record": value=store.canonical.recordPage(body.lease as import("./canonical").CanonicalCaptureLease,body.page as import("../../launcher/electron/canonical-history-policy.cjs").SanitizedCanonicalPage); break;
      case "status": value = { ...store.status(), captureMode: "explicit-selected-text", automaticCaptureAvailable: false }; break;
      case "set-recording":
        if (typeof body.enabled !== "boolean" || (body.enabled && body.consent !== true)) throw new Error("Explicit consent to private selected-text history is required");
        value = { ...store.setRecordingEnabled(body.enabled), captureMode: "explicit-selected-text", automaticCaptureAvailable: false }; break;
      case "threads": value = store.listThreads(page); break;
      case "thread": value = store.getThread({ ...thread, ...page }); break;
      case "message": value = store.getMessage({ ...identity, ...(body.revisionId === undefined ? {} : {revisionId: body.revisionId as string}) }); break;
      case "search": value = store.search({ query: body.query as string, ...page, ...(body.clientId === undefined ? {} : {clientId:body.clientId as string}), ...(body.threadId === undefined ? {} : {threadId:body.threadId as string}) }); break;
      case "delete-thread": value = store.deleteThread(thread); break;
      case "delete-message": value = store.deleteMessage(identity); break;
      case "export": value = store.exportMarkdown({ ...thread, ...(body.messageIds === undefined ? {} : {messageIds:body.messageIds as string[]}), ...(body.messageRevisions === undefined ? {} : {messageRevisions:body.messageRevisions as Array<{messageId:string;revisionId:string}>}) }); break;
      case "import-selected":
        if (body.sensitivityConfirmed !== true) throw new Error("Confirm the selected text excludes credentials, system/developer instructions and tool payloads");
        if (body.clientId !== "manual-selection") throw new Error("Selected imports use the explicit manual-selection source");
        value = store.record({ ...identity, revisionId: body.revisionId as string, revisionNumber: body.revisionNumber as number,
          role: body.role as "user" | "assistant", author: body.author as "human" | "assistant" | "agent" | "unknown", text: body.text as string,
          timestamp: body.timestamp as number, turnId: null, compactionId: null, source: "manual-import", sensitivity: "caller-validated",
          capturePolicy: "user-assistant-text-v1", coverage: "partial", coverageReason: "explicitly-selected-text-import" }); break;
      default: throw new Error("Unknown history action");
    }
    return Response.json({ ok: true, value });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof z.ZodError ? "Invalid owned Native history request" : error instanceof Error ? error.message : "History operation failed" }, { status: 400 });
  }
}
