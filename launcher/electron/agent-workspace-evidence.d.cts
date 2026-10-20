import type { WorkspaceDirectoryChain } from './workspace-file-capture.cjs';
export interface WorkspaceEvidenceTask {id:string;familyId:string;generation:number;revision:number;requirements:ReadonlyArray<{id:string}>}
export interface WorkspaceEvidenceProof {
  version:1;namespace:'nekodex:workspace-file-observation:v1';id:string;taskId:string;familyId:string;generation:number;revision:number;requirementId:string;
  workspaceId:string;rootPath:string;ancestry:WorkspaceDirectoryChain;relativePath:string;property:'file-exists'|'file-absent'|'file-sha256';expectedSha256:string|null;
  capture:{exists:boolean;revision:string|null;sha256:string|null;size:number};createdAt:string;signature:string;
}
export function createAgentWorkspaceEvidenceAuthority(input:{keyPath:string;resolveWorkspace:(workspaceId:string)=>Readonly<{id:string;path:string}>}):{
  observe(input:{task:WorkspaceEvidenceTask;observationId:string;workspaceId:string;relativePath:string;requirementId:string;property:'file-exists'|'file-absent'|'file-sha256';expectedSha256?:string}):WorkspaceEvidenceProof;
};
export function verifyWorkspaceEvidenceProof(input:{keyPath:string;proof:unknown;task:WorkspaceEvidenceTask}):WorkspaceEvidenceProof;

/** Validates signature/scope/admitted main receipt only; use verifyWorkspaceEvidenceProof for current file proof. */
export function authenticateWorkspaceEvidenceProof(input:{keyPath:string;proof:unknown;task:WorkspaceEvidenceTask}):WorkspaceEvidenceProof;
