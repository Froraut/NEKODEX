const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronBin = require("electron");
const bun = process.env.CODEX_WEB_GPT_BUN || process.execPath;

const helperBuild = spawnSync(bun, ["run", "scripts/build-browser-helper.ts"], {
  cwd: path.resolve(root, ".."),
  env: process.env,
  stdio: "inherit",
});
if (helperBuild.error) throw helperBuild.error;
if (helperBuild.status !== 0) process.exit(helperBuild.status ?? 1);

const vite = spawn(process.env.CODEX_WEB_GPT_NODE || "node", [path.join(__dirname, "vite-dev-host.cjs")], {
  cwd: root,
  stdio: ["ignore", "inherit", "inherit", "ipc"],
  env: process.env,
});

let electron;
let stopped = false;

const stop = () => {
  if (stopped) return;
  stopped = true;
  electron?.kill("SIGTERM");
  vite.kill("SIGTERM");
};

const waitForVite = () => new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => finish(new Error("Owned development server did not become ready")), 30_000);
  const onError = error => finish(error);
  const onExit = () => finish(new Error("Owned development server exited before readiness"));
  const onMessage = message => {
    if (message?.type !== "vite-ready") return;
    try {
      const url = new URL(message.url);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
        || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid development server address");
      finish(null, url.origin);
    } catch (error) { finish(error); }
  };
  function finish(error, url) {
    clearTimeout(timer);
    vite.off("message", onMessage); vite.off("error", onError); vite.off("exit", onExit);
    if (error) reject(error); else resolveReady(url);
  }
  vite.on("message", onMessage); vite.once("error", onError); vite.once("exit", onExit);
  if (stopped || vite.exitCode !== null || vite.signalCode !== null) onExit();
});

void waitForVite().then(url => {
  if (stopped || vite.exitCode !== null || vite.signalCode !== null) return;
  electron = spawn(electronBin, [root, "--dev-profile"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: url,
      CODEX_WEB_GPT_BUN: bun,
      CODEX_CHATGPT_WEB_BUN: bun,
    },
  });
  electron.once("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
  electron.once("error", (error) => {
    console.error(`Electron failed to start: ${error.message}`);
    stop();
    process.exitCode = 1;
  });
}).catch((error) => {
  console.error(error);
  stop();
  process.exitCode = 1;
});

vite.once("exit", (code) => {
  if (!stopped) {
    console.error(`Vite exited with code ${code}`);
    stop();
    process.exitCode = code || 1;
  }
});

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
