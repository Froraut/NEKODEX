import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
const { RuntimeSupervisor } = require("../../launcher/electron/runtime-supervisor.cjs");
import { startServer } from "../../src/server";

const root = process.argv[2]!;
process.env.CODEX_CHATGPT_WEB_HOME = root;
const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
if (process.argv[3] === "daemon") {
  startServer(config, {
    fetchUpstream: async () => new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"type":"response.created"}\n\n'));
        setTimeout(() => {
          controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"id":"synthetic-background","status":"completed","output":[]}}\n\n'));
          controller.close();
        }, 900);
      },
    }), { headers: { "content-type": "text/event-stream" } }),
  });
} else {
  const quiet = () => {};
  const supervisor = new RuntimeSupervisor({
    app: { getVersion: () => config.releaseVersion, isPackaged: false },
    logger: { info: quiet, warn: quiet, error: quiet },
    sourceRoot: resolve(import.meta.dir, "../.."), coreHome: root,
    browserDescriptorPath: config.browserHostDescriptorPath,
    nativeProxyEnvironmentProvider: async () => ({ CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY: "DIRECT" }),
    runtimeInvocationFactory: () => ({ executable: process.execPath,
      args: [import.meta.path, root, "daemon"], cwd: root }),
  });
  const ready = await supervisor.startIfConfigured();
  console.log(JSON.stringify({ ...ready, ownerPid: process.pid }));
  for await (const chunk of Bun.stdin.stream()) {
    const command = new TextDecoder().decode(chunk).trim();
    const result = command === "detach"
      ? await supervisor.detachForQuit()
      : await supervisor.shutdown({ force: false });
    console.log(JSON.stringify(result));
    process.exit(0);
  }
}
