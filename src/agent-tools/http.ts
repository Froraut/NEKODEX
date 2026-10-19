import { z } from "zod";
import { readJsonRequestBody } from "../http-body";
import type { AgentToolsComposition } from "./composition";
import { browserBindingSchema } from "../browser-companion/protocol";
import { macosWindowSelectionSchema } from "../browser-companion/macos-desktop";
import { remoteTaskScopeSchema } from "../remote-workspace/protocol";
import { isPythonEnvironmentError, pythonEnvironmentPublicReason } from "./skill-python-environment";

const scope = z.object({ taskId: z.string().min(1).max(200), generation: z.number().int().positive(), toolCallId: z.string().min(1).max(200) }).strict();
const identity = z.object({ id: z.string().min(1).max(8192), grantId: z.string().min(1).max(80), relativePath: z.string().min(1).max(4096), source: z.enum(["user", "workspace", "official-plugin", "vendor-plugin"]), digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative().max(512 * 1024) }).strict();
const networkScope = z.object({ taskId: z.string().min(1).max(200), generation: z.number().int().positive(), actionId: z.string().min(1).max(200) }).strict();
const networkGrant = z.object({ scope: networkScope, destinations: z.array(z.object({origin:z.string().min(1).max(8192),addresses:z.array(z.string().min(1).max(128)).min(1).max(8),methods:z.array(z.string().min(1).max(16)).min(1).max(7)}).strict()).min(1).max(16),
  credentialOwner:z.literal('none'),dns:z.literal('pinned-no-lookup'),proxy:z.literal('none'),maxRequests:z.number().int().min(1).max(100),maxRequestBytes:z.number().int().min(1).max(16*1024*1024),maxResponseBytes:z.number().int().min(1).max(16*1024*1024),maxRedirects:z.number().int().min(0).max(5),timeoutMs:z.number().int().min(1).max(60000)}).strict();
// These fixed broker validation errors precede grant insertion. Never expose
// arbitrary vm-network errors as proof that a grant was not admitted.
const preGrantRefusals = new Set(["vm-network-destination-invalid", "vm-network-origin-invalid", "vm-network-limits-invalid", "vm-network-address-mismatch", "vm-network-url-invalid"]);
class PublicNetworkGrantRefusal extends Error {}
const pythonBuildBackendClosureMessage = 'Python source build has no backend wheels. Set backendPath to the selected in-tree backend (for example ["."]) or select its backend wheels, then select and review again.';
class PublicPythonBuildReviewRefusal extends Error {}
const requestBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("reviewServer"), input: z.unknown(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("saveServer"), reviewId: z.string().uuid(), enabled: z.boolean(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("setEnabled"), enabled: z.boolean(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("removeServer"), serverId: z.string().min(1).max(80), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("setServerEnabled"), serverId: z.string().min(1).max(80), enabled: z.boolean(), expectedRecipeSha256: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("prepareInstall"), actionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), catalogId: z.enum(["official-filesystem", "official-memory", "official-sequential-thinking"]), allowedRoot: z.string().min(1).max(4096), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("installReviewed"), actionId: z.string().min(1).max(128), graphSha256: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("installReceipt"), actionId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("cancelInstall"), actionId: z.string().min(1).max(128), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("uninstallManaged"), actionId: z.string().min(1).max(128), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("reviewInstalled"), actionId: z.string().min(1).max(128), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("discover"), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("approveInvoke"), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("receipt"), idempotencyKey: z.string().min(1).max(240) }).strict(),
  z.object({ action: z.literal("terminalReference"), idempotencyKey: z.string().min(1).max(240), requirementId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("browserStatus"), scope: scope.optional() }).strict(),
  z.object({ action: z.literal("bindBrowserTools"), scope, expectedBinding: browserBindingSchema, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("revokeBrowserTools"), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("inspectDesktopPermissions"), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("listDesktopWindows"), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("setDesktopEnabled"), enabled: z.boolean(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("selectDesktopWindow"), scope, expectedSelection: macosWindowSelectionSchema, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("revokeDesktopTools"), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("remoteStatus"), scope: scope.optional() }).strict(),
  z.object({ action: z.literal("bindRemoteTools"), hostId: z.string().uuid(), scope: remoteTaskScopeSchema, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("revokeRemoteTools"), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("scriptStatus"), scope: scope.optional() }).strict(),
  z.object({ action: z.literal('vmStatus'), scope: scope.optional() }).strict(),
  z.object({ action: z.literal('reviewVmEnvironment'), actionId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('prepareVmEnvironment'), actionId: z.string().uuid(), reviewDigest: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('attachVmWorkspace'), scope, root: z.string().min(1).max(4096), acknowledgeIsolation: z.literal(true), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('revokeVmWorkspace'), scope, bindingId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('cancelVmOperation'), scope, operationId: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('reconcileVmOperation'), scope, operationId: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("grantScriptWorkspace"), scope, root: z.string().min(1).max(4096), access: z.enum(["read-only", "read-write"]), acknowledgeRestrictions: z.literal(true), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("revokeScriptWorkspace"), scope, grantId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('vmNetworkStatus'), scope: scope.optional() }).strict(),
  z.object({ action: z.literal('grantVmNetwork'), input: networkGrant, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('revokeVmNetwork'), scope: networkScope, grantId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('pythonBuildStatus'), scope: scope.optional() }).strict(),
  z.object({ action: z.literal('reviewPythonBuild'), scope, actionId: z.string().uuid(), selectionId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('preparePythonBuild'), scope, actionId: z.string().uuid(), reviewDigest: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('attachPythonBuild'), scope, actionId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('revokePythonBuild'), scope, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('cancelPythonBuild'), actionId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal('reconcilePythonBuild'), actionId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("pythonEnvironmentStatus") }).strict(),
  z.object({ action: z.literal("reviewPythonEnvironment"), actionId: z.string().uuid(), wheelPaths: z.array(z.string().min(1).max(4096)).min(1).max(16), requirements: z.array(z.string().min(1).max(4096)).max(256).optional(), directArtifacts: z.array(z.object({url:z.string().min(1).max(8192),artifactSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(256).optional(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("preparePythonEnvironment"), actionId: z.string().uuid(), reviewDigest: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("pythonEnvironmentAction"), actionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("reconcilePythonEnvironment"), actionId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("bindPythonEnvironment"), scope, environmentId: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("revokePythonEnvironment"), scope, bindingId: z.string().uuid(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("skillRoot"), input: z.object({ root: z.string().min(1).max(4096), label: z.string().min(1).max(200) }).strict(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("skillsDiscover"), grantId: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal("removeSkillRoot"), grantId: z.string().min(1).max(80), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("skillsSelect"), scope, identity, explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("reviewSkillImport"), actionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), identity, label: z.string().trim().min(1).max(200), updateLineageId: z.string().regex(/^[a-f0-9]{64}$/).optional(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("reviewSkillPackageImport"), actionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), selection: z.object({ identity, resources: z.array(z.string().min(1).max(4096)).max(16) }).strict(), label: z.string().trim().min(1).max(200), updateLineageId: z.string().regex(/^[a-f0-9]{64}$/).optional(), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("commitSkillImport"), actionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), reviewDigest: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("managedSkillAction"), actionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict(),
  z.object({ action: z.literal("attachManagedSkill"), scope, versionId: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("detachManagedSkill"), scope, versionId: z.string().regex(/^[a-f0-9]{64}$/), explicitUserAction: z.literal(true) }).strict(),
  z.object({ action: z.literal("revokeManagedSkill"), versionId: z.string().regex(/^[a-f0-9]{64}$/), forget: z.boolean(), explicitUserAction: z.literal(true) }).strict(),
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
        case "browserStatus": value = composition.browserStatus(body.scope); break;
        case "bindBrowserTools": value = composition.bindBrowserTools(body.scope, body.expectedBinding, body.explicitUserAction); break;
        case "revokeBrowserTools": value = composition.revokeBrowserTools(body.scope, body.explicitUserAction); break;
        case "inspectDesktopPermissions": value = await composition.inspectDesktopPermissions(body.explicitUserAction); break;
        case "listDesktopWindows": value = await composition.listDesktopWindows(body.explicitUserAction); break;
        case "setDesktopEnabled": value = await composition.setDesktopEnabled(body.enabled, body.explicitUserAction); break;
        case "selectDesktopWindow": value = await composition.selectDesktopWindow(body.scope, body.expectedSelection, body.explicitUserAction); break;
        case "revokeDesktopTools": value = await composition.revokeDesktopTools(body.scope, body.explicitUserAction); break;
        case "remoteStatus": value = await composition.remoteStatus(body.scope); break;
        case "bindRemoteTools": value = await composition.bindRemoteTools(body.scope, body.hostId, body.explicitUserAction); break;
        case "revokeRemoteTools": value = await composition.revokeRemoteTools(body.scope, body.explicitUserAction); break;
        case "scriptStatus": value = composition.scriptStatus(body.scope); break;
        case 'vmStatus': value = await composition.vmStatus(body.scope); break;
        case 'reviewVmEnvironment': value = composition.reviewVmEnvironment(body.actionId, body.explicitUserAction); break;
        case 'prepareVmEnvironment': value = composition.prepareVmEnvironment(body.actionId, body.reviewDigest, body.explicitUserAction); break;
        case 'attachVmWorkspace': value = composition.attachVmWorkspace(body.scope, body.root, body.acknowledgeIsolation, body.explicitUserAction); break;
        case 'revokeVmWorkspace': value = await composition.revokeVmWorkspace(body.scope, body.bindingId, body.explicitUserAction); break;
        case 'cancelVmOperation': value = await composition.cancelVmOperation(body.scope, body.operationId, body.explicitUserAction); break;
        case 'reconcileVmOperation': value = await composition.reconcileVmOperation(body.scope, body.operationId, body.explicitUserAction) ?? null; break;
        case "grantScriptWorkspace": value = composition.grantScriptWorkspace(body.scope, body.root, body.access, body.acknowledgeRestrictions, body.explicitUserAction); break;
        case "revokeScriptWorkspace": await composition.revokeScriptWorkspace(body.scope, body.grantId, body.explicitUserAction); value = { revoked: true }; break;
        case 'vmNetworkStatus': value = composition.vmNetworkStatus(body.scope); break;
        case 'grantVmNetwork': {
          const before = JSON.stringify(composition.vmNetworkStatus().grants);
          try { value = composition.grantVmNetwork(body.input, body.explicitUserAction); }
          catch (error) {
            // A fault after insertion stays uncertain, even if it carries one
            // of the familiar validation strings. This is a synchronous path.
            if (error instanceof Error && preGrantRefusals.has(error.message)
              && JSON.stringify(composition.vmNetworkStatus().grants) === before) throw new PublicNetworkGrantRefusal(error.message);
            throw error;
          }
          break;
        }
        case 'revokeVmNetwork': value = await composition.revokeVmNetwork(body.scope, body.grantId, body.explicitUserAction); break;
        case 'pythonBuildStatus': value = composition.pythonBuildStatus(body.scope); break;
        case 'reviewPythonBuild':
          try { value = await composition.reviewPythonBuild(body.actionId, body.selectionId, body.scope, body.explicitUserAction); }
          catch (error) {
            if (error instanceof Error && error.message === 'python-build-backend-closure-missing') throw new PublicPythonBuildReviewRefusal(pythonBuildBackendClosureMessage);
            throw error;
          }
          break;
        case 'preparePythonBuild': value = await composition.preparePythonBuild(body.actionId, body.reviewDigest, body.scope, body.explicitUserAction); break;
        case 'attachPythonBuild': value = composition.attachPythonBuild(body.actionId, body.scope, body.explicitUserAction); break;
        case 'revokePythonBuild': value = await composition.revokePythonBuild(body.scope, body.explicitUserAction); break;
        case 'cancelPythonBuild': await composition.cancelPythonBuild(body.actionId, body.explicitUserAction); value = {cancelRequested:true}; break;
        case 'reconcilePythonBuild': value = await composition.reconcilePythonBuild(body.actionId, body.explicitUserAction); break;
        case "pythonEnvironmentStatus": value = composition.pythonEnvironmentStatus(); break;
        case "reviewPythonEnvironment": value = composition.reviewPythonEnvironment(body.actionId, body.wheelPaths, body.explicitUserAction, {requirements:body.requirements,directArtifacts:body.directArtifacts}); break;
        case "preparePythonEnvironment": value = composition.preparePythonEnvironment(body.actionId, body.reviewDigest, body.explicitUserAction); break;
        case "pythonEnvironmentAction": value = composition.pythonEnvironmentAction(body.actionId); break;
        case "reconcilePythonEnvironment": value = composition.reconcilePythonEnvironment(body.actionId, body.explicitUserAction); break;
        case "bindPythonEnvironment": value = composition.bindPythonEnvironment(body.scope, body.environmentId, body.explicitUserAction); break;
        case "revokePythonEnvironment": await composition.revokePythonEnvironment(body.scope, body.bindingId, body.explicitUserAction); value = { revoked: true }; break;
        case "skillRoot": value = composition.addSkillRoot(body.input, body.explicitUserAction); break;
        case "skillsDiscover": value = composition.discoverSkills(body.grantId); break;
        case "removeSkillRoot": value = composition.removeSkillRoot(body.grantId, body.explicitUserAction); break;
        case "skillsSelect": value = composition.selectSkill(body.scope, body.identity, body.explicitUserAction); break;
        case "reviewSkillImport": value = await composition.presentSkillReview(composition.reviewSkillImport(body.actionId, body.identity, body.label, body.updateLineageId, body.explicitUserAction)); break;
        case "reviewSkillPackageImport": value = await composition.presentSkillReview(composition.reviewSkillPackageImport(body.actionId, body.selection, body.label, body.updateLineageId, body.explicitUserAction)); break;
        case "commitSkillImport": value = composition.commitSkillImport(body.actionId, body.reviewDigest, body.explicitUserAction); break;
        case "managedSkillAction": value = await composition.presentSkillReview(composition.managedSkillAction(body.actionId) ?? null); break;
        case "attachManagedSkill": value = composition.attachManagedSkill(body.scope, body.versionId, body.explicitUserAction); break;
        case "detachManagedSkill": await composition.detachManagedSkill(body.scope, body.versionId, body.explicitUserAction); value = { detached: true }; break;
        case "revokeManagedSkill": value = await composition.revokeManagedSkill(body.versionId, body.forget, body.explicitUserAction); break;
      }
      return Response.json({ ok: true, value });
    } catch (error) {
      const invalid = error instanceof z.ZodError;
      // Fixed domain strings are safe; arbitrary filesystem/SDK errors can contain private paths.
      const message = error instanceof PublicNetworkGrantRefusal || error instanceof PublicPythonBuildReviewRefusal ? error.message : isPythonEnvironmentError(error) ? pythonEnvironmentPublicReason(error)
        : error instanceof Error && /^(?:Explicit |Current owned|Local tools admission|No exact |Pending Agent|Wait for owned|Configuration review|Reserved (?:builtin|browser|desktop|remote)|Installers,|Interpreter recipes|Pinned server|Tools host|Standalone tool|Tool |Selected skill|Skill root|Skill source|Managed skill|Exact reviewed managed|Official\/vendor plugin|Native OS|Invalid secret|Unsupported server)/.test(error.message) ? error.message : "The tools action could not be completed. Inspect the current saved configuration and receipt before retrying.";
      return Response.json({ ok: false, error: invalid ? "invalid_request" : "agent_tools_conflict", message }, { status: invalid ? 400 : 409 });
    }
  };
}
