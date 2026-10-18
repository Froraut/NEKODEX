export interface TaskPlanObservation {
  version: 1; observedAt: number; source: 'native-codex-current-turn';
  state: 'disabled' | 'unavailable' | 'observed'; reason?: string;
  native?: { threadId: string; turnId: string };
  revisions: Array<{ revision: number; sourceCallId: string; sourceMessageId?: string;
    supersedes?: number; explanation?: string;
    steps: Array<{ text: string; claimedStatus: 'pending' | 'in_progress' | 'completed'; evidence: 'observed'; verification: 'unverified' }> }>;
  truncated: boolean;
}
export interface TaskPlanPolicy { version: 1; enabled: boolean; revision: number; storageIssue: string | null }
