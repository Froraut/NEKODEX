import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('actual Chrome environment preparation and task attachment require separate current consent, preserve lost identity and revoke through a locked parent', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/python-environment-page.tsx', import.meta.url).pathname], target: 'browser', minify: true,
    tsconfig: new URL('../launcher/tsconfig.json', import.meta.url).pathname, define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{ name: 'isolated-launcher-dependencies', setup(build) { build.onResolve({ filter: /^(react(?:-dom)?(?:\/.*)?|scheduler)$/ }, args => ({ path: Bun.resolveSync(args.path, new URL('../launcher/', import.meta.url).pathname) })); } }],
  });
  expect(build.success).toBe(true);
  const script = build.outputs.find(row => row.path.endsWith('.js'))!;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => new URL(request.url).pathname === '/fixture.js'
    ? new Response(script, { headers: { 'content-type': 'text/javascript' } })
    : new Response('<div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } }) });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHATGPT_DOM_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage(); page.setDefaultTimeout(3000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.port}/`);
    expect(await page.evaluate(() => (window as any).fixture.requests)).toEqual([]);
    await page.getByText('Retained environment actions', { exact: true }).click();
    expect(await page.getByText('11111111-1111-4111-8111-111111111111', { exact: true }).isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Select wheel files', exact: true }).click();
    await page.getByRole('button', { name: 'Review selected dependency set', exact: true }).click();
    await page.getByText('first-dependency 1.0', { exact: true }).waitFor();
    expect(await page.getByText('d'.repeat(64), { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('second-dependency 2.0', { exact: true }).isVisible()).toBe(true);
    const prepare = page.getByRole('button', { name: 'Prepare reviewed environment', exact: true });
    const prepareAck = page.getByRole('checkbox', { name: 'I reviewed this complete package set and exact hashes. Prepare only this local environment; do not run code or grant task access.', exact: true });
    expect(await prepare.isDisabled()).toBe(true); await prepareAck.check(); await prepare.click();
    const receipt = page.getByRole('button', { name: 'Read this exact receipt', exact: true }); await receipt.waitFor();
    expect(await page.evaluate(() => (window as any).fixture.requests.filter((row: any) => row.action === 'preparePythonEnvironment').length)).toBe(1);
    await receipt.click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent === 'Read this exact receipt'));
    const calls = await page.evaluate(() => (window as any).fixture.requests);
    const review = calls.find((row: any) => row.action === 'reviewPythonEnvironment'), sent = calls.find((row: any) => row.action === 'preparePythonEnvironment');
    expect(review.actionId).toMatch(/^[a-f0-9-]{36}$/); expect(sent.actionId).toBe(review.actionId); expect(sent.reviewDigest).toBe('8'.repeat(64));
    expect(calls.find((row: any) => row.action === 'pythonEnvironmentAction').actionId).toBe(review.actionId);
    expect(review.wheelPaths).toHaveLength(2);
    await page.getByRole('combobox', { name: 'Prepared environment for task attachment', exact: true }).selectOption('a'.repeat(64));
    const bindAck = page.getByRole('checkbox', { name: 'Attach this exact environment only to the selected task generation. Workspace access and approval of every script call remain separate.', exact: true });
    const bind = page.getByRole('button', { name: 'Attach environment to this task generation', exact: true });
    await bindAck.check(); expect(await bind.isEnabled()).toBe(true);
    await page.evaluate(() => (window as any).fixture.nextGeneration());
    await page.waitForFunction(() => { const input = [...document.querySelectorAll('input[type=checkbox]')].find(input => input.parentElement?.textContent?.includes('Attach this exact environment')); return input && !(input as HTMLInputElement).checked; });
    expect(await bind.isDisabled()).toBe(true); await bindAck.check(); await bind.click();
    const revoke = page.getByRole('button', { name: 'Revoke environment attachment', exact: true }); await revoke.waitFor();
    const bound = await page.evaluate(() => (window as any).fixture.requests.find((row: any) => row.action === 'bindPythonEnvironment'));
    expect(bound.scope).toEqual({ taskId: 'fixture-task', generation: 2, toolCallId: 'fixture-selection' }); expect(bound.environmentId).toBe('a'.repeat(64));
    await page.evaluate(() => (window as any).fixture.lockParent());
    await page.waitForFunction(() => (window as any).fixture.locked);
    expect(await revoke.isEnabled()).toBe(true); await revoke.click();
    await page.waitForFunction(() => (window as any).fixture.requests.some((row: any) => row.action === 'revokePythonEnvironment'));
    const final = await page.evaluate(() => (window as any).fixture);
    expect(final.blockedParentActs).toBe(0);
    expect(final.requests.filter((row: any) => row.action === 'preparePythonEnvironment')).toHaveLength(1);
    expect(final.requests.filter((row: any) => row.action === 'revokePythonEnvironment')).toHaveLength(1);
    expect(final.requests.every((row: any) => ['reviewPythonEnvironment', 'preparePythonEnvironment', 'pythonEnvironmentAction', 'bindPythonEnvironment', 'revokePythonEnvironment'].includes(row.action))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); server.stop(true); }
}, 15000);
