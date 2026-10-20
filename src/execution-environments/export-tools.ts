import type { StandaloneBuiltinToolsProvider } from '../agent-tools/types';
import type { createLauncherVmExportBridge } from './launcher-export';

/** Export remains a declared tool under the same vm-shell namespace and the
 * same host approval/journal. Discovery only reads already prepared main reviews. */
export function createVmExportTools(bridge: ReturnType<typeof createLauncherVmExportBridge>): Pick<StandaloneBuiltinToolsProvider, 'discover' | 'execute' | 'reconcile'> {
  return {
    async discover(scope) {
      const result = await bridge.list({ taskId: scope.taskId, generation: scope.generation });
      const reviews = result.reviews.filter(row => row.scope.taskId === scope.taskId && row.scope.generation === scope.generation);
      if (!reviews.length) return [];
      return [{ id: 'vm-shell/export', serverId: 'vm-shell', name: 'export', supported: true,
        description: 'Publish one already reviewed VM output candidate into its selected host workspace. The exact review binds candidate bytes, destination and expected revision. This call needs separate approval; stale user edits refuse publication. A written-file receipt proves the file property only, not task completion.',
        inputSchema: { type: 'object', oneOf: reviews.map(row => ({ type: 'object', properties: { reviewId: { const: row.reviewId }, reviewDigest: { const: row.reviewDigest } }, required: ['reviewId', 'reviewDigest'], additionalProperties: false })) } }];
    },
    execute: request => bridge.execute(request),
    // The passive receipt cannot settle a publication whose written-node proof
    // was retained before a lost response; only main's reconcile confirms it.
    // An absent action also needs the exclusive main owner to prove no intent
    // was recorded (for example after a pre-intent lock refusal).
    async reconcile(request) {
      const receipt = await bridge.receipt(request);
      return !receipt || receipt.state === 'outcome_unknown' ? await bridge.reconcile(request) ?? receipt : receipt;
    },
  };
}
