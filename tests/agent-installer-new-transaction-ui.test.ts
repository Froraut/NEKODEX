import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('installer explicitly resets only a known terminal receipt and preserves unresolved identities', async () => {
  const built = await Bun.build({ entrypoints: [new URL('./fixtures/agent-basic-functions-page.tsx', import.meta.url).pathname], target: 'browser', minify: true });
  expect(built.success).toBe(true);
  const script = built.outputs.find(output => output.path.endsWith('.js'))!, css = built.outputs.find(output => output.path.endsWith('.css'))!;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    if (path === '/fixture.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
    return new Response('<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(2500);
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/?surface=installer`);
    const next = page.getByRole('button', { name: 'New installation', exact: true });
    expect(await next.isEnabled()).toBe(false);
    await page.getByRole('button', { name: 'Inspect receipt', exact: true }).click();
    const id = page.getByRole('textbox', { name: 'Stable installation action ID', exact: true });
    const root = page.getByRole('textbox', { name: 'Explicit data directory', exact: true });
    expect(await id.inputValue()).toBe('retained-installation');
    expect(await root.getAttribute('readonly')).not.toBeNull();
    expect(await next.isEnabled()).toBe(true);
    await next.click();
    const newId = await id.inputValue(); expect(newId).not.toBe('retained-installation');
    await root.fill('/inert/new-root');
    await page.getByRole('checkbox', { name: /^I select this exact package/ }).check();
    await page.getByRole('button', { name: 'Prepare dependency graph', exact: true }).click();
    expect(await page.evaluate(() => (window as any).basicFunctionsFixture.requests.filter((body: any) => body.action === 'prepareInstall'))).toEqual([{ action: 'prepareInstall', actionId: newId, catalogId: 'official-filesystem', allowedRoot: '/inert/new-root', explicitUserAction: true }]);
    expect(await next.isEnabled()).toBe(false); // prepared is not a completed transaction
    for (const state of ['unknown', 'held']) {
      await page.goto(`http://127.0.0.1:${server.port}/?surface=installer&state=${state}`);
      await page.getByRole('button', { name: 'Inspect receipt', exact: true }).click();
      expect(await id.inputValue()).toBe('retained-installation');
      expect(await next.isEnabled()).toBe(false);
      expect(await id.getAttribute('readonly')).not.toBeNull();
      expect(await page.getByRole('combobox', { name: 'Official package', exact: true }).isEnabled()).toBe(false);
      expect(await page.getByRole('button', { name: 'Prepare dependency graph', exact: true }).isEnabled()).toBe(false);
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.stop(true); }
}, 15000);
