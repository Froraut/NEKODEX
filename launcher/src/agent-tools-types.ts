import type { ServerRecipe } from '../../src/agent-tools/config';
import type { ToolDescriptor, ToolScope, ToolOutcome } from '../../src/agent-tools/types';
import type { SkillIdentity, SkillRootGrant, SelectedSkill } from '../../src/agent-tools/skills';
import type { BrowserBinding } from '../../src/browser-companion/protocol';
import type { AgentDesktopStatus } from './agent-desktop-types';
import type { AgentPendingToolCall } from './agent-mode-types';
import type { RemoteAgentStatus, RemoteAgentTaskScope } from '../electron/agent-remote-types.cjs';
export type { RemoteAgentStatus, RemoteAgentTaskScope };
export type { ServerRecipe, ToolDescriptor, ToolScope, ToolOutcome, SkillIdentity, SkillRootGrant, SelectedSkill };
export interface AgentToolsApi {
  request(body: Record<string, unknown>): Promise<unknown>;
  pickSkillRoot(): Promise<{ cancelled: boolean; grant?: SkillRootGrant }>;
  pickScriptWorkspace?(): Promise<{ cancelled: boolean; root?: string }>;
  pickInstallRoot?(): Promise<{ cancelled: boolean; root?: string }>;
  /** Exact private pending calls come from the owned Agent-mode store through its guarded API. */
  listTasks(): Promise<{ tasks: { id: string; generation: number; status: string }[] }>;
  getTask(taskId: string): Promise<{ task: { id: string; familyId: string; generation: number; revision: number }; dispatches: { id: string; generation: number; result?: { continuation?: { pending: AgentPendingToolCall[] } } }[]; toolOutcomes?: ToolOutcome[]; pendingToolCalls?: AgentPendingToolCall[]; coverage?: { pendingToolCalls?: { total: number; truncated: boolean } } }>;
  attachEvidence?(taskId: string, reference: { sourceEventId: string; requirementId: string; subject: string; subjectRevision: string; property: string }): Promise<unknown>;
}
export interface ManagedInstallReceipt {
  actionId: string; catalogId: string; state: string; allowedRoot: string;
  graphSha256?: string; lockSha256?: string; graph?: { name: string; version: string; integrity: string }[];
  runtime?: string; archive?: string; tree?: { sha256: string; files: number }; reason?: string;
}
export interface ManagedSkillVersionView {
  versionId: string; lineageId: string; label: string; contentDigest: string; bytes: number;
  manifestDigest: string; sourceLocator: string; createdAt: number; revoked: boolean; forgotten: boolean;
  packageDigest?: string;
  resourceCount?: number;
}
export interface ManagedSkillTextResourceView {
  relativePath: string;
  mediaType: 'text/markdown' | 'text/plain' | 'application/json' | 'text/csv';
  digest: string;
  bytes: number;
  content: string;
  kind?: never;
  role?: 'selected-skill-source-material';
}
export interface ManagedSkillImageResourceView {
  kind: 'image'; relativePath: string; mediaType: 'image/png' | 'image/jpeg';
  digest: string; bytes: number; width: number; height: number; data: string;
  role?: 'selected-skill-source-material';
}
export interface ManagedSkillScriptResourceView {
  kind: 'script'; relativePath: string; mediaType: 'text/javascript';
  digest: string; bytes: number; content: string;
  role?: 'selected-skill-source-material';
}
export type ManagedSkillResourceView = ManagedSkillTextResourceView | ManagedSkillImageResourceView | ManagedSkillScriptResourceView;
export interface ManagedSkillReviewView {
  action: { actionId: string; state: string; versionId: string; lineageId: string; label: string; reviewDigest: string; manifestDigest: string; manifest: unknown };
  content?: string;
  resources?: ManagedSkillResourceView[];
}
export interface AgentSkillScriptWorkspaceGrant {
  id: string; taskId: string; generation: number; root: string; dev: string; ino: string;
  access: 'read-only' | 'read-write';
}
export interface AgentSkillScriptsStatus {
  closed: boolean;
  capabilities: { supported: boolean; [key: string]: unknown };
  grants: AgentSkillScriptWorkspaceGrant[];
  activeOperations: { operationId: string; workspaceGrantId: string; taskId: string; generation: number }[];
}
export interface AgentToolsStatus {
  config: { version: 1; enabled: boolean; servers: ServerRecipe[] };
  runtime: { enabled: boolean; servers: { id: string; connected: boolean; pid: number | null; sandbox?: string; boundary?: unknown }[]; sandbox: string };
  activeCount: number;
  descriptors: ToolDescriptor[];
  skillRoots: SkillRootGrant[];
  selections: { scope: ToolScope; skills: SkillIdentity[] }[];
  capabilities: { stdio: boolean; install: boolean; oauth: boolean; secrets: boolean; nativeSandbox: boolean; mcpSandboxAvailable?: boolean; skillWrites: boolean; managedSkillImports?: boolean; skillResourceReads?: boolean; skillScripts?: boolean; pendingToolCalls: boolean };
  installCatalog: { id: string; label: string; package: string; version: string; integrity: string; source: string; capabilities: string }[];
  installations: { rows: { actionId: string; catalogId: string; state: string; allowedRoot: string; graphSha256?: string; childPid?: number }[]; truncated: boolean };
  serverConfigDigests: Record<string, string>;
  managedSkills?: { versions: ManagedSkillVersionView[]; retainedVersions: number; forgottenVersions: number; cleanup: string; attachments: { scope: ToolScope; versionIds: string[] }[]; actions: { actionId: string; label: string; state: string; versionId: string; lineageId: string; reviewDigest: string }[] };
  browserTools?: { providerId: string; available: boolean; selected: BrowserBinding | null; bound: boolean; reason: string | null; bindings: { taskId: string; generation: number; binding: BrowserBinding; observed: boolean; active: boolean }[] } | null;
  desktopTools?: AgentDesktopStatus | null;
  remoteTools?: RemoteAgentStatus | null;
  scriptTools?: AgentSkillScriptsStatus | null;
}
