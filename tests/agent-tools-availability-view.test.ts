import { expect, test } from 'bun:test';
import { createElement } from '../launcher/node_modules/react';
import { renderToStaticMarkup } from '../launcher/node_modules/react-dom/server';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolAvailability } from '../launcher/src/AgentToolAvailability';
import { StandaloneMcpHost } from '../src/agent-tools/mcp-host';
import { defaultToolsConfig } from '../src/agent-tools/config';
import type { StandaloneBuiltinToolsProvider } from '../src/agent-tools/types';

test('valid tools needing attachment are distinguished from rejected schemas and stay unauthorized', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-availability-')));
  const reason = 'No window is attached to this task generation.';
  const provider: StandaloneBuiltinToolsProvider = {
    serverId: 'desktop',
    async discover() { return [
      { id: 'desktop/observe', serverId: 'desktop', name: 'observe', supported: false, description: 'Capture the selected window.', unsupportedReason: reason, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { id: 'desktop/invalid', serverId: 'desktop', name: 'invalid', supported: true, inputSchema: { type: 'not-a-json-schema-type' } },
    ]; },
    async execute() { throw new Error('Unattached tools must never execute'); },
  };
  const host = new StandaloneMcpHost({ config: defaultToolsConfig(), journalPath: join(home, 'tools.sqlite'), builtins: [provider], isScopeActive: () => true });
  const scope = { taskId: 'task', generation: 1, toolCallId: 'call' };
  try {
    const [unattached, invalid] = await host.discover(scope);
    expect(unattached.schemaSupported).toBe(true);
    expect(invalid.schemaSupported).toBe(false);
    const html = renderToStaticMarkup(createElement(AgentToolAvailability, { tool: unattached, language: 'en' }));
    expect(html).toContain('Unavailable for this task');
    expect(html).toContain(reason);
    expect(html).toContain('Capture the selected window.');
    expect(html).not.toContain('Unsupported schema');
    expect(renderToStaticMarkup(createElement(AgentToolAvailability, { tool: invalid, language: 'en' }))).toContain('Unsupported schema');
    expect(() => host.authorize({ scope, tool: unattached.id, arguments: {} })).toThrow('unsupported');
    expect(() => host.authorize({ scope, tool: invalid.id, arguments: {} })).toThrow('unsupported');
  } finally { await host.close(); rmSync(home, { recursive: true, force: true }); }
});
