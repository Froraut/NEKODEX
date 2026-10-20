import { expect, test } from 'bun:test';
import { agentPendingCalls } from '../launcher/src/AgentToolsSurface';

test('tool approval loads current compact metadata even when image history omits the newest dispatch', () => {
  const previous = { toolCallId: 'old-observe', tool: 'desktop/observe', arguments: {} };
  const click = { toolCallId: 'fourth-click', tool: 'desktop/click', arguments: { ref: 'exact-owned-ref' }, wireName: 'agent_tool_2' };
  const legacy = { task: { id: 'task', generation: 2 }, dispatches: [{ id: 'older-visible-dispatch', generation: 2, result: { continuation: { pending: [previous] } } }] };
  // The new call's canonical image-bearing dispatch is absent from the bounded
  // history, but its authoritative pending metadata still drives exact approval.
  expect(agentPendingCalls({ ...legacy, pendingToolCalls: [click] })).toEqual([click]);
  expect(agentPendingCalls({ ...legacy, pendingToolCalls: [] })).toEqual([]);
  expect(agentPendingCalls(legacy)).toEqual([previous]);
  expect(agentPendingCalls({ ...legacy, toolOutcomes: [{ idempotencyKey: 'retained', scope: { taskId: 'task', generation: 2, toolCallId: previous.toolCallId }, tool: previous.tool, state: 'outcome_unknown' }] })).toEqual([]);
});
