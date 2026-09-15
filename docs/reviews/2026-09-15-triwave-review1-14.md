# Triwave review 1, lane 14 — CLI status

Current source: `3740505b0107af9a83053fd523ae1ad30be36465` (HEAD). Scope: CLI status paths and direct callers, primarily `src/cli.ts` and `src/dev-chat/cli.ts`. Read-only review of current source against `docs/reviews/2026-09-15-four-wave-results.md` and `docs/reviews/2026-09-15-four-wave-adjudication.md`. No tests, typechecks, scripts, broad audits, runtime probes, production actions, code edits, or ABI changes.

## Findings

### T1-14-1 — DEV status misreports a tunnel status probe failure as invalid/missing configuration

**Trigger:** The isolated DEV profile has an otherwise readable valid Full config, but the tunnel status probe cannot complete, for example the managed tunnel-client status command times out or throws from `runCommand`.

**Exact source and direct caller:** `src/dev-chat/cli.ts:315-325` enters one `try` for both `loadConfig()` and, when the loaded mode is Full, `tunnelStatus(loaded)` at lines 317-321. Any exception from `tunnelStatus` is caught by the same handler at lines 323-325, which replaces the already established state with `config = { configured: false, error: ... }`. The status object is then emitted at lines 327-336 with `mcpRuntime` still at its initial `{ required: false, ready: false }` value.

**Consequence:** `codex-chatgpt-web dev status` reports a valid configured Full DEV profile as `config: not ready` and `MCP runtime: not required`, with the tunnel probe exception attached as a configuration error. A caller or operator cannot distinguish “configuration failed to load” from “configuration loaded, but runtime status could not be observed”; the output can lead to a wrong repair action and loses the fact that MCP is required for the loaded Full mode.

**Counterevidence and boundary:** A normal non-ready tunnel response does not throw: `src/tunnel.ts:556-566` returns a structured `TunnelRuntimeStatus` and `parseTunnelStatus` at lines 521-553 converts nonzero/non-JSON results into `ok: false`. This finding therefore requires an exceptional probe path such as a thrown timeout or an unexpected thrown status operation. The launcher descriptor check is independently caught and represented in `launcher`; this finding concerns only the configuration/runtime block. No runtime probe was run.

**Disposition:** Concrete defect; no ABI or connector identity change is needed.

### T1-14-2 — Invalid DEV feature settings make `dev status` fail instead of returning the captured configuration diagnosis

**Trigger:** `paths.configPath` exists but contains malformed or incompatible DEV configuration/settings, such as a JSON document with a version other than 3 or a non-boolean `experimentalBiggerContext`. `loadConfig()` fails while the status command is trying to inspect the same profile.

**Exact source and direct caller:** `src/dev-chat/cli.ts:315-326` catches a `loadConfig()` failure and records it in `config = { configured: false, error: ... }`. After that catch, line 327 unconditionally calls `readDevChatExperimentalFeatures(paths)`. Its implementation in `src/dev-chat/profile.ts:74-93` throws for invalid JSON/settings at lines 86-92 (and can also throw for a non-ENOENT read error at lines 79-84). There is no surrounding catch in `runDevCommand` for this call, so the top-level `main().catch` in `src/cli.ts:570-572` emits only an error to stderr and sets exit code 1; the assembled status at `src/dev-chat/cli.ts:328-337` is never printed.

**Consequence:** The diagnostic command intended to describe a broken DEV profile terminates before producing its JSON or human-readable status. The caller loses the already captured `loadConfig` error, launcher state, path information, and any actionable status fields. A malformed feature preference can therefore mask the broader configuration diagnosis.

**Counterevidence and boundary:** With a valid version-3 settings file, `readDevChatExperimentalFeatures` returns normally; a missing file is intentionally treated as `biggerContext: false` at `src/dev-chat/profile.ts:79-82`. This is limited to an invalid/unreadable feature-settings file and is not evidence of a tunnel, launcher, account, or connector failure. No runtime probe was run.

**Disposition:** Concrete defect; no ABI or connector identity change is needed.

## Reviewed repeats, known limits, and optional improvements

- **Repeats: 0.** The prior lane-14 candidate `R1-14-1` was correctly rejected by adjudication: `src/tunnel.ts:384-398` builds the MCP command from the runtime command, mode contract, and broker socket, without the retired connector `appName`. It is not reopened here. The already accepted D19 launcher-owned `tunnel status` exit-status defect is corrected in current `src/cli.ts:453-455`, which requires launchd service state only for non-launcher ownership.
- **Known limits: 2.** These findings are source-level conditional paths. They do not establish the frequency of tunnel-client probe timeouts, malformed settings in user homes, live launcher/account behavior, or ChatGPT connector attachment. The current status code intentionally does not perform a second network or process-health verification.
- **Optional improvements: 0.** No style-only, speculative, future-schema, or ABI-related change is counted.

Counts: **2 concrete findings (T1-14-1, T1-14-2); 0 repeats; 2 known limits; 0 optional improvements.**
