const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

function installHermesProvider({ coreHome, config, runtime = "codex_responses", makeDefault = false, hermesHome = process.env.HERMES_HOME || path.join(os.homedir(), ".hermes") }) {
  if (!config || config.mode !== "full" || config.browserInteractionMode === "manual") {
    throw new Error("Connect ChatGPT tools in Automatic mode before adding Hermes.");
  }
  const checkout = path.join(os.homedir(), ".hermes", "hermes-agent");
  const python = ["venv", ".venv"].map(venv => path.join(checkout, venv,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python")).find(candidate => fs.existsSync(candidate));
  if (!python) throw new Error("Install Hermes with its Python environment first. See the Hermes integration guide for a custom installation.");
  // Electron can read ASAR members; an external Python process cannot open that virtual path.
  const script = fs.readFileSync(path.join(__dirname, "hermes-config.py"), "utf8");
  const result = spawnSync(python, ["-c", script], {
    input: JSON.stringify({ coreHome, hermesHome: path.resolve(hermesHome), port: config.port, runtime, makeDefault,
      hermesRoot: checkout, modelForwardingPatch: fs.readFileSync(path.join(__dirname, "hermes-model-forwarding.patch"), "utf8") }), encoding: "utf8", timeout: 20_000,
    maxBuffer: 64 * 1024, windowsHide: true,
  });
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { throw new Error("Hermes setup could not run. Check its Python environment and configuration access."); }
  if (result.status !== 0 || receipt.error) throw new Error(receipt.error || "Hermes setup failed.");
  return receipt;
}

module.exports = { installHermesProvider };
