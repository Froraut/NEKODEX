import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext } from 'playwright-core';
import { createAgentToolsComposition } from '../src/agent-tools/composition';
import type { SkillScriptExecutorPort } from '../src/agent-tools/skill-script-tools';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const evidence = process.env.NEKODEX_SKILL_SCRIPT_PREVIEW_EVIDENCE;
const scriptPath = 'scripts/example.py';
const script = '# Inert source for human preview only. This fixture must never execute it.\npreview_marker = "REVIEW_ONLY_NO_EXECUTION"\n';
const digest = createHash('sha256').update(script).digest('hex');
const importLabel = 'Import this reviewed immutable version';
const scriptAckLabel = 'I reviewed the exact script source and hashes shown above. This acknowledges import only.';
const workspaceAckLabel = 'I approve this exact directory and access mode for the selected task generation and acknowledge the runner restrictions and write risks.';
const grantLabel = 'Grant this exact workspace access';

test('actual Chrome Python source import with unavailable runtime keeps acknowledgement and workspace grant separate from execution', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-skill-script-preview-')));
  const home = join(root, 'private'), source = join(root, 'source'), workspace = join(root, 'workspace');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(join(source, 'scripts'), { recursive: true }); mkdirSync(workspace);
  const instructions = '---\nname: isolated-script-review\ndescription: Review an explicitly selected inert script fixture as source material.\n---\nInspect the exact selected source. Import grants no execution or workspace authority.\n';
  writeFileSync(join(source, 'SKILL.md'), instructions); writeFileSync(join(source, scriptPath), script);
  let executions = 0, cancellations = 0, executorCloses = 0, pickerCalls = 0, generation = 1;
  const taskId = 'isolated-script-preview-task';
  const scope = () => ({ taskId, generation, toolCallId: 'fixture-ui' });
  const executor: SkillScriptExecutorPort = {
    capabilities: () => ({ supported: true, network: 'deny-all-new-sockets', processExec: 'deny', fixture: true,
      runtimes: { javascript: { supported: true }, python: { supported: false, reason: 'Python is unavailable in this inert preview fixture.' } } }),
    execute: async () => { executions++; throw new Error('No execution is permitted in the preview fixture'); },
    cancel: () => { cancellations++; }, close: () => { executorCloses++; },
  };
  const tools = createAgentToolsComposition({ home, scriptExecutor: executor,
    authorize: request => request.headers.get('authorization') === 'inert-script-preview-fixture',
    isScopeActive: candidate => candidate.taskId === taskId && candidate.generation === generation });
  let context: BrowserContext | undefined, server: ReturnType<typeof Bun.serve> | undefined;
  const requests: any[] = [], reviews: any[] = [], commits: any[] = [], grants: any[] = [], revokes: any[] = [];
  let receipt: Record<string, unknown> | undefined;
  try {
    const grant = tools.addSkillRoot({ root: source, label: 'Temporary inert script source' }, true);
    const sources = tools.discoverSkills(grant.id).skills; expect(sources).toHaveLength(1);
    const build = await Bun.build({ entrypoints: [join(repo, 'tests/fixtures/agent-skill-script-preview-page.tsx')],
      outdir: join(root, 'bundle'), target: 'browser', minify: false, tsconfig: join(repo, 'launcher/tsconfig.json'),
      define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    expect(build.success).toBe(true);
    const bundle = build.outputs.find(output => output.path.endsWith('.js'))!;
    const css = ['tokens.css', 'design/components.css', 'surfaces/agent-tools.css'].map(path => readFileSync(join(repo, 'launcher/src', path), 'utf8')).join('\n');
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/fixture-bootstrap') return Response.json({ sources, status: tools.status() });
      if (path === '/fixture-picker') { pickerCalls++; return Response.json({ cancelled: false, root: workspace }); }
      if (path === '/fixture-scope') { if (request.method === 'POST') generation++; return Response.json(scope()); }
      if (path === '/fixture.js') return new Response(bundle, { headers: { 'content-type': 'text/javascript' } });
      if (path === '/fixture.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
      if (path === '/admin/agent-tools') {
        const input = await request.clone().json(); requests.push(input);
        const response = (await tools.handle(request))!, packet = await response.clone().json();
        if (input.action === 'reviewSkillPackageImport') reviews.push(packet);
        if (input.action === 'commitSkillImport') commits.push(packet);
        if (input.action === 'grantScriptWorkspace') grants.push({ input, packet });
        if (input.action === 'revokeScriptWorkspace') revokes.push({ input, packet });
        return response;
      }
      if (path !== '/') return new Response('Not found', { status: 404 });
      return new Response('<!doctype html><meta charset="utf-8"><title>Isolated script preview</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:24px auto;max-width:960px;padding:0 24px}main{padding-bottom:24px}pre,code{overflow-wrap:anywhere;white-space:pre-wrap}h1{font-size:22px}nav{display:flex;gap:12px;margin-bottom:20px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    } });
    context = await chromium.launchPersistentContext(join(root, 'chrome-profile'), { headless: true,
      executablePath: process.env.CHATGPT_DOM_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', viewport: { width: 1120, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(4000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByText('JavaScript runtime: available', { exact: true }).waitFor();
    expect(await page.getByText('JavaScript runtime: available', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Python runtime: unavailable', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: grantLabel, exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Select workspace directory', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('combobox', { name: 'Discovered local source' }).selectOption(sources[0]!.id);
    await page.getByRole('textbox', { name: 'Supporting files' }).fill(scriptPath);
    await page.getByRole('button', { name: 'Review the source and every selected file', exact: true }).click();
    await page.getByText('Reviewed source; separate run approval required', { exact: true }).waitFor();
    expect(await page.locator('pre').filter({ hasText: 'REVIEW_ONLY_NO_EXECUTION' }).first().textContent()).toBe(script);
    expect(await page.getByText(`SHA-256 ${digest}`, { exact: true }).count()).toBe(1);
    expect(await page.getByText('Runtime: python', { exact: true }).count()).toBe(1);
    expect(reviews).toHaveLength(1); expect(reviews[0].ok).toBe(true);
    expect(reviews[0].value.action.manifest.package).toMatchObject({ version: 4, kind: 'selected-local-polyglot-package' });
    expect(reviews[0].value.resources).toEqual([{ kind: 'script', relativePath: scriptPath, mediaType: 'text/x-python', runtime: 'python', content: script, digest,
      bytes: Buffer.byteLength(script), role: 'selected-skill-source-material' }]);
    expect(await page.getByRole('button', { name: importLabel, exact: true }).isDisabled()).toBe(true);
    const scriptAck = page.getByRole('checkbox', { name: scriptAckLabel, exact: true });
    await scriptAck.waitFor(); await page.waitForFunction(label => {
      const input = [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(input => input.closest('label')?.textContent?.includes(label));
      return input && !input.disabled;
    }, scriptAckLabel);
    expect(await scriptAck.isChecked()).toBe(false); expect(executions).toBe(0); expect(commits).toHaveLength(0);
    await scriptAck.check(); expect(await page.getByRole('button', { name: importLabel, exact: true }).isEnabled()).toBe(true);
    await page.getByRole('button', { name: importLabel, exact: true }).click();
    await page.getByText('Version imported. It is not attached automatically; select its task action below.', { exact: true }).waitFor();
    expect(commits).toHaveLength(1); expect(commits[0].ok).toBe(true);
    const imported = commits[0].value;
    expect(imported).toMatchObject({ state: 'imported', versionId: reviews[0].value.action.versionId });
    expect(readFileSync(join(imported.target, 'resources', scriptPath), 'utf8')).toBe(script);
    expect(tools.status().managedSkills.attachments).toEqual([]); expect(tools.scriptStatus().grants).toEqual([]); expect(executions).toBe(0);
    expect(await page.getByRole('button', { name: 'Attach this exact version', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Select fixture task', exact: true }).click();
    await page.getByText(`${taskId} · gen 1`, { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: grantLabel, exact: true }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Select workspace directory', exact: true }).click();
    await page.getByText(workspace, { exact: true }).waitFor();
    expect(pickerCalls).toBe(1); expect(tools.scriptStatus().grants).toEqual([]);
    const workspaceAck = page.getByRole('checkbox', { name: workspaceAckLabel, exact: true });
    expect(await workspaceAck.isChecked()).toBe(false); expect(await page.getByRole('button', { name: grantLabel, exact: true }).isDisabled()).toBe(true);
    await workspaceAck.check(); expect(await page.getByRole('button', { name: grantLabel, exact: true }).isEnabled()).toBe(true);
    await page.getByRole('combobox', { name: 'Workspace access', exact: true }).selectOption('read-write');
    expect(await workspaceAck.isChecked()).toBe(false); expect(await page.getByRole('button', { name: grantLabel, exact: true }).isDisabled()).toBe(true);
    await page.getByRole('combobox', { name: 'Workspace access', exact: true }).selectOption('read-only');
    expect(await workspaceAck.isChecked()).toBe(false);
    await workspaceAck.check();
    await page.getByRole('button', { name: 'Advance fixture task generation', exact: true }).click();
    await page.getByText(`${taskId} · gen 2`, { exact: true }).waitFor();
    expect(await workspaceAck.isChecked()).toBe(false); expect(await page.getByRole('button', { name: grantLabel, exact: true }).isDisabled()).toBe(true);
    expect(grants).toHaveLength(0); expect(tools.scriptStatus().grants).toEqual([]);
    await page.getByRole('button', { name: 'Attach this exact version', exact: true }).click();
    await page.getByText('Attached to this generation', { exact: true }).waitFor();
    expect(tools.status().managedSkills.attachments).toMatchObject([{ scope: scope(), versionIds: [imported.versionId] }]);
    expect(executions).toBe(0); expect(tools.scriptStatus().grants).toEqual([]);
    await workspaceAck.check(); await page.getByRole('button', { name: grantLabel, exact: true }).click();
    await page.getByRole('button', { name: 'Revoke this workspace grant', exact: true }).waitFor();
    expect(grants).toHaveLength(1); expect(grants[0].packet.ok).toBe(true);
    expect(grants[0].input).toEqual({ action: 'grantScriptWorkspace', scope: scope(), root: workspace, access: 'read-only', acknowledgeRestrictions: true, explicitUserAction: true });
    const workspaceGrant = grants[0].packet.value;
    expect(tools.scriptStatus().grants).toEqual([workspaceGrant]);
    expect(workspaceGrant).toMatchObject({ taskId, generation: 2, root: workspace, access: 'read-only' });
    expect(await workspaceAck.isChecked()).toBe(false); expect(executions).toBe(0);
    if (evidence) { mkdirSync(dirname(evidence), { recursive: true }); await page.screenshot({ path: evidence, fullPage: true }); }
    await page.getByRole('button', { name: 'Revoke this workspace grant', exact: true }).click();
    await page.getByText('No workspace grants for this task generation.', { exact: true }).waitFor();
    expect(revokes).toHaveLength(1); expect(revokes[0].packet.ok).toBe(true); expect(tools.scriptStatus().grants).toEqual([]);
    expect(tools.scriptStatus().activeOperations).toEqual([]);
    expect(requests.filter(row => row.action === 'attachManagedSkill')).toHaveLength(1);
    expect(requests.some(row => ['approveInvoke', 'discover', 'reviewServer', 'saveServer', 'setEnabled'].includes(row.action))).toBe(false);
    expect(executions).toBe(0); expect(cancellations).toBe(0); expect(errors).toEqual([]);
    expect(await page.getByRole('alert').count()).toBe(0);
    receipt = { browser: context.browser()?.version(), components: ['AgentManagedSkills', 'AgentSkillScripts'],
      imported: { versionId: imported.versionId, packageVersion: 4, runtime: 'python', pythonRuntimeAvailable: false, scriptSha256: digest, scriptBytes: Buffer.byteLength(script), exactRetainedSource: true, attachedAutomatically: false, explicitAttachmentGeneration: 2 },
      workspace: { pickerCalls, pickerAloneGrantedAuthority: false, accessChangeClearedAcknowledgement: true, generationChangeClearedAcknowledgement: true,
        grant: workspaceGrant, revoked: true, finalGrants: 0 },
      operations: { reviews: reviews.length, imports: commits.length, grants: grants.length, revokes: revokes.length, executions, cancellations, modelRuntimeCreated: false }, errors };
  } finally {
    try { await context?.close(); } finally { await server?.stop(true); await tools.close(); rmSync(root, { recursive: true, force: true }); }
  }
  expect(existsSync(root)).toBe(false); expect(executorCloses).toBe(1);
  if (evidence && receipt) writeFileSync(evidence.replace(/\.png$/, '.json'), JSON.stringify({ ...receipt,
    cleanup: { browserClosed: true, serverStopped: true, temporaryRootRemoved: true, executorCloses },
    scope: 'headless Chrome DOM with actual components and local composition; inert executor, no Electron, SSH, model, account or release' }, null, 2) + '\n');
}, 20_000);
