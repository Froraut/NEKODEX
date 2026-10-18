import { z } from "zod";
import { readJsonRequestBody } from "../http-body";
import type { AgentToolsComposition } from "./composition";

const scope = z.object({ taskId: z.string().min(1).max(200), generation: z.number().int().positive(), toolCallId: z.string().min(1).max(200) }).strict();
const identity = z.object({ id: z.string().min(1).max(8192), grantId: z.string().min(1).max(80), relativePath: z.string().min(1).max(4096), source: z.enum(["user", "workspace", "official-plugin", "vendor-plugin"]), digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().max(512 * 1024) }).strict();
const requestBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("reviewServer"), input: z.unknown(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("saveServer"), reviewId: z.string().uuid(), enabled: z.boolean(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("setEnabled"), enabled: z.boolean(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("removeServer"), serverId: z.string().min(1).max(80), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("setServerEnabled"), serverId: z.string().min(1).max(80), enabled: z.boolean(), expectedRecipeSha256: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("prepareInstall"), actionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), catalogId: z.literal("official-filesystem"), allowedRoot: z.string().min(1).max(4096), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("installReviewed"), actionId: z.string().min(1).max(128), graphSha256: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("installReceipt"), actionId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("cancelInstall"), actionId: z.string().min(1).max(128), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("uninstallManaged"), actionId: z.string().min(1).max(128), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("reviewInstalled"), actionId: z.string().min(1).max(128), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("discover"), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("approveInvoke"), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("receipt"), idempotencyKey: z.string().min(1).max(240) }).strict(),
  z.object({ action: z.literal("terminalReference"), idempotencyKey: z.string().min(1).max(240), requirementId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("skillRoot"), input: z.object({ root: z.string().min(1).max(4096), label: z.string().min(1).max(200) }).strict(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("skillsDiscover"), grantId: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal("removeSkillRoot"), grantId: z.string().min(1).max(80), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("skillsSelect"), scope, identity, explicitUserAction: z.literal(true) }).strict(),
]);
/** Mount behind the existing local-request guard; every action also checks control auth. */
export function createAgentToolsRoutes(composition: AgentToolsComposition, path = "/admin/agent-tools") {
  return async (request: Request): Promise<Response | undefined> => {
    if (new URL(request.url).pathname !== path) return undefined;
    if (!composition.options.authorize(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
    try {
      const body = requestBody.parse(await readJsonRequestBody(request, 128 * 1024, 128 * 1024));
      let value: unknown;
      switch (body.action) {
        case "status": value = composition.status(); break;
        case "reviewServer": value = composition.reviewServer(body.input, body.explicitUserAction); break;
        case "saveServer": value = await composition.saveServer(body.reviewId, body.enabled, body.explicitUserAction); break;
        case "setEnabled": value = await composition.setEnabled(body.enabled, body.explicitUserAction); break;
        case "removeServer": value = await composition.removeServer(body.serverId, body.explicitUserAction); break;
        case "setServerEnabled": value = await composition.setServerEnabled(body.serverId, body.enabled, body.expectedRecipeSha256, body.explicitUserAction); break;
        case "prepareInstall": value = composition.prepareInstall(body.actionId, body.catalogId, body.allowedRoot, body.explicitUserAction); break;
        case "installReviewed": value = composition.installReviewed(body.actionId, body.graphSha256, body.explicitUserAction); break;
        case "installReceipt": value = composition.installer.receipt(body.actionId) ?? null; break;
        case "cancelInstall": value = await composition.installer.cancel(body.actionId); break;
        case "reviewInstalled": value = composition.reviewInstalled(body.actionId, body.explicitUserAction); break;
        case "uninstallManaged": value = await composition.uninstallManaged(body.actionId, body.explicitUserAction); break;
        case "discover": value = await composition.toolsPort.discover(body.scope); break;
        case "approveInvoke": value = await composition.approveInvoke(body.scope, body.explicitUserAction); break;
        case "receipt": value = composition.receipt(body.idempotencyKey) ?? null; break;
        case "terminalReference": value = composition.terminalReference(body.idempotencyKey, body.requirementId); break;
        case "skillRoot": value = composition.addSkillRoot(body.input, body.explicitUserAction); break;
        case "skillsDiscover": value = composition.discoverSkills(body.grantId); break;
        case "removeSkillRoot": value = composition.removeSkillRoot(body.grantId, body.explicitUserAction); break;
        case "skillsSelect": value = composition.selectSkill(body.scope, body.identity, body.explicitUserAction); break;
      }
      return Response.json({ ok: true, value });
    } catch (error) {
      const invalid = error instanceof z.ZodError;
      // Fixed domain strings are safe; arbitrary filesystem/SDK errors can contain private paths.
      const message = error instanceof Error && /^(?:Explicit |Current owned|No exact |Pending Agent|Wait for owned|Configuration review|Installers,|Interpreter recipes|Pinned server|Tools host|Standalone tool|Tool |Selected skill|Skill root|Native OS|Invalid secret|Unsupported server)/.test(error.message) ? error.message : "The tools action could not be completed. Inspect the current saved configuration and receipt before retrying.";
      return Response.json({ ok: false, error: invalid ? "invalid_request" : "agent_tools_conflict", message }, { status: invalid ? 400 : 409 });
    }
  };
}
