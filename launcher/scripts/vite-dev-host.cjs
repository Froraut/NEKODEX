const path = require("node:path");
const root = path.resolve(__dirname, "..");
let server;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await server?.close();
  if (process.connected) process.disconnect();
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
process.once("disconnect", () => { void stop(); });

void (async () => {
  // Node hosts Vite's native addons; the signed embedded Bun is reserved for runtime tooling.
  const { createServer } = await import("vite");
  if (stopping) return;
  server = await createServer({ root, configFile: path.join(root, "vite.config.ts"),
    server: { host: "127.0.0.1", port: 4178, strictPort: false }, clearScreen: false });
  if (stopping) { await server.close(); return; }
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string" || !process.send) throw new Error("Development server has no owned IPC listener");
  if (stopping) { await server.close(); return; }
  process.send({ type: "vite-ready", url: `http://127.0.0.1:${address.port}` });
})().catch(async error => {
  console.error(`Development server failed: ${error.message}`);
  process.exitCode = 1;
  await stop();
});
