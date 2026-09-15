import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { normalizeNativeDelegation } from '../src/adapters/chatgpt-web/native-delegation';
import { verifyNativeDelegation } from '../src/adapters/chatgpt-web/codex-rollout-environment';
import { extractChatGptTurnUserRevision } from '../src/adapters/chatgpt-web/environment';
import { parseRequest } from '../src/responses/parser';
import { stabilizeEffortSlider } from '../src/adapters/chatgpt-web/effort-stabilization';
const { RuntimeSupervisor } = require('../launcher/electron/runtime-supervisor.cjs');

test('V1 follow-up preserves parent semantics and rejects a substituted tool call', () => {
  const home = mkdtempSync(join(tmpdir(), 'cgw-v1-'));
  const thread = '01a0a065-17f9-75f0-9920-812190ad0995';
  const parent = '01a0a0bb-692d-7093-a809-688614a4d62a';
  const turn = '01a0a0f8-f9d2-7dd0-aea7-bd081892666e';
  const dir = join(home, 'sessions/2026/09/14'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-2026-09-14T17-49-34-${thread}.jsonl`);
  const delivery = { type: 'function_call_output', id: 'fco_native', call_id: 'call_native',
    name: 'send_message_to_thread', namespace: 'codex_app',
    output: `<codex_delegation><source_thread_id>${parent}</source_thread_id><input>Review A &amp; B.</input></codex_delegation>`,
    internal_chat_message_metadata_passthrough: { turn_id: turn } };
  const db = new Database(join(home, 'state_5.sqlite'));
  db.exec('CREATE TABLE threads(id TEXT, rollout_path TEXT, agent_path TEXT); CREATE TABLE thread_spawn_edges(child_thread_id TEXT,parent_thread_id TEXT,status TEXT)');
  db.query('INSERT INTO threads VALUES(?,?,NULL)').run(thread, file);
  db.query("INSERT INTO thread_spawn_edges VALUES(?,?,'open')").run(thread, parent); db.close();
  writeFileSync(file, [
    { type: 'session_meta', payload: { id: thread, parent_thread_id: parent, thread_source: 'subagent',
      source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } },
    { type: 'turn_context', payload: { turn_id: turn } },
    { type: 'response_item', payload: delivery },
  ].map(x => JSON.stringify(x)).join('\n') + '\n');
  try {
    const body = { model: 'chatgpt-web/light', input: [delivery], client_metadata: {
      'x-codex-turn-metadata': JSON.stringify({ request_kind: 'turn', thread_id: thread, turn_id: turn,
        parent_thread_id: parent, agent_name: '/root', subagent_kind: 'thread_spawn', sandbox: 'none', workspaces: { [home]: {} } }) } };
    const normalized = normalizeNativeDelegation(parseRequest(body), verifyNativeDelegation, home);
    const parsed = parseRequest(normalized);
    expect(parsed.context.messages.at(-1)?.role).toBe('agentMessage');
    expect(extractChatGptTurnUserRevision(parsed)).toEqual([{ type: 'input_text', text: 'Review A & B.' }]);
    expect(() => normalizeNativeDelegation(parseRequest({ ...body,
      input: [{ ...delivery, call_id: 'call_spoofed' }] }), verifyNativeDelegation, home)).toThrow('native current-turn');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('ambiguous tunnel connect still fails closed when MCP is unhealthy', async () => {
  const supervisor = Object.create(RuntimeSupervisor.prototype);
  let readiness = 0;
  let stopped = 0;
  let monitored = false;
  Object.assign(supervisor, {
    assertTunnelClientReady() {}, waitForKnownTunnelStatus: async () => ({ ready: false }),
    runTunnelStopCommand: async () => { stopped++; return { code: 0 }; },
    waitForTunnelStopped: async () => {},
    runTunnelConnectCommand: async () => ({ code: 1, stdout: JSON.stringify({
      runtime_state: 'ready', process_running: true, ready: true, healthy: true }) }),
    waitForTunnel: async () => { readiness++; supervisor.tunnel = { pid: 999999 }; },
    waitForTunnelMcpTransport: async () => { throw new Error('MCP unavailable'); },
    startTunnelMonitor() { monitored = true; }, stopTunnelMonitor() {},
  });
  await expect(supervisor.startTunnel({ mode: 'full' })).rejects.toThrow('MCP unavailable');
  expect(readiness).toBe(1);
  expect(stopped).toBe(2);
  expect(monitored).toBe(false);
  expect(supervisor.tunnel).toBeNull();
});

test('effort selector recovers from a DOM slider jump and waits for stability', async () => {
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(`<div role="menuitem" tabindex="0"><div role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0"></div></div>`);
    await page.locator('[role=menuitem]').evaluate(element => {
      let first = true;
      element.addEventListener('keydown', event => {
        const slider = element.firstElementChild!;
        const value = first ? 4 : Number(slider.getAttribute('aria-valuenow')) + ((event as KeyboardEvent).key === 'ArrowRight' ? 1 : -1);
        first = false;
        slider.setAttribute('aria-valuenow', String(value));
      });
    });
    const start = Date.now();
    await stabilizeEffortSlider({ target: 2,
      read: async options => ({ min: 0, max: 4, value: Number(await page.locator('[role=slider]').getAttribute('aria-valuenow', options)) }),
      press: (key, options) => page.locator('[role=menuitem]').press(key, options),
    });
    expect(await page.locator('[role=slider]').getAttribute('aria-valuenow')).toBe('2');
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
  } finally { await browser.close(); }
});
