import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

test('actual Chrome remote Git review preserves stale drafts and reconciles one exact mutation before reviewed unstage/commit', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/remote-git-review-page.tsx', import.meta.url).pathname], target: 'browser', minify: true,
    tsconfig: new URL('../launcher/tsconfig.json', import.meta.url).pathname, define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{ name: 'isolated-launcher-dependencies', setup(build) {
      build.onResolve({ filter: /^(react(?:-dom)?(?:\/.*)?|scheduler)$/ }, args => ({ path: Bun.resolveSync(args.path, new URL('../launcher/', import.meta.url).pathname) }));
    } }],
  });
  expect(build.success).toBe(true);
  const bundle = build.outputs.find(row => row.path.endsWith('.js'))!;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => new URL(request.url).pathname === '/fixture.js'
    ? new Response(bundle, { headers: { 'content-type': 'text/javascript' } })
    : new Response('<div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } }) });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHATGPT_DOM_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage(); page.setDefaultTimeout(3000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.port}/`);
    const refresh = page.getByRole('button', { name: 'Refresh Git review', exact: true });
    expect(await refresh.isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).fixture.requests)).toEqual([]);
    await page.evaluate(() => (window as any).fixture.enable()); await refresh.click();
    await page.getByRole('button', { name: 'Read ours', exact: true }).click();
    await page.getByText('stage 2: original conflict source', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open in file editor', exact: true }).first().click();
    expect(await page.evaluate(() => (window as any).fixture.opened)).toEqual(['conflict.txt']);
    await page.evaluate(() => { (window as any).fixture.resolved = true; }); await refresh.click();
    const message = page.getByRole('textbox', { name: 'Commit message', exact: true });
    await message.fill('Retained deliberate commit message');
    await page.getByRole('textbox', { name: 'Author name', exact: true }).fill('QA Agent');
    await page.getByRole('textbox', { name: 'Author email', exact: true }).fill('qa@example.invalid');
    await page.getByRole('button', { name: 'Read full diff', exact: true }).click();
    await page.getByText('RETAINED_DIFF', { exact: false }).waitFor();
    await page.evaluate(() => { (window as any).fixture.staleDiff = true; });
    await page.getByRole('button', { name: 'Read full diff', exact: true }).click();
    await page.getByText('External index changed; prior capture is stale.', { exact: true }).waitFor();
    expect(await message.inputValue()).toBe('Retained deliberate commit message');
    expect(await page.getByText('RETAINED_DIFF', { exact: false }).count()).toBe(1);
    await page.evaluate(() => { (window as any).fixture.staleDiff = false; }); await refresh.click();
    const selected = page.getByRole('checkbox', { name: 'conflict.txt', exact: true });
    await selected.check(); await page.getByRole('button', { name: 'Review stage selected', exact: true }).click();
    const ack = page.getByRole('checkbox', { name: 'I reviewed this exact target and candidate. Apply only this action.', exact: true });
    const apply = page.getByRole('button', { name: 'Apply reviewed action', exact: true });
    expect(await apply.isDisabled()).toBe(true); await ack.check(); await apply.click();
    await page.getByText('Lost observation; original action retained.', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Review stage selected', exact: true }).isDisabled()).toBe(true);
    await refresh.click(); await page.getByRole('heading', { name: 'Reviewed action: stage · unknown', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).fixture.applies.length)).toBe(1);
    await page.getByText('Retained Git actions', { exact: true }).click();
    expect(await page.getByRole('button', { name: 'Remove from local history', exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).fixture.requests.filter((row: any) => row.action === 'prune').length)).toBe(0);
    await page.evaluate(() => { (window as any).fixture.settleHeld = true; }); await refresh.click();
    await page.getByRole('heading', { name: 'Reviewed action: stage · completed', exact: true }).waitFor();
    expect(await message.inputValue()).toBe('Retained deliberate commit message');
    await refresh.click(); await selected.check();
    await page.getByRole('button', { name: 'Review unstage selected', exact: true }).click(); await ack.check(); await apply.click();
    await page.getByRole('heading', { name: 'Reviewed action: unstage · completed', exact: true }).waitFor();
    await refresh.click(); await page.getByRole('button', { name: 'Review staged commit', exact: true }).click();
    await page.getByRole('heading', { name: 'Reviewed action: commit · reviewed', exact: true }).waitFor();
    const prepared = await page.evaluate(() => (window as any).fixture.requests.filter((row: any) => row.action === 'prepare'));
    expect(prepared.map((row: any) => row.input.operation)).toEqual(['stage', 'unstage', 'commit']);
    expect(prepared[2].input.paths).toBeUndefined(); expect(prepared[2].input.message).toBe('Retained deliberate commit message');
    expect(prepared[2].input.author).toEqual({ name: 'QA Agent', email: 'qa@example.invalid' });
    expect(await page.locator('.nk-remote-git__review li').allTextContents()).toEqual(['already-staged.txt']);
    expect(await page.getByText('Complete staged index: 2', { exact: true }).count()).toBe(1);
    await page.getByText('Inspect every staged index entry', { exact: true }).click();
    expect(await page.getByRole('row', { name: 'unchanged-in-tree.txt 100755 ' + '7'.repeat(40) + ' 0', exact: true }).isVisible()).toBe(true);
    await ack.check(); await apply.click(); await page.getByText('Created commit:', { exact: false }).waitFor();
    expect(await page.evaluate(() => (window as any).fixture.applies.length)).toBe(3);
    const remove = page.getByRole('button', { name: 'Remove from local history', exact: true });
    await remove.last().click();
    expect(await page.getByRole('dialog').getByText('This removes only the selected local review and action record.', { exact: false }).count()).toBe(1);
    await page.getByRole('button', { name: 'Remove only this local record', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.requests.filter((row: any) => row.action === 'prune').length === 1);
    expect(await page.evaluate(() => (window as any).fixture.requests.filter((row: any) => row.action === 'prune')[0].actionIds.length)).toBe(1);
    expect(await message.inputValue()).toBe('Retained deliberate commit message');
    await refresh.click();
    await page.evaluate(() => { (window as any).fixture.holdDiff = true; });
    await page.getByRole('button', { name: 'Read full diff', exact: true }).click();
    await page.waitForFunction(() => (window as any).fixture.diffPending);
    await page.evaluate(() => { (window as any).fixture.changeRoot(); });
    await page.getByText('/new-scope', { exact: true }).waitFor();
    await page.evaluate(() => { (window as any).fixture.release(); });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Refresh Git review' && !button.disabled && button.getAttribute('aria-disabled') !== 'true'));
    expect(await page.getByText('LATE_FOREIGN_SCOPE', { exact: true }).count()).toBe(0);
    expect(await message.inputValue()).toBe('Retained deliberate commit message');
    expect(errors).toEqual([]);
    await page.evaluate(() => { (window as any).fixture.russian(); });
    await page.getByRole('button', { name: 'Обновить Git Review', exact: true }).waitFor();
    expect(await page.getByText('Просмотр использует отдельные настройки Git: глобальная и системная конфигурация и файлы атрибутов не учитываются. Результат может отличаться от Git в обычном терминале.', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('global_and_system_git_configuration_and_attributes_disabled', { exact: false }).count()).toBe(0);
    if (process.env.NEKODEX_REMOTE_GIT_UI_EVIDENCE) { mkdirSync(dirname(process.env.NEKODEX_REMOTE_GIT_UI_EVIDENCE), { recursive: true }); await page.screenshot({ path: process.env.NEKODEX_REMOTE_GIT_UI_EVIDENCE, fullPage: true }); }
  } finally { await browser?.close(); server.stop(true); }
}, 20000);
