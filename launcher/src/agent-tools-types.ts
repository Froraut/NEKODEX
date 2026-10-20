import type { OAuthProviderRegistrationReview } from '../../src/agent-tools/oauth-types';
import type { PythonBuildAction, PythonBuildSelection } from '../../src/execution-environments/python-build';
import type { OfficialMcpRecipe } from '../../src/agent-tools/installer';
import type { ServerRecipe } from '../../src/agent-tools/config';
import type { ToolDescriptor, ToolScope, ToolOutcome } from '../../src/agent-tools/types';
import type { SkillIdentity, SkillRootGrant, SelectedSkill } from '../../src/agent-tools/skills';
import type { BrowserBinding } from '../../src/browser-companion/protocol';
import type { AgentDesktopStatus } from './agent-desktop-types';
import type { AgentPendingToolCall } from './agent-mode-types';
import type { RemoteAgentStatus, RemoteAgentTaskScope } from '../electron/agent-remote-types.cjs';
import type { SkillPythonEnvironmentAction, SkillPythonEnvironmentDescriptor } from '../../src/agent-tools/skill-python-environment';
import type { VmNetworkGrant, VmNetworkGrantInput, VmNetworkScope } from '../../src/execution-environments/network';
export type { VmNetworkGrant, VmNetworkGrantInput, VmNetworkScope };
export type { SkillPythonEnvironmentAction, SkillPythonEnvironmentDescriptor };
export type { RemoteAgentStatus, RemoteAgentTaskScope };
export type { ServerRecipe, ToolDescriptor, ToolScope, ToolOutcome, SkillIdentity, SkillRootGrant, SelectedSkill };
export interface AgentToolsApi {
  request(body: Record<string, unknown>): Promise<unknown>;
  pickSkillRoot(): Promise<{ cancelled: boolean; grant?: SkillRootGrant }>;
  pickOAuthProvider?(): Promise<{ cancelled: boolean; review?: OAuthProviderRegistrationReview }>;
  pickScriptWorkspace?(): Promise<{ cancelled: boolean; root?: string }>;
  pickPythonWheels?(): Promise<{ cancelled: boolean; wheelPaths?: string[] }>;
  pickPythonBuild?(scope: ToolScope, config: AgentPythonBuildConfig): Promise<{ cancelled: boolean; selection?: AgentPythonBuildSelection }>;
  pickInstallRoot?(): Promise<{ cancelled: boolean; root?: string }>;
  /** Exact private pending calls come from the owned Agent-mode store through its guarded API. */
  listTasks(): Promise<{ tasks: { id: string; generation: number; status: string }[] }>;
  getTask(taskId: string): Promise<{ task: { id: string; familyId: string; generation: number; revision: number; status?: string }; dispatches: { id: string; generation: number; result?: { continuation?: { pending: AgentPendingToolCall[] } } }[]; toolOutcomes?: ToolOutcome[]; pendingToolCalls?: AgentPendingToolCall[]; coverage?: { pendingToolCalls?: { total: number; truncated: boolean } } }>;
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
export type ManagedSkillScriptResourceView = {
  kind: 'script'; relativePath: string;
  digest: string; bytes: number; content: string;
  role?: 'selected-skill-source-material';
} & ({ mediaType: 'text/javascript'; runtime?: never } | { mediaType: 'text/x-python'; runtime: 'python' });
export interface ManagedSkillDocumentPreview {
  state: 'completed' | 'failed' | 'unknown' | 'unavailable';
  sourceSha256: string; sourceBytes: number; coverage: 'text-layer-only';
  text?: string; pageCount?: number; pagesWithText?: number; pagesWithoutText?: number; reason?: string;
  extractor: { provider: 'macos-pdfkit'; version: 1; executableSha256?: string; sourceSha256?: string };
  owner?: unknown;
}
export interface ManagedSkillDocumentResourceView {
  kind: 'document'; mediaType: 'application/pdf'; format: 'pdf'; relativePath: string; digest: string; bytes: number;
  preview: ManagedSkillDocumentPreview;
  role?: 'selected-skill-source-material';
}
export type ManagedSkillResourceView = ManagedSkillTextResourceView | ManagedSkillImageResourceView | ManagedSkillScriptResourceView | ManagedSkillDocumentResourceView;
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
  capabilities: { supported: boolean; runtimes?: {
    javascript: { supported: boolean; reason?: string };
    python: { supported: boolean; reason?: string; executable?: string; executableSha256?: string; closureDigest?: string };
  }; [key: string]: unknown };
  grants: AgentSkillScriptWorkspaceGrant[];
  environmentBindings?: { id: string; taskId: string; generation: number; environmentId: string; closureDigest: string }[];
  activeOperations: { operationId: string; workspaceGrantId: string; taskId: string; generation: number }[];
}
export interface AgentVmEnvironmentReview {
  state: 'reviewed' | 'preparing' | 'prepared' | 'failed'; reason?: string;
  actionId: string; reviewDigest: string; helperSha256: string; guestManifestSha256: string;
  cpuCount: 2; memoryBytes: 2147483648; network: false; hostShares: false;
}
export interface AgentVmToolsStatus {
  available: boolean; reason?: string; runtimeDigest: string | null; closed: boolean;
  bindings: { id: string; taskId: string; generation: number; label: string; runtimeDigest: string }[];
  activeOperations: { operationId: string; actionId: string; taskId: string; generation: number; bindingId: string; ownerHeld: boolean }[];
  operations?: { operationId: string; actionId: string; taskId: string; generation: number; bindingId: string; ownerHeld: boolean;
    state: 'pending' | 'stopped' | 'never-started' | 'unknown'; guestExitCode: number | null;
    candidates: { path: string; size: number; sha256: string; mode: number }[]; reason?: string; resultDigest?: string;
  }[];
}
export interface AgentVmNetworkStatus {
  available: boolean; mode: 'separately-approved-host-broker'; guestNic: false; activeCount: number;
  grants: { grant: VmNetworkGrant; revoked: boolean }[];
}
export interface AgentToolsStatus {
  config: { version: 1; enabled: boolean; servers: ServerRecipe[] };
  runtime: { enabled: boolean; servers: { id: string; connected: boolean; pid: number | null; sandbox?: string; boundary?: unknown }[]; sandbox: string };
  activeCount: number;
  /** Protected OAuth owner identity only; never credentials or callback data. */
  oauthScope?: { accountId: string; epoch: string | number };
  descriptors: ToolDescriptor[];
  vmEnvironment?: { prepared: boolean; supported: boolean; reason?: string; runtimeDigest?: string; review?: AgentVmEnvironmentReview };
  vmTools?: AgentVmToolsStatus | null;
  vmNetwork?: AgentVmNetworkStatus;
  pythonEnvironments?: { supported: boolean; reason?: string; environments: SkillPythonEnvironmentDescriptor[]; actions: SkillPythonEnvironmentAction[] };
  skillRoots: SkillRootGrant[];
  selections: { scope: ToolScope; skills: SkillIdentity[] }[];
  capabilities: { stdio: boolean; install: boolean; oauth: boolean; secrets: boolean; nativeSandbox: boolean; mcpSandboxAvailable?: boolean; skillWrites: boolean; managedSkillImports?: boolean; skillResourceReads?: boolean; skillScripts?: boolean; pendingToolCalls: boolean };
  installCatalog: readonly OfficialMcpRecipe[];
  installations: { rows: { actionId: string; catalogId: string; state: string; allowedRoot: string; graphSha256?: string; childPid?: number }[]; truncated: boolean };
  serverConfigDigests: Record<string, string>;
  managedSkills?: { versions: ManagedSkillVersionView[]; retainedVersions: number; forgottenVersions: number; cleanup: string; attachments: { scope: ToolScope; versionIds: string[] }[]; actions: { actionId: string; label: string; state: string; versionId: string; lineageId: string; reviewDigest: string }[] };
  browserTools?: { providerId: string; available: boolean; selected: BrowserBinding | null; bound: boolean; reason: string | null; bindings: { taskId: string; generation: number; binding: BrowserBinding; observed: boolean; active: boolean }[] } | null;
  desktopTools?: AgentDesktopStatus | null;
  remoteTools?: RemoteAgentStatus | null;
  scriptTools?: AgentSkillScriptsStatus | null;
}

export interface AgentPythonBuildSelection {
  selectionId: string; name: string; version: string; sourceKind: 'tree' | 'zip' | 'tar.gz';
  sourceFileCount: number; buildWheelCount: number; runtimeWheelCount: number;
  bytes: number; snapshotDigest: string; excludedEntries: number;
}
export interface AgentPythonBuildStatus {
  supported: boolean; reason?: string; selectionAvailable?: boolean; actions: PythonBuildAction[];
  bindings: { actionId: string; taskId: string; generation: number; closureDigest: string;
    packages: { name: string; version: string; artifactSha256: string }[] }[];
  processLocalReviews: true; importRoot: 'python-environment'; network: false;
}

export type AgentPythonBuildConfig = Pick<PythonBuildSelection, 'name' | 'version' | 'backend' | 'backendPath' | 'buildRequires' | 'additionalBuildRequires' | 'configSettings' | 'timeoutMs'>;
