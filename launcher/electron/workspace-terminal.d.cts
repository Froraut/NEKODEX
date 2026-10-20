export interface TerminalRef { id: string; generation: string }
export interface TerminalGrant { id: string; path: string }
export interface TerminalSize { cols?: number; rows?: number }
export interface WorkspaceTerminalSession extends TerminalRef {
  workspaceId: string; cwd: string; shell: string; state: "running" | "closing" | "closed" | "exited" | "error";
  cols: number; rows: number; exitCode: number | null; signal: number | null; error: string | null; paused: boolean; cursor: number;
}
export type TerminalAvailability = { available: true; provider: "node-pty"; runtime: string; abi: string | null }
  | { available: false; provider: "node-pty"; code: string; message: string };
export interface TerminalRead {
  session: WorkspaceTerminalSession; chunks: { cursor: number; data: string }[];
  cursor: number; dropped: boolean; eof: boolean;
}
export interface WorkspaceTerminalService {
  availability(): TerminalAvailability;
  open(grant: TerminalGrant, size?: TerminalSize): WorkspaceTerminalSession;
  get(reference: TerminalRef): WorkspaceTerminalSession;
  list(workspaceId: string): WorkspaceTerminalSession[];
  read(reference: TerminalRef, cursor?: number): TerminalRead;
  write(reference: TerminalRef, data: string, grant: TerminalGrant): WorkspaceTerminalSession;
  resize(reference: TerminalRef, size: TerminalSize, grant: TerminalGrant): WorkspaceTerminalSession;
  close(reference: TerminalRef): WorkspaceTerminalSession;
  closeAll(): WorkspaceTerminalSession[];
  destroy(): Promise<void>;
  currentOperation(): string | null;
}
export function createWorkspaceTerminalService(options?: {
  loadProvider?: () => unknown; shell?: string; environment?: () => Record<string, string>;
}): WorkspaceTerminalService;
export const LIMITS: Readonly<{ sessions: number; outputBytes: number; pauseBytes: number; resumeBytes: number;
  readBytes: number; inputBytes: number; chunkChars: number; minCols: number; maxCols: number; minRows: number; maxRows: number }>;
