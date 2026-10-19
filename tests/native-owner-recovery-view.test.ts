import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

test('rendered recovery requires the current preview and reconciles held receipts without replay', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/native-owner-recovery-page.tsx', import.meta.url).pathname], target: 'browser', minify: true,
    tsconfig: new URL('../launcher/tsconfig.json', import.meta.url).pathname,
    define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    plugins: [{ name: 'isolated-launcher-dependencies', setup(build) {
      build.onResolve({ filter: /^(react(?:-dom)?(?:\/.*)?|scheduler)$/ }, args => ({ path: Bun.resolveSync(args.path, new URL('../launcher/', import.meta.url).pathname) }));
    } }],
  });
  expect(build.success).toBe(true);
  const script = build.outputs.find(output => output.path.endsWith('.js'))!;
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
    const preview = page.getByRole('button', { name: 'Preview owner recovery', exact: true });
    const refresh = page.getByRole('button', { name: 'Refresh status', exact: true });
    const recover = page.getByRole('button', { name: 'Recover reviewed owner', exact: true });
    const ack = page.getByRole('checkbox');
    await preview.click(); expect(await recover.isDisabled()).toBe(true);
    await ack.check(); expect(await recover.isEnabled()).toBe(true);
    // A passive status with no preview and the same plan with a new observation time preserve consent.
    await refresh.click(); expect(await ack.isChecked()).toBe(true);
    await page.evaluate(() => { (window as any).fixture.observedAt++; });
    await preview.click(); expect(await ack.isChecked()).toBe(true);
    // A materially different digest always needs a fresh acknowledgement.
    await page.evaluate(() => { (window as any).fixture.plan = 'b'; });
    await preview.click(); expect(await ack.isChecked()).toBe(false); expect(await recover.isDisabled()).toBe(true);
    await ack.check(); await recover.click();
    await page.getByText('Recovery receipt: prepared', { exact: false }).waitFor();
    expect(await recover.isDisabled()).toBe(true); expect(await preview.isDisabled()).toBe(true);
    await page.evaluate(() => { (window as any).fixture.phase = 'unknown'; });
    await refresh.click(); await page.getByText('Recovery receipt: unknown', { exact: false }).waitFor();
    expect(await preview.isDisabled()).toBe(true);
    await page.evaluate(() => { (window as any).fixture.phase = 'completed'; });
    await refresh.click(); await page.getByText('Recovery receipt: completed', { exact: false }).waitFor();
    expect(await ack.count()).toBe(0); expect(await preview.isEnabled()).toBe(true);
    expect(await page.getByText('Prior unsettled actions: 2. Their results have not been recovered and no actions have been replayed.', { exact: true }).count()).toBe(1);
    await page.evaluate(() => { (window as any).fixture.blocked = true; });
    await preview.click(); await page.getByText('Recovery blocked.', { exact: false }).waitFor();
    expect(await recover.count()).toBe(0); expect(await ack.count()).toBe(0);
    const observed = await page.evaluate(() => (window as any).fixture);
    expect(observed.recoveries).toBe(1);
    const mutation = observed.requests.find((body: any) => body.action === 'recover-owner');
    expect(mutation.reviewDigest).toBe('b'.repeat(64));
    expect(mutation.actionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(observed.requests.filter((body: any) => body.action === 'status' && body.actionId).map((body: any) => body.actionId)).toEqual([mutation.actionId, mutation.actionId]);
    expect(observed.requests.filter((body: any) => body.action === 'preview-owner-recovery').every((body: any) => body.actionId === undefined)).toBe(true);
    expect(observed.requests.every((body: any) => ['status', 'preview-owner-recovery', 'recover-owner'].includes(body.action))).toBe(true);
    expect(errors).toEqual([]);
    if (process.env.NEKODEX_UI_EVIDENCE) {
      mkdirSync(dirname(process.env.NEKODEX_UI_EVIDENCE), { recursive: true });
      await page.screenshot({ path: process.env.NEKODEX_UI_EVIDENCE, fullPage: true });
    }
  } finally { await browser?.close(); server.stop(true); }
}, 15000);
