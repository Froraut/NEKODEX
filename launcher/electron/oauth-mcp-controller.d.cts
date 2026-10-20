export interface AgentOAuthMcpController {
  request(body: unknown): Promise<unknown>;
  dispatch(action: string, body: unknown): Promise<unknown>;
  status(): unknown;
  invalidate(taskId?: string): void;
  currentOperation(): string | null;
  close(): Promise<void>;
}
export function createAgentOAuthMcpController(options: { coreHome: string; oauthService: import('./agent-oauth-service.cjs').AgentOAuthService; validateTask(scope: { taskId: string; generation: number; toolCallId: string }): Promise<unknown>; validateIntent(request: unknown): Promise<unknown> }): AgentOAuthMcpController;
