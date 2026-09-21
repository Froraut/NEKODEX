import { beforeAll, afterAll, test, expect } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { CHATGPT_COMPOSER_SELECTOR } from '../src/chatgpt-session';
import { insertPlainTextIntoComposer } from '../src/adapters/chatgpt-web/browser-worker';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const context = await browser.newContext();
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  page = await context.newPage();
  await page.goto('https://chatgpt.com/?temporary-chat=true');
});
afterAll(async () => { await browser?.close(); });

test('localized ProseMirror composer is found without matching other editors', async () => {
  await page.setContent(`<div class="ProseMirror" contenteditable="true">unrelated editor</div>
    <form><div class="ProseMirror" contenteditable="true" aria-label="Сообщение"></div>
    <button data-testid="send-button">Send</button></form>`);
  expect(await page.locator(CHATGPT_COMPOSER_SELECTOR).count()).toBe(1);
  expect(await page.locator(CHATGPT_COMPOSER_SELECTOR).getAttribute('aria-label')).toBe('Сообщение');
});

test('large multiline insertion preserves exact literal text and connector state', async () => {
  const text = ' '+ ('JSON {"text":"<&> `code`"}\n\n<script>window.untrusted=1</script>\n  отступ\n').repeat(260) + 'END';
  expect(text.length).toBeGreaterThanOrEqual(16_384);
  const old = execFileSync('git',['show','v5.1.0-froraut.18:src/adapters/chatgpt-web/browser-worker.ts'],{encoding:'utf8'});
  const start = old.indexOf('export function insertPlainTextIntoComposer');
  const end = old.indexOf('\nexport class ChatGptBrowserWorker', start);
  const baseline = new Bun.Transpiler({loader:'ts'}).transformSync(old.slice(start,end)).replace('export function','function');
  const timings: Record<string, number> = {};
  for (const [name,source] of [['baseline',baseline],['fragment',insertPlainTextIntoComposer.toString()]] as const) {
    await page.setContent(`<form><div id="prompt-textarea" contenteditable="true" style="white-space:pre-wrap"><p><span contenteditable="false" data-id="plugin:test" data-keyword="Native">Native</span></p></div><button data-testid="send-button">Send</button></form>`);
    const result = await page.locator('#prompt-textarea').evaluate((element, input) => {
      const fn = new Function(input.source + ';return insertPlainTextIntoComposer;')();
      const start = performance.now();
      const inserted = fn(element, input.text);
      const elapsed = performance.now()-start;
      const clone=element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-id^="plugin:"][data-keyword], [data-inline-selection-pill-cursor-target]').forEach(n=>n.remove());
      return {inserted,elapsed,text:[...clone.childNodes].map(n=>n.textContent??'').join('\n').trimStart(),
        pills:element.querySelectorAll('[data-id="plugin:test"]').length,scripts:element.querySelectorAll('script').length};
    }, {source,text});
    console.log(JSON.stringify({path:name,expected_chars:text.trimStart().length,observed_chars:result.text.length}));
    expect(result.inserted).toBe(true);
    expect(result.text).toBe(text.trimStart());
    expect(result.pills).toBe(1);
    expect(result.scripts).toBe(0);
    timings[name]=Number(result.elapsed.toFixed(2));
  }
  console.log(JSON.stringify({sample:'one local contenteditable fixture',chars:text.length,timings_ms:timings}));
});

test('CR and NUL inputs keep the plain text command', async () => {
  await page.setContent('<div id="prompt-textarea" contenteditable="true"></div>');
  const source=insertPlainTextIntoComposer.toString();
  const commands=await page.locator('#prompt-textarea').evaluate((element, input) => {
    const fn=new Function(input+';return insertPlainTextIntoComposer;')();
    const old=document.execCommand;const calls:string[]=[];
    document.execCommand=((name:string)=>{calls.push(name);return true;}) as typeof old;
    try { fn(element,('x\n').repeat(9000)+'\r\u0000'); }
    finally { document.execCommand=old; }
    return calls;
  },source);
  expect(commands).toEqual(['insertText']);
});

test('navigation to a lookalike origin cannot receive continuation text', async () => {
  await page.goto('https://chatgpt.com.example.test/');
  await page.setContent('<div id="prompt-textarea" contenteditable="true">unchanged</div>');
  await expect(page.locator('#prompt-textarea').evaluate(insertPlainTextIntoComposer, 'synthetic-private-continuation'))
    .rejects.toThrow('foreign document');
  expect(await page.locator('#prompt-textarea').textContent()).toBe('unchanged');
});
