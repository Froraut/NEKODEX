import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('Tools sections retain drafts and exact approval retains an unknown outcome without replay', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/agent-tools-ui-review-page.tsx', import.meta.url).pathname], target: 'browser', minify: true });
  expect(build.success).toBe(true);
  const script = build.outputs.find(output => output.path.endsWith('.js'))!;
  const css = build.outputs.find(output => output.path.endsWith('.css'))!;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    if (path === '/fixture.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
    return new Response('<link rel="stylesheet" href="/fixture.css"><main style="container:workspace / inline-size"><div id="root"></div></main><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }); page.setDefaultTimeout(2500);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(`http://127.0.0.1:${server.port}/`) ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByRole('combobox', { name: 'Agent task', exact: true }).selectOption('task-a');
    await page.getByRole('combobox', { name: 'Saved model tool request', exact: true }).selectOption('call-a');
    expect(await page.getByRole('heading', { name: 'Read window image', exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('The selected window image is shared', { exact: false }).isVisible()).toBe(true);
    const approve = page.getByRole('button', { name: 'Approve and invoke this exact call', exact: true });
    expect(await approve.isEnabled()).toBe(true);
    const nav = page.getByRole('navigation', { name: 'Tool sections', exact: true });
    await nav.getByRole('button', { name: /^Connections/ }).click();
    const args = page.getByRole('textbox', { name: 'Exact arguments (JSON string array)', exact: true });
    await args.fill('["draft value"]');
    await nav.getByRole('button', { name: /^Local access and skills/ }).click();
    await nav.getByRole('button', { name: /^Connections/ }).click();
    expect(await args.inputValue()).toBe('["draft value"]');
    expect(await page.getByRole('combobox', { name: 'Agent task', exact: true }).inputValue()).toBe('task-a');
    await nav.getByRole('button', { name: /^Calls and receipts/ }).click();
    expect(await page.getByRole('combobox', { name: 'Saved model tool request', exact: true }).inputValue()).toBe('call-a');
    await page.getByText('Exact request and call identity', { exact: true }).click();
    expect(await page.locator('.agent-tools-call-review details pre').textContent()).toContain('"toolCallId": "call-a"');
    await approve.click();
    expect(await page.getByText('Outcome unknown', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('The effect may already have occurred.', { exact: false }).isVisible()).toBe(true);
    expect(await page.evaluate(() => (window as any).toolsUiFixture.requests.filter((row: any) => row.action === 'approveInvoke'))).toEqual([
      { action: 'approveInvoke', scope: { taskId: 'task-a', generation: 3, toolCallId: 'call-a' }, explicitUserAction: true },
    ]);
    expect(await approve.count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.stop(true); }
}, 15000);

test('keyboard approval hands a retired action to its result without stealing moved or inactive focus', async () => {
  const build = await Bun.build({ entrypoints: [new URL('./fixtures/agent-tools-ui-review-page.tsx', import.meta.url).pathname], target: 'browser', minify: true });
  expect(build.success).toBe(true);
  const script = build.outputs.find(output => output.path.endsWith('.js'))!;
  const css = build.outputs.find(output => output.path.endsWith('.css'))!;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
    if (path === '/fixture.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
    return new Response('<link rel="stylesheet" href="/fixture.css"><main style="container:workspace / inline-size"><div id="root"></div></main><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
  } });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ['keyboard', 'moved', 'inactive', 'window-blur', 'foreground']) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
      const page = await context.newPage(); page.setDefaultTimeout(2500);
      await page.goto(`http://127.0.0.1:${server.port}/`);
      await page.bringToFront();
      await page.evaluate(foreground => Object.assign((window as any).toolsUiFixture, { holdApproval: true, foreground }), scenario === 'foreground');
      await page.getByRole('combobox', { name: 'Agent task', exact: true }).selectOption('task-a');
      await page.getByRole('combobox', { name: 'Saved model tool request', exact: true }).selectOption('call-a');
      const approval = page.getByRole('button', { name: scenario === 'foreground' ? 'Approve this call and wait for the selected window' : 'Approve and invoke this exact call', exact: true });
      await approval.focus();
      expect(await approval.evaluate(element => element === document.activeElement && document.hasFocus())).toBe(true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => (window as any).toolsUiFixture.requests.some((row: any) => row.action === 'approveInvoke'));
      if (scenario === 'moved') {
        // Movement ends the handoff even if that later target itself loses focus.
        const destination = page.getByRole('textbox', { name: 'Retained receipt key', exact: true });
        await destination.focus();
        expect(await destination.evaluate(element => element === document.activeElement)).toBe(true);
        await destination.evaluate(element => element.blur());
      } else if (scenario === 'inactive') {
        // Headless Chromium keeps background pages focused. Inject only the
        // unavailable-document condition; the production focus guard is exercised.
        await page.evaluate(() => Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false }));
      } else if (scenario === 'window-blur') {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      }
      await page.evaluate(() => (window as any).toolsUiFixture.releaseApproval());
      await page.getByRole('region', { name: 'Tool call result', exact: true }).waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent?.startsWith('Approve')));
      const focused = await page.evaluate(() => ({ role: document.activeElement?.getAttribute('aria-label'), tag: document.activeElement?.tagName }));
      expect(focused).toEqual(scenario === 'keyboard' ? { role: 'Tool call result', tag: 'DIV' } : { role: null, tag: 'BODY' });
      if (scenario === 'inactive') {
        await page.evaluate(() => { delete (document as any).hasFocus; });
        expect(await page.evaluate(() => document.hasFocus() && document.activeElement === document.body)).toBe(true);
      }
      expect(await page.evaluate(() => (window as any).toolsUiFixture.requests.filter((row: any) => row.action === 'approveInvoke').length)).toBe(1);
      await context.close();
    }
  } finally { await browser.close(); server.stop(true); }
}, 15000);
