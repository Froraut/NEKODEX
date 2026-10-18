import type { ServerRecipe } from '../../src/agent-tools/config';
import type { ToolDescriptor, ToolScope, ToolOutcome } from '../../src/agent-tools/types';
import type { SkillIdentity, SkillRootGrant, SelectedSkill } from '../../src/agent-tools/skills';
export type { ServerRecipe, ToolDescriptor, ToolScope, ToolOutcome, SkillIdentity, SkillRootGrant, SelectedSkill };
export interface AgentToolsApi {
  request(body: Record<string, unknown>): Promise<unknown>;
  pickSkillRoot(): Promise<{ cancelled: boolean; grant?: SkillRootGrant }>;
  pickInstallRoot?(): Promise<{ cancelled: boolean; root?: string }>;
  /** Exact private pending calls come from the owned Agent-mode store through its guarded API. */
  listTasks(): Promise<{ tasks: { id: string; generation: number; status: string }[] }>;
  getTask(taskId: string): Promise<{ task: { id: string; generation: number }; dispatches: { id: string; generation: number; result?: { continuation?: { pending: { toolCallId: string; tool: string; arguments: Record<string, unknown> }[] } } }[]; toolOutcomes?: ToolOutcome[] }>;
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
}
export interface ManagedSkillReviewView {
  action: { actionId: string; state: string; versionId: string; lineageId: string; label: string; reviewDigest: string; manifestDigest: string; manifest: unknown };
  content?: string;
}
export interface AgentToolsStatus {
  config: { version: 1; enabled: boolean; servers: ServerRecipe[] };
  runtime: { enabled: boolean; servers: { id: string; connected: boolean; pid: number | null; sandbox?: string; boundary?: unknown }[]; sandbox: string };
  activeCount: number;
  descriptors: ToolDescriptor[];
  skillRoots: SkillRootGrant[];
  selections: { scope: ToolScope; skills: SkillIdentity[] }[];
  capabilities: { stdio: boolean; install: boolean; oauth: boolean; secrets: boolean; nativeSandbox: boolean; mcpSandboxAvailable?: boolean; skillWrites: boolean; managedSkillImports?: boolean; pendingToolCalls: boolean };
  installCatalog: { id: string; label: string; package: string; version: string; integrity: string; source: string; capabilities: string }[];
  installations: { rows: { actionId: string; catalogId: string; state: string; allowedRoot: string; graphSha256?: string; childPid?: number }[]; truncated: boolean };
  serverConfigDigests: Record<string, string>;
  managedSkills?: { versions: ManagedSkillVersionView[]; retainedVersions: number; forgottenVersions: number; cleanup: string; attachments: { scope: ToolScope; versionIds: string[] }[]; actions: { actionId: string; label: string; state: string; versionId: string; lineageId: string; reviewDigest: string }[] };
}
