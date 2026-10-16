# Final browser and Codex Native6 review — 2026-10-16

Independent source review covered the browser repair from e820daa1 through6330d16f: account selection/proof identity, API navigation and POST ownership, background-check cancellation, and DOM turn identity. One material P2 finding was confirmed and corrected.

## Pending session verification after window loss

`bindMutationSettlement` treated `did-finish-load` as terminal before its asynchronous session verification completed. The close wrapper then ignored cancellation, and the renderer-crash listener had already been removed. An account could remain blocked until verification timed out.

The correction separates finishing from terminal settlement. Verification starts once, while window closure or renderer death can still fail the exact lease. Terminal cleanup remains idempotent and a late verification cannot apply stale identity.

Three focused cases passed, including the new close/crash regression and the existing renderer-death and retained-lease cases. A separate development Electron fixture used actual BrowserWindows and WebContents with the real session-mutation coordinator: both closing the loaded window and deliberately crashing only its renderer immediately released admission and rejected the late result. The fixture used an isolated temporary profile and a local page, without account or network access. No broad suite was run.

## Codex Native6 contract and live catalog

- The active installed core is now6.1.32. Both real account MCP processes use `--native6 --async-tool-operations`.
- Native6's public schema and MCP implementation are unchanged from the prior6.1.31 baseline. The active installed MCP server's complete tools/list exactly matches the published snapshot:11tools, SHA256 `f3cb39ea257158734d12eaed810d9a573cb0d32e53f775225158e66319e7218f`.
- The actual ChatGPT connector details show all11tools, including `codex_tool_start`, `codex_tool_poll`, `codex_tool_status` and `codex_tool_cancel`. The earlier count of7 was incomplete; there is no confirmed cached-schema mismatch.
- Official tunnel-client latest release remainsv0.0.16, matching the installed SDK. The current account tunnels are ready, and the recent real Pro/Instant command results and Pro image result remain applicable.
- A Native7 migration, connector recreation or permission expansion is not required. The existing connector identity and Allow low-risk setting were retained. Its app description was updated to describe the local Codex tools clearly.

Local fixture receipts and account-specific observations remain outside Git under `/tmp/nekodex-final-review-20261016`. No keys, cookies, prompts or account identifiers are committed.

## Local delivery

The corrected local app6.1.32 was installed from code85d5a4d1; the installed module hash matches the source exercised by the native Electron fixture. The existing signing identity was retained and deep/strict signature verification passed. App SHA256: `15db6d93d2660fdb8033dee02ff8a2a3a5ebd430fe4ceef2dbedc215083e1efa`.

The active6.1.32 core remained running throughout interface replacement. Afterwards both account tunnels were ready, Native and Web admission were available, and the selected account again showed Models and Local tools Verified with no active browser task. One prior app is retained as an archive outside app discovery; temporary fixture data and duplicate app bundles were retired. This is a local update without public installable release assets.

Durable receipts: `~/.local/share/nekodex/verification/final-review-native6-20261016/`.
