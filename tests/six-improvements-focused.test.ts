import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeNativeDelegation } from '../src/adapters/chatgpt-web/native-delegation';
import { verifyNativeDelegation } from '../src/adapters/chatgpt-web/codex-rollout-environment';
import { extractChatGptTurnUserRevision } from '../src/adapters/chatgpt-web/environment';
import { parseRequest } from '../src/responses/parser';
import { requestRetainedCompactionHandoff } from '../src/adapters/chatgpt-web/compaction-handoff';
import { chatGptStoppedThinkingError } from '../src/adapters/chatgpt-web/adapter-error';

test('native cross-task delivery requires an exact current journal record', () => {
  const home = mkdtempSync(join(tmpdir(), 'cgw-native-delivery-'));
  const thread = '01a0a065-17f9-75f0-9920-812190ad0995';
  const turn = '01a0a0f8-f9d2-7dd0-aea7-bd081892666e';
  const dir = join(home, 'sessions/2026/09/14'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-2026-09-14T17-49-34-${thread}.jsonl`);
  const delivery = { type: 'function_call_output', id: 'fco_native', name: 'send_message_to_thread',
    namespace: 'codex_app', output: '<codex_delegation>\n<source_thread_id>01a0a0bb-692d-7093-a809-688614a4d62a</source_thread_id>\n<input>Review the saved result.</input>\n</codex_delegation>',
    internal_chat_message_metadata_passthrough: { turn_id: turn } };
  const db = new Database(join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT, rollout_path TEXT, agent_path TEXT); CREATE TABLE thread_spawn_edges(child_thread_id TEXT,parent_thread_id TEXT,status TEXT)');
  db.query('INSERT INTO threads VALUES(?,?,NULL)').run(thread, file); db.close();
  writeFileSync(file, [
    { type: 'session_meta', payload: { id: thread, source: 'vscode' } },
    { type: 'turn_context', payload: { turn_id: turn } },
    { type: 'response_item', payload: delivery },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  try {
    const body = { model: 'chatgpt-web/light', input: [delivery],
      client_metadata: { 'x-codex-turn-metadata': JSON.stringify({ thread_id: thread, turn_id: turn }) } };
    const normalized = normalizeNativeDelegation(parseRequest(body), verifyNativeDelegation, home);
    expect(normalized).toBeDefined();
    expect(extractChatGptTurnUserRevision(parseRequest(normalized))).toEqual([{ type: 'input_text', text: 'Review the saved result.' }]);
    expect(() => normalizeNativeDelegation(parseRequest({ ...body,
      input: [{ ...delivery, output: delivery.output.replace('saved result', 'private credentials') }] }), verifyNativeDelegation, home)).toThrow('native current-turn');
    expect(normalizeNativeDelegation(parseRequest({ ...body, input: [{ ...delivery,
      internal_chat_message_metadata_passthrough: { turn_id: thread } }] }), verifyNativeDelegation, home)).toBeUndefined();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('compaction viewport failure is recoverable only before send activation', async () => {
  const failure = 'ChatGPT browser surface did not expose an operational viewport: timeout';
  let activated = false;
  const worker = { run: async (turn: any) => {
    if (activated) await turn.onSendActivated();
    throw new Error(failure);
  } };
  const broker = { beginCompactionTransaction: async () => ({ token: 'control_test', handoffId: 'handoff_test' }),
    waitForCompactionHandoff: () => new Promise<string>(() => {}), abortCompactionTransaction() {} };
  const parsed: any = { modelId: 'chatgpt-web/light', options: { reasoning: 'low' } };
  const call = () => requestRetainedCompactionHandoff(worker as never, parsed,
    { conversationKey: () => 'owned-conversation' } as never, broker as never,
    { localToolsEnabled: true, solAvailable: true, proAvailable: true }, 'trace_test', undefined, 1000);
  try { await call(); throw new Error('Expected failure'); } catch (e: any) {
    expect(e.code).toBe('compaction_source_unavailable');
  }
  activated = true;
  try { await call(); throw new Error('Expected failure'); } catch (e: any) {
    expect(e.message).toBe(failure); expect(e.code).toBeUndefined();
  }
});

test('stopped-thinking diagnostics report observed progress without permitting replay', () => {
  const error = chatGptStoppedThinkingError({ responsePresent: true, finalTextChars: 0,
    activeToolCalls: 1, toolResultObserved: true, lastProgressAgeMs: 2500 });
  expect(error.retryable).toBe(false);
  expect(error.message).toContain('1 tool calls in flight');
  expect(error.message).toContain('tool results observed');
  expect(error.message).toContain('does not identify the cause');
});
