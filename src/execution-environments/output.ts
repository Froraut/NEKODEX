/** Current review authority and the generation that produced a file are distinct.
 * This predicate grants no execution or publication authority. */
export interface VmTaskReference { taskId: string; generation: number }
export function canReviewVmSource(current: VmTaskReference, source: VmTaskReference): boolean {
  return current.taskId === source.taskId && Number.isSafeInteger(source.generation) && source.generation > 0
    && Number.isSafeInteger(current.generation) && current.generation >= source.generation;
}
export interface VmOutputOperation extends VmTaskReference {
  operationId: string; state: string; ownerHeld: boolean;
  candidates: readonly { path: string; size: number; sha256: string; mode: number }[];
}
export interface VmOutputReference {
  operationId: string; sourceGeneration: number; path: string; size: number; sha256: string; mode: number;
}
export function selectVmOutputCandidates(operations: readonly VmOutputOperation[], current?: VmTaskReference): VmOutputReference[] {
  if (!current) return [];
  return operations.filter(row => canReviewVmSource(current, row) && row.state === 'stopped' && !row.ownerHeld)
    .flatMap(row => row.candidates.map(candidate => ({ ...candidate, operationId: row.operationId, sourceGeneration: row.generation })));
}
