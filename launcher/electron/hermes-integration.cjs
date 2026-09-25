const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const HERMES_SETUP_TIMEOUT_MS = 20_000;
const HERMES_SETUP_MAX_OUTPUT = 64 * 1024;

// Runs off the Electron main thread so the launcher window stays responsive during setup.
function runHermesSetup(python, script, input) {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const child = spawn(python, ["-c", script], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => { child.kill(); finish({ status: null, stdout }); }, HERMES_SETUP_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > HERMES_SETUP_MAX_OUTPUT) { child.kill(); finish({ status: null, stdout: "" }); }
    });
    child.on("error", () => finish({ status: null, stdout: "" }));
    child.on("close", status => finish({ status, stdout }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function installHermesProvider({ coreHome, config, runtime = "codex_responses", makeDefault = false, hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes") }) {
  if (!config || config.mode !== "full" || config.browserInteractionMode === "manual") {
    throw new Error("Connect ChatGPT tools in Automatic mode before adding Hermes.");
  }
  const checkout = path.join(os.homedir(), ".hermes", "hermes-agent");
  const python = ["venv", ".venv"].map(venv => path.join(checkout, venv,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python")).find(candidate => fs.existsSync(candidate));
  if (!python) throw new Error("Install Hermes with its Python environment first. See the Hermes integration guide for a custom installation.");
  // Electron can read ASAR members; an external Python process cannot open that virtual path.
  const script = fs.readFileSync(path.join(__dirname, "hermes-config.py"), "utf8");
  const result = await runHermesSetup(python, script, JSON.stringify({ coreHome, hermesHome: path.resolve(hermesHome), port: config.port, runtime, makeDefault,
    hermesRoot: checkout, modelForwardingPatch: fs.readFileSync(path.join(__dirname, "hermes-model-forwarding.patch"), "utf8") }));
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { receipt = null; }
  if (!receipt || typeof receipt !== "object") throw new Error("Hermes setup could not run. Check its Python environment and configuration access.");
  if (result.status !== 0 || receipt.error) throw new Error(typeof receipt.error === "string" && receipt.error ? receipt.error : "Hermes setup failed.");
  return receipt;
}

module.exports = { installHermesProvider };
