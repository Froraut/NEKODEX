import type { ToolScope } from "./types";
import { validateToolScope } from "./journal";

export interface NativeSandboxCapability {
  supported: boolean;
  platform: NodeJS.Platform;
  /** Real OS isolation provider identity; a JS interpreter or wrapper is not a sandbox. */
  mechanism?: string;
  enforces?: { filesystem: boolean; network: boolean; childProcesses: boolean };
  reason?: string;
}
export interface NativeWorkspaceGrant {
  scope: ToolScope;
  canonicalRoot: string;
  trusted: boolean;
  approvals: "deny" | "per-operation";
}
export const unavailableNativeSandbox = (): NativeSandboxCapability => ({ supported: false, platform: process.platform, reason: "No verified OS sandbox executor is installed in standalone Agent mode" });
/** Native exec remains fail-closed until a real platform executor supplies all restrictions. */
export function requireNativeExecutionAuthority(input: { scope: ToolScope; workspace: NativeWorkspaceGrant; capability: NativeSandboxCapability; approvedOperation: boolean }): void {
  validateToolScope(input.scope);
  const { workspace, capability } = input;
  if (workspace.scope.taskId !== input.scope.taskId || workspace.scope.generation !== input.scope.generation || workspace.scope.toolCallId !== input.scope.toolCallId || !workspace.trusted || workspace.approvals !== "per-operation" || !input.approvedOperation) throw new Error("Trusted workspace and exact native operation approval required");
  if (!capability.supported || capability.platform !== process.platform || !capability.mechanism || !capability.enforces?.filesystem || !capability.enforces.network || !capability.enforces.childProcesses) throw new Error("Native OS sandbox unavailable; operation was not executed");
}
