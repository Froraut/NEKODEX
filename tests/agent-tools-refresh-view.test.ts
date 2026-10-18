import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('rendered tools Refresh replaces selected task calls and rejects stale task/generation detail without execution', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/agent-tools-refresh-page.tsx', import.meta.url).pathname], target: 'browser', minify: true });
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
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.port}/`);
    const task = page.getByRole('combobox', { name: 'Agent task', exact: true });
    const call = page.getByRole('combobox', { name: 'Saved model tool request', exact: true });
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    await task.selectOption('task'); await call.selectOption('write');
    expect(await call.inputValue()).toBe('write');
    await page.evaluate(() => Object.assign((window as any).fixture, { call: 'read', truncated: true, hold: true }));
    await refresh.click();
    await page.waitForFunction(() => (window as any).fixture.reads === 2);
    expect(await task.inputValue()).toBe('task');
    expect(await call.locator('option[value="write"]').count()).toBe(0);
    await page.evaluate(() => { (window as any).fixture.hold = false; (window as any).fixture.release(); });
    await page.waitForFunction(() => document.querySelector('option[value="read"]') !== null);
    expect(await call.inputValue()).toBe('');
    expect(await page.getByText('The current pending-call projection is bounded.', { exact: false }).count()).toBe(1);
    for (const stale of [{ generation: 1, responseTask: 'task' }, { generation: 2, responseTask: 'other-task' }]) {
      await page.evaluate(value => Object.assign((window as any).fixture, { ...value, hold: true }), stale);
      const before = await page.evaluate(() => (window as any).fixture.reads);
      await refresh.click(); await page.waitForFunction(count => (window as any).fixture.reads > count, before);
      await page.evaluate(() => { (window as any).fixture.hold = false; (window as any).fixture.release(); });
      await page.waitForFunction(() => {
        const button = [...document.querySelectorAll('button')].find(row => row.textContent === 'Refresh');
        return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
      });
      expect(await task.inputValue()).toBe('task');
      expect(await call.locator('option').count()).toBe(1);
    }
    expect(await page.evaluate(() => ({ mutations: (window as any).fixture.mutations, requests: (window as any).fixture.requests.filter((x: string) => !['status', 'remoteStatus'].includes(x)) })))
      .toEqual({ mutations: 0, requests: [] });
    expect(errors).toEqual([]);
  } finally { await browser?.close(); server.stop(true); }
}, 15000);
