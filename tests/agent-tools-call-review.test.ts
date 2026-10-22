import { expect, test } from 'bun:test';
import { agentToolsCallSummary, desktopCallAttached } from '../launcher/src/AgentToolsCallSummary';
import type { AgentDesktopStatus } from '../launcher/src/agent-desktop-types';

const choose = (en: string) => en;
const task = { id: 'task-a', generation: 3 };
const windowA = { windowId: '1', processId: '10:1', windowEpoch: 'a'.repeat(64) };
const windowB = { windowId: '2', processId: '20:1', windowEpoch: 'b'.repeat(64) };
const desktop = { enabled: true, selected: windowB, bindings: [{ taskId: task.id, generation: task.generation, selection: windowA }] } as AgentDesktopStatus;
const call = (tool: string, args: Record<string, unknown>) => ({ tool, toolCallId: 'call-1', arguments: args });

test('desktop read follows its exact task attachment rather than the last global selection', () => {
  expect(desktopCallAttached(desktop, task, call('desktop/observe', { selection: windowA }))).toBe(true);
  expect(desktopCallAttached(desktop, task, call('desktop/readProperties', { selection: windowA }))).toBe(true);
  expect(desktopCallAttached(desktop, task, call('desktop/observe', { selection: windowB }))).toBe(false);
  expect(desktopCallAttached(desktop, { ...task, generation: 4 }, call('desktop/observe', { selection: windowA }))).toBe(false);
  expect(desktopCallAttached(desktop, task, call('desktop/observe', { selection: { ...windowA, windowEpoch: 'stale' } }))).toBe(false);
  expect(desktopCallAttached({ ...desktop, enabled: false }, task, call('desktop/observe', { selection: windowA }))).toBe(false);
});

test('desktop input does not gain permission from an attachment to a different selected window', () => {
  const input = call('desktop/click', { binding: windowA, x: 20, y: 30 });
  expect(desktopCallAttached(desktop, task, input)).toBe(false);
  expect(desktopCallAttached({ ...desktop, selected: windowA }, task, input)).toBe(true);
  expect(desktopCallAttached(desktop, task, call('desktop/click', { binding: windowB }))).toBe(false);
  expect(desktopCallAttached(desktop, task, call('desktop/unknown', { selection: windowA }))).toBe(false);
});

test('read summary discloses model sharing and a custom namespace cannot inherit builtin guarantees', () => {
  const read = call('browser/observe', { binding: { tabId: 'tab-1' } });
  const known = agentToolsCallSummary(read, choose);
  expect(known.readOnly).toBe(true);
  expect(known.effect).toContain('shared with this task’s model');
  expect(known.targets).toContainEqual({ label: 'Tab', value: 'tab-1' });
  const custom = agentToolsCallSummary(read, choose, true);
  expect(custom.readOnly).toBe(false);
  expect(custom.effect).toContain('read, change or transmit data');
});

test('review values retain exact multiline input and unknown tools keep their effects unspecified', () => {
  const input = 'line 1\nline 2\t  ';
  const original = call('desktop/type', { binding: windowA, text: input });
  const before = JSON.stringify(original);
  expect(agentToolsCallSummary(original, choose).targets).toContainEqual({ label: 'Exact input text', value: input });
  expect(JSON.stringify(original)).toBe(before);
  expect(agentToolsCallSummary(call('custom/read_file', { path: '/example/file' }), choose).readOnly).toBe(false);
});
