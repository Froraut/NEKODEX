import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('saved unknown export reconciles its historical exact request under UI lock and discards late task results', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/vm-export-reconcile-page.tsx', import.meta.url).pathname], target: 'browser', minify: true });
  expect(build.success).toBe(true);
  const script = build.outputs.find(output => output.path.endsWith('.js'))!;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => new URL(request.url).pathname === '/fixture.js'
    ? new Response(script, { headers: { 'content-type': 'text/javascript' } })
    : new Response('<div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } }) });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(2000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByRole('button', { name: 'Refresh destinations and saved exports', exact: true }).click();
    await page.getByText('Saved export reviews and receipts', { exact: true }).click();
    const inspect = page.getByRole('button', { name: 'Inspect exact saved export outcome', exact: true });
    await expect(inspect.count()).resolves.toBe(1);
    await inspect.click();
    await page.getByText('completed', { exact: true }).waitFor();
    expect(await inspect.count()).toBe(0);
    await page.evaluate(() => { (window as any).fixture.settled = false; });
    await page.getByRole('button', { name: 'Refresh destinations and saved exports', exact: true }).click();
    await inspect.waitFor();
    await page.evaluate(() => { const state = (window as any).fixture; state.hold = true; state.lock(); });
    await inspect.click();
    await page.waitForFunction(() => (window as any).fixture.requests.filter((row: any) => row.action === 'reconcileVmExport').length === 2);
    expect(await inspect.isDisabled()).toBe(true);
    expect(await page.evaluate(() => {
      const state = (window as any).fixture;
      return state.requests.find((row: any) => row.action === 'reconcileVmExport');
    })).toEqual({ action: 'reconcileVmExport', request: await page.evaluate(() => (window as any).fixture.request), explicitUserAction: true });
    await page.evaluate(() => (window as any).fixture.switchTask());
    await page.waitForFunction(() => !document.body.textContent?.includes('Saved export reviews and receipts'));
    await page.evaluate(() => (window as any).fixture.release());
    await page.waitForFunction(() => (window as any).fixture.requests.filter((row: any) => row.action === 'vmExportStatus').length === 4);
    await page.getByRole('button', { name: 'Refresh destinations and saved exports', exact: true }).waitFor();
    expect(await page.getByText('Saved export reviews and receipts', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => (window as any).fixture.requests.filter((row: any) => !['vmExportWorkspaces', 'vmExportStatus', 'reconcileVmExport'].includes(row.action)))).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); server.stop(true); }
}, 15000);
