import type { TerminalAvailability, TerminalRead, TerminalRef, TerminalSize,
  WorkspaceTerminalSession } from "../electron/workspace-terminal.cjs";
export type { TerminalAvailability, TerminalRead, TerminalRef, TerminalSize, WorkspaceTerminalSession };
/** Renderer-only human controls. This API is not exposed to model tools. */
export interface WorkspaceTerminalApi {
  terminalAvailability(): Promise<TerminalAvailability>;
  terminalOpen(workspaceId: string, size?: TerminalSize): Promise<WorkspaceTerminalSession>;
  terminalList(workspaceId: string): Promise<WorkspaceTerminalSession[]>;
  terminalRead(reference: TerminalRef, cursor?: number): Promise<TerminalRead>;
  terminalWrite(reference: TerminalRef, data: string): Promise<WorkspaceTerminalSession>;
  terminalResize(reference: TerminalRef, size: TerminalSize): Promise<WorkspaceTerminalSession>;
  terminalClose(reference: TerminalRef): Promise<WorkspaceTerminalSession>;
}
