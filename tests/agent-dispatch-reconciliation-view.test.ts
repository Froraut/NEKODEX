import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// CI installs Playwright's headless shell; local macOS runs use the installed Chrome.
const executablePath = process.env.CHATGPT_DOM_TEST_BROWSER || (existsSync(chrome) ? chrome : undefined);

test('the unknown-send dialog says nothing is resent, needs acknowledgement and offers delivery only with an acceptance receipt', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/agent-dispatch-reconciliation-page.tsx', import.meta.url).pathname], target: 'browser', minify: true,
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
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage(); page.setDefaultTimeout(3000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
    const fixture = () => page.evaluate(() => (window as any).fixture);
    const dialog = page.getByRole('alertdialog');

    // No acceptance receipt: only Abandoned is possible, and keeping records nothing.
    await page.goto(`http://127.0.0.1:${server.port}/?dispatch=lost`);
    await dialog.getByText('Recording an outcome resends nothing and replays nothing.', { exact: false }).waitFor();
    expect(await dialog.getByRole('option', { name: 'Confirmed delivered (acceptance receipt on record)' }).isDisabled()).toBe(true);
    await dialog.getByText('only Abandoned is available', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Keep as unknown' }).click();
    expect(await dialog.count()).toBe(0); expect(await fixture()).toEqual({ confirmed: [], kept: 1 });

    await page.goto(`http://127.0.0.1:${server.port}/?dispatch=lost`);
    const confirm = dialog.getByRole('button', { name: 'Record outcome' });
    expect(await confirm.isDisabled()).toBe(true);
    await dialog.getByLabel('Note (optional)').fill('  Checked the provider; nothing to adopt.  ');
    await dialog.getByRole('checkbox').check(); await confirm.click();
    expect((await fixture()).confirmed).toEqual([{ kind: 'abandoned', note: 'Checked the provider; nothing to adopt.' }]);

    // With the dispatch's own acceptance receipt, delivery may be confirmed; no note is sent when blank.
    await page.goto(`http://127.0.0.1:${server.port}/?dispatch=acked`);
    await dialog.getByText('accept-1').waitFor();
    await dialog.getByLabel('Outcome').selectOption('confirmed_delivered');
    await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Record outcome' }).click();
    expect((await fixture()).confirmed).toEqual([{ kind: 'confirmed_delivered' }]);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); server.stop(true); }
}, 30_000);
