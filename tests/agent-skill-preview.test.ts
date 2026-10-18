import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, type BrowserContext } from 'playwright-core';
import { createAgentToolsComposition } from '../src/agent-tools/composition';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const imagePath = 'assets/chart.png', invalidPath = 'assets/invalid.png';
const importLabel = 'Import this reviewed immutable version';
const reviewLabel = 'Review the source and every selected file';
const evidence = process.env.NEKODEX_SKILL_PREVIEW_EVIDENCE;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Meaningful 320x160 chart, with inert PNG padding above the old 32 KiB text limit.
// The negative preserves chunk CRCs/header/SHA but adds an unknown critical chunk.
// Invalid zlib alone is unsuitable: Chrome can accept it as a partial image, even
// resolving img.decode(). Host bounded structure checks are not a full codec.
function chartPng(invalid = false) {
  const chunk = (name: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(name), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const width = 320, height = 160, header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  const bars = [{ x: 45, height: 45, color: [43, 111, 219] }, { x: 125, height: 80, color: [38, 157, 115] }, { x: 205, height: 110, color: [218, 131, 43] }];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const bar = bars.find(bar => x >= bar.x && x < bar.x + 50 && y >= 135 - bar.height && y < 135);
    const axis = x >= 25 && x <= 295 && y === 135 || x === 25 && y >= 15 && y <= 135;
    const color = bar?.color ?? (axis ? [57, 69, 89] : [241, 245, 251]);
    const offset = y * (width * 4 + 1) + x * 4 + 1;
    pixels.set([...color, 255], offset);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    ...(invalid ? [chunk('FAIL', Buffer.from('Unsupported critical fixture chunk'))] : []),
    chunk('tEXt', Buffer.concat([Buffer.from('Fixture\0'), Buffer.alloc(36 * 1024, 120)])),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

test('actual Chrome skill review requires exact image bytes and successful decode before one immutable import', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-skill-preview-')));
  const home = join(root, 'private'), source = join(root, 'source');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(join(source, 'assets'), { recursive: true });
  const instructions = '---\nname: isolated-chart-review\ndescription: Describe an explicitly selected inert chart during a local preview fixture.\n---\nObserve the selected chart only as source material. No scripts, tools or external actions are granted.\n';
  const png = chartPng(), invalidPng = chartPng(true);
  writeFileSync(join(source, 'SKILL.md'), instructions);
  writeFileSync(join(source, imagePath), png); writeFileSync(join(source, invalidPath), invalidPng);
  const tools = createAgentToolsComposition({ home, authorize: request => request.headers.get('authorization') === 'inert-preview-fixture', isScopeActive: () => false });
  let context: BrowserContext | undefined, server: ReturnType<typeof Bun.serve> | undefined;
  const requests: any[] = [], reviews: any[] = [], commits: any[] = [];
  let receipt: Record<string, unknown> | undefined;
  try {
    const grant = tools.addSkillRoot({ root: source, label: 'Temporary inert chart source' }, true);
    const sources = tools.discoverSkills(grant.id).skills;
    expect(sources).toHaveLength(1); expect(png.length).toBeGreaterThan(32 * 1024);
    const build = await Bun.build({ entrypoints: [join(repo, 'tests/fixtures/agent-skill-preview-page.tsx')],
      outdir: join(root, 'bundle'), target: 'browser', minify: false, tsconfig: join(repo, 'launcher/tsconfig.json'),
      define: { 'process.env.NODE_ENV': JSON.stringify('test') },
    });
    expect(build.success).toBe(true);
    const bundle = build.outputs.find(output => output.path.endsWith('.js'))!;
    const css = ['tokens.css', 'design/components.css', 'surfaces/agent-tools.css'].map(path => readFileSync(join(repo, 'launcher/src', path), 'utf8')).join('\n');
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/fixture-bootstrap') return Response.json({ sources, status: tools.status() });
      if (path === '/fixture.js') return new Response(bundle, { headers: { 'content-type': 'text/javascript' } });
      if (path === '/fixture.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
      if (path === '/admin/agent-tools') {
        const input = await request.clone().json(); requests.push(input);
        const response = (await tools.handle(request))!;
        const packet = await response.clone().json();
        if (input.action === 'reviewSkillPackageImport') reviews.push(packet);
        if (input.action === 'commitSkillImport') commits.push(packet);
        return response;
      }
      if (path !== '/') return new Response('Not found', { status: 404 });
      return new Response('<!doctype html><meta charset="utf-8"><title>Isolated skill preview</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:24px auto;max-width:960px;padding:0 24px}main{padding-bottom:24px}pre,code{overflow-wrap:anywhere;white-space:pre-wrap}h1{font-size:22px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    } });
    context = await chromium.launchPersistentContext(join(root, 'chrome-profile'), { headless: true,
      executablePath: process.env.CHATGPT_DOM_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', viewport: { width: 1120, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(4000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const audit = { earlyEnabled: [] as unknown[], decoded: [] as unknown[], failed: [] as string[] };
      (window as any).__previewAudit = audit;
      const inspect = () => {
        const button = [...document.querySelectorAll('button')].find(row => row.textContent === 'Import this reviewed immutable version');
        if (button && !button.disabled) {
          const images = [...document.querySelectorAll('img')];
          if (!images.length || images.some(img => !img.complete || img.naturalWidth !== 320 || img.naturalHeight !== 160)) audit.earlyEnabled.push('Import enabled before complete decoded chart');
        }
      };
      new MutationObserver(inspect).observe(document, { subtree: true, childList: true, attributes: true });
      document.addEventListener('load', event => { if (event.target instanceof HTMLImageElement) { audit.decoded.push({ alt: event.target.alt, width: event.target.naturalWidth, height: event.target.naturalHeight }); inspect(); } }, true);
      document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) audit.failed.push(event.target.alt); }, true);
    });
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.getByRole('combobox', { name: 'Discovered local source' }).selectOption(sources[0]!.id);
    await page.getByRole('textbox', { name: 'Supporting text and PNG/JPEG files' }).fill(imagePath);
    await page.getByRole('button', { name: reviewLabel, exact: true }).click();
    const image = page.getByRole('img', { name: `Selected local image: ${imagePath}`, exact: true });
    await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const image = document.querySelector('img'); return image?.complete && image.naturalWidth === 320 && image.naturalHeight === 160; });
    const preview = await image.evaluate(img => ({ complete: (img as HTMLImageElement).complete, width: (img as HTMLImageElement).naturalWidth, height: (img as HTMLImageElement).naturalHeight, src: (img as HTMLImageElement).src }));
    expect(preview).toMatchObject({ complete: true, width: 320, height: 160 });
    expect(preview.src).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(reviews).toHaveLength(1); expect(reviews[0].ok).toBe(true);
    expect(reviews[0].value.resources[0]).toMatchObject({ digest: hash(png), bytes: png.length, width: 320, height: 160, data: png.toString('base64') });
    expect(await page.getByRole('button', { name: importLabel, exact: true }).isEnabled()).toBe(true);
    expect(commits).toHaveLength(0);
    if (evidence) { mkdirSync(dirname(evidence), { recursive: true }); await page.screenshot({ path: evidence, fullPage: true }); }
    await page.getByRole('button', { name: importLabel, exact: true }).click();
    await page.getByText('Version imported. It is not attached automatically; select its task action below.', { exact: true }).waitFor();
    expect(commits).toHaveLength(1); expect(commits[0].ok).toBe(true);
    const imported = commits[0].value;
    expect(imported.state).toBe('imported'); expect(imported.versionId).toBe(reviews[0].value.action.versionId);
    expect(readFileSync(join(imported.target, 'resources', imagePath))).toEqual(png);
    expect(tools.status().managedSkills?.attachments).toEqual([]);
    await page.getByRole('button', { name: 'Start a new review', exact: true }).click();
    await page.getByRole('textbox', { name: 'Supporting text and PNG/JPEG files' }).fill(invalidPath);
    await page.getByRole('button', { name: reviewLabel, exact: true }).click();
    const failedImage = page.getByRole('img', { name: `Selected local image: ${invalidPath}`, exact: true });
    await failedImage.scrollIntoViewIfNeeded();
    const decode = await failedImage.evaluate(async image => {
      try { await (image as HTMLImageElement).decode(); return { decoded: true }; }
      catch (error) { return { decoded: false, error: String(error) }; }
    });
    expect(decode.decoded).toBe(false);
    await page.waitForFunction(() => (window as any).__previewAudit.failed.length > 0).catch(async error => {
      throw new Error(`${error.message}\n${JSON.stringify(await page.evaluate(() => ({ audit: (window as any).__previewAudit, images: [...document.images].map(img => ({ alt: img.alt, complete: img.complete, width: img.naturalWidth, height: img.naturalHeight })), buttons: [...document.querySelectorAll('button')].map(button => ({ text: button.textContent, disabled: button.disabled })) })))}`);
    });
    expect(reviews).toHaveLength(2); expect(reviews[1].ok).toBe(true);
    expect(reviews[1].value.action.state).toBe('reviewed');
    expect(reviews[1].value.resources[0]).toMatchObject({ digest: hash(invalidPng), bytes: invalidPng.length, width: 320, height: 160, data: invalidPng.toString('base64') });
    expect(await page.getByRole('button', { name: importLabel, exact: true }).isDisabled()).toBe(true);
    const audit = await page.evaluate(() => (window as any).__previewAudit);
    expect(audit.earlyEnabled).toEqual([]); expect(audit.decoded.length).toBeGreaterThan(0);
    expect(audit.decoded.every((image: any) => image.alt === `Selected local image: ${imagePath}` && image.width === 320 && image.height === 160)).toBe(true);
    expect(audit.failed).toEqual([`Selected local image: ${invalidPath}`]);
    expect(commits).toHaveLength(1); expect(errors).toEqual([]);
    expect(tools.status().managedSkills?.versions).toHaveLength(1);
    expect(requests.filter(row => row.action === 'attachManagedSkill')).toHaveLength(0);
    receipt = { browser: context.browser()?.version(), component: 'AgentManagedSkills', positive: { complete: preview.complete, width: preview.width, height: preview.height, bytes: png.length, sha256: hash(png), versionId: imported.versionId, state: imported.state, attached: false },
      negative: { bytes: invalidPng.length, sha256: hash(invalidPng), fault: 'unknown critical PNG chunk, valid CRC and otherwise valid zlib data', hostReviewed: true, decode, importDisabled: true }, audit, reviews: reviews.length, commits: commits.length, errors };
  } finally {
    await context?.close(); server?.stop(true); await tools.close(); rmSync(root, { recursive: true, force: true });
  }
  expect(existsSync(root)).toBe(false);
  if (evidence && receipt) writeFileSync(evidence.replace(/\.png$/, '.json'), JSON.stringify({ ...receipt, cleanup: { browserClosed: true, serverStopped: true, temporaryRootRemoved: true }, scope: 'headless Chrome DOM with actual component and local actor; no Electron, model, account or release' }, null, 2) + '\n');
}, 20_000);
