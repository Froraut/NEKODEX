import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('rendered profile removal confirms first and requires an explicit acknowledgement for a signed-in profile', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/native-profile-removal-page.tsx', import.meta.url).pathname], target: 'browser', minify: true,
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
    const removals = page.getByRole('button', { name: 'Remove profile', exact: true });
    await page.getByText('Failed test profile').waitFor();
    const mutations = () => page.evaluate(() => (window as any).fixture.requests.filter((row: any) => row.action !== 'status'));
    // Keeping the profile sends nothing.
    await removals.first().click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Keep profile' }).click();
    expect(await dialog.count()).toBe(0); expect(await mutations()).toEqual([]);
    // An unsigned profile needs only the dialog confirmation.
    await removals.first().click();
    expect(await dialog.getByRole('checkbox').count()).toBe(0);
    await dialog.getByRole('button', { name: 'Remove profile' }).click();
    await page.getByText('Failed test profile').waitFor({ state: 'detached' });
    expect(await mutations()).toMatchObject([{ action: 'remove-profile', profileId: '11111111-1111-4111-8111-111111111111' }]);
    expect((await mutations())[0].confirmSignedIn).toBeUndefined();
    // A signed-in profile keeps the danger action disabled until acknowledged.
    await removals.first().click();
    const confirm = dialog.getByRole('button', { name: 'Remove profile' });
    expect(await confirm.isDisabled()).toBe(true);
    await dialog.getByRole('checkbox').check(); expect(await confirm.isEnabled()).toBe(true);
    await confirm.click();
    await page.getByText('Signed-in profile').waitFor({ state: 'detached' });
    expect((await mutations())[1]).toMatchObject({ action: 'remove-profile', profileId: '33333333-3333-4333-8333-333333333333', confirmSignedIn: true });
    expect(errors).toEqual([]);
  } finally { await browser?.close(); server.stop(true); }
}, 30_000);
