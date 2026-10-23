const build = await Bun.build({ entrypoints: [new URL('./account-card-actions-page.tsx', import.meta.url).pathname], target: 'browser' });
if (!build.success) throw new Error(JSON.stringify(build.logs));
const js = build.outputs.find(output => output.path.endsWith('.js'))!;
const css = build.outputs.find(output => output.path.endsWith('.css'))!;
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/fixture.js') return new Response(js, { headers: { 'content-type': 'text/javascript' } });
  if (path === '/fixture.css') return new Response(css, { headers: { 'content-type': 'text/css' } });
  return new Response('<!doctype html><html><head><meta charset="UTF-8"><title>Accounts card actions · inert fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { 'content-type': 'text/html; charset=UTF-8' } });
} });
console.log(`Accounts inert fixture ${server.url} pid=${process.pid} · RU: ?language=ru`);
