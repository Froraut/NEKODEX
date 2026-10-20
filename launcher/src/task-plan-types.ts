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

export interface TaskRequirementAction {
  key: string; source: 'task-tool-result'; name: string; namespace?: string; observedAt: number;
}
export interface TaskRequirementCoverage {
  id: string; requirementId: string; requirementRevision: number; planRevision: number | null;
  stepIndexes: number[]; actionReferences: TaskRequirementAction[]; savedAt: number;
  userAttestation?: { source: 'user-confirmed'; confirmedAt: number };
}
export interface TaskRequirementBook {
  version: 1; accountId: string; taskId: string; native: { threadId: string; turnId: string };
  revision: number; requirementRevision: number; planRevision: number | null;
  history: Array<{ revision: number; source: 'user-original' | 'user-correction'; savedAt: number;
    requirements: Array<{ id: string; text: string }> }>;
  coverage: TaskRequirementCoverage[];
  coverageHistory: TaskRequirementCoverage[];
  consent: { source: 'explicit-user-input'; confirmedAt: number };
  invalidation?: { reason: 'plan-changed' | 'requirements-corrected'; at: number };
  availableActions: TaskRequirementAction[];
  propertyVerification: 'unavailable';
}
export interface TaskRequirementSaveInput {
  accountId: string; taskId: string; expectedRevision: number; texts: string[]; captureConsent: true;
}
export interface TaskRequirementCoverageInput {
  accountId: string; taskId: string; expectedRevision: number; requirementId: string;
  stepIndexes: number[]; actionKeys: string[]; userConfirmed: boolean;
}
