import { parseAcceptanceOptions, runAcceptance } from "../src/acceptance";

const help = `Usage: bun scripts/acceptance.ts [options]
Default: versioned offline fixtures only; no browser, account, installed app or network.
  --local-startup                 Temporary local daemon + one synthetic response.
  --local-codex <executable>      Isolated existing Codex catalog smoke; no live task.
  --live-session                 Inspect the owned automatic launcher account; no send.
  --live-prompt --prompt-count 1  Exactly one fixed browser-only marker prompt, no tools/retries.
  --model high|extra-high|pro     Live prompt effort, default high; no fallback.
  --timeout-ms 1000..300000       Live operation deadline, default 120000.
  --require <scope>              Declare a required gate without authorizing it to run.
  --reported-codex passed|failed Operator report, never a verified live Codex pass.
  --reported-mcp passed|failed   Operator report, never a verified live MCP pass.
Scopes: offline-fixtures, local-startup, local-codex-catalog, live-session,
        live-chatgpt, live-codex, live-mcp.
JSON stdout contains only fixed scope outcomes, booleans/counts and selected model.
Exit 0 means every required scope was directly verified; skipped/reported required gates fail.
`;
if (process.argv.slice(2).includes("--help")) {
  process.stdout.write(help);
} else {
  try {
    const options = parseAcceptanceOptions(process.argv.slice(2));
    const report = await runAcceptance(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.requiredChecksPassed ? 0 : 1;
  } catch {
    process.stderr.write("Acceptance arguments are invalid. Run with --help; no checks were authorized.\n");
    process.exitCode = 2;
  }
}
