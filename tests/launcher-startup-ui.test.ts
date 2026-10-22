import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// Use the existing credential-free preview bridge without starting its server.
const preview = readFileSync(new URL('../launcher/scripts/ui-preview.cjs', import.meta.url), 'utf8');
const installer = preview.slice(preview.indexOf('function installMockLauncher()'), preview.indexOf('\nfunction createFixtureServer()'));

test('missing preload renders startup recovery and connected surface adapters preserve their requests', async () => {
  const build = await Bun.build({
    entrypoints: [new URL('./fixtures/launcher-startup-page.tsx', import.meta.url).pathname], target: 'browser',
    // This check covers startup/IPC behavior. Leave source CSS parsing to Vite;
    // Bun does not yet support the browser's scroll-state container syntax.
    plugins: [{ name: 'startup-without-css', setup(builder) {
      builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
      builder.onResolve({ filter: /^(react(?:-dom)?(?:\/.*)?|scheduler)$/ }, args => ({
        path: Bun.resolveSync(args.path, new URL('../launcher/', import.meta.url).pathname),
      }));
    } }],
  });
  expect(build.success).toBe(true);
  const script = build.outputs.find(output => output.path.endsWith('.js'))!;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
    const url = new URL(request.url);
    if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    const bridge = url.searchParams.has('bridge') ? `<script>${installer};installMockLauncher();
      window.adapterCalls = [];
      for (const method of ['browserCompanion','localControlApiRequest','externalUsageRequest']) {
        window.codexWebLauncher[method] = async body => {
          window.adapterCalls.push({method,body});
          throw new Error('Synthetic ' + method + ' read refusal');
        };
      }</script>` : '';
    return new Response(`${bridge}<div id="root"></div><script type="module" src="/fixture.js"></script>`, { headers: { 'content-type': 'text/html' } });
  } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage(); page.setDefaultTimeout(3000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.port}`;
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.goto(origin + '/');
    await page.getByRole('heading', { name: "NEKODEX couldn't start", exact: true }).waitFor();
    await page.getByText('Show details', { exact: true }).click();
    expect(await page.getByText('Launcher IPC is unavailable.', { exact: true }).isVisible()).toBe(true);
    expect(await page.locator('.nk-shell').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).codexWebLauncher)).toBeUndefined();
    // Allow mounted effects to run: absent IPC must not create a late rejection.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(errors).toEqual([]);

    await page.goto(origin + '/?bridge=1&scenario=startup-error&language=en');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('.nk-shell').waitFor();
    for (const [route, method] of [['browser-companion','browserCompanion'], ['local-control-api','localControlApiRequest'], ['external-usage','externalUsageRequest']]) {
      const index = { 'browser-companion': 12, 'local-control-api': 13, 'external-usage': 10 }[route]!;
      // Accessible route label is localized; stable sidebar order is the shell's existing preview contract.
      await page.locator('.nk-sidebar .nk-nav-item').nth(index).click();
      await page.locator(`.nk-shell[data-surface="${route}"]`).waitFor();
      await page.getByText(`Synthetic ${method} read refusal`, { exact: false }).waitFor();
    }
    expect(await page.evaluate(() => (window as any).adapterCalls)).toEqual([
      { method: 'browserCompanion', body: { action: 'status' } },
      { method: 'localControlApiRequest', body: { action: 'status' } },
      { method: 'externalUsageRequest', body: { action: 'status' } },
    ]);
    expect(errors).toEqual([]);
  } finally { await browser?.close(); await server.stop(true); }
}, 20000);
