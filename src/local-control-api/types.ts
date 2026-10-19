import type { ConversationHistoryStore } from "../conversation-history";
export interface LocalControlApiStatus {
  apiVersion: "1";
  enabled: boolean;
  credentialConfigured: boolean;
  historyContent: boolean;
  permissions: string[];
  policyPath: string;
  /** Main-process presentation only; never part of the persisted policy. */
  baseUrl?: string;
}
export interface ControlTaskMetadata {
  id: string;
  state: string;
  kind?: string;
  mode?: string;
  familyId?: string;
  generation?: number;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}
export interface ScopedAgentAction {
  taskId: string;
  actionId: string;
  familyId: string;
  generation: number;
  revision: number;
  operation: "pause" | "resume" | "stop" | "step" | "review";
  explicitUserAction: true;
}
export interface LocalControlApiSources {
  status: () => { version: string; ready: boolean; activeHttpTurns?: number; activeAgentTasks?: number } | undefined;
  tasks?: () => readonly ControlTaskMetadata[] | undefined;
  agentTasks?: () => readonly ControlTaskMetadata[] | undefined;
  /** Return the already-owned store. Reading must not create a second writer. */
  history?: () => ConversationHistoryStore | undefined;
}
export interface LocalControlApiRouteOptions {
  coreHome: string;
  authorizeAdmin: (request: Request) => boolean;
  /** Inject the existing listener's exact Host/Origin guard. */
  localGuard: (request: Request, url: URL, port: number) => Response | undefined;
  port: () => number;
  peerAddress: (request: Request) => string | undefined;
  sources: LocalControlApiSources;
  /** One existing AgentMode owner validates scope + durable action id before sending. */
  agentAction?: (input: ScopedAgentAction) => unknown | Promise<unknown>;
  /** Passive lookup on the already-owned command store; undefined means unknown. */
  agentActionReceipt?: (input: ScopedAgentAction) => unknown | Promise<unknown>;
}
