/** Parent-owned inert GUI review target. Never loads Electron or product adapters. */
const build = await Bun.build({ entrypoints: [new URL('./agent-basic-functions-page.tsx', import.meta.url).pathname], target: 'browser', minify: true });
if (!build.success) throw new Error(build.logs.map(String).join('\n'));
const script = build.outputs.find(output => output.path.endsWith('.js'))!;
const css = build.outputs.find(output => output.path.endsWith('.css'))!;
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.argv[2] ?? 5223), fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
  if (url.pathname === '/fixture.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
  return new Response('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:var(--nk-bg-base);color:var(--nk-text-primary)}main{container:workspace / inline-size}</style><main><div id="root"></div></main><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
} });
console.log(`Inert basic functions fixture http://127.0.0.1:${server.port}/?surface=tasks ; tools default`);
