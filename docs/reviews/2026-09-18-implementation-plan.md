# Upstream follow-through

User request: implement all additions and reliability improvements identified in the September 18 comparison. Baseline: NEKODEX 5.2.0-nekodex.9, 2e07da3. Branch: codex/upstream-v508-complete.

## Requirements (completion must be evidenced individually)

- [x] DIL/PUIK response reader with existing ownership/completion rules preserved.
- [x] Setup preflight budget and ownership-aware MCP bootstrap/handoff/rollback.
- [x] Bounded write_stdin polls, continuation rebinding, broker half-close.
- [x] Historical-only same-thread environment fallback; invalid current updates still fail closed.
- [x] Rate-limit cooldown/pacing, actionable error propagation, Korean dialog recognition.
- [x] Multipart compaction/account budgets; preserve checkpoints and split only safe boundaries.
- [x] Extra High composer rerender recovery before submission, preserving text integrity.
- [x] Opt-in selected skills as UTF-8 attachments with combined attachment/token budgets.
- [x] Local usage dashboard by tier/model with private durable counters and honest limits.
- [x] Separate Pro compaction model selection, exact family/effort validation.
- [x] Opt-in fresh conversation per turn with explicit connector contract.
- [x] Configurable manual submit timer.
- [x] Runtime commit/dirty/build timestamp and honest doctor diagnostics.
- [x] Per-account proxy and new-task routing/pacing additions; existing task affinity preserved.
- [x] Web subagent enable/disable setting without affecting native models.
- [x] Firefox passkey request: implement supported safe flow or document concrete platform limitation, not a pretend Chrome-compatible import.
- [x] Review latest Pro selector refinements against local implementation.
- [x] Development build + focused/manual verification within shared right-size budget.
- [ ] Scoped source commit/push and concrete app handoff; installed versus source outcome explicit.

Unconfirmed upstream incidents are investigation requirements, not a promise to cure upstream safety/service failures. Native endpoint switch PR 544 and Windows-only packaging/CA items need applicability decisions; no unsupported endpoint change. Preserve account data, current production tasks, Native4 contracts and local setup transaction safeguards.

## Verification budget

Shared default maximum: 10 expanded focused cases, 30 seconds per automated check / 60 seconds total; no full suites. Use manual review for remaining paths. Development observation precedes release work. No agents dispatched.


## Implementation evidence and delivery checkpoint

Source changes implement the listed behavior. Existing sticky thread/account ownership and selected/balanced assignment remain; per-account HTTP/HTTPS/SOCKS5/PAC routing and new-turn pacing are additions, not account rotation after a limit. More speculative upstream proposals (switching native service origin, broad safety bypass, Windows-only packaging changes) were not copied into the Mac runtime.

Eight focused scenarios pass (seven in `tests/upstream-v508-focused.test.ts` plus the one `upstream508` environment scenario). They cover accepted usage/restart/deduplication, persistent cooldown, native selected-skill attachments, compaction execution identity, account proxy configuration, Firefox cookie filtering, Web-only delegation filtering, and historical same-thread authority. The environment fixture initially passed the fake Codex home in the clock argument; correcting the fixture made its targeted rerun pass. No broad suite was run.

Core and launcher TypeScript passed. The browser helper and Vite renderer development builds passed. The first Vite attempt used the hardened installed Bun and could not load Rollup's native library because of Team ID validation; the same build succeeded using a task-owned ad-hoc-signed copy of Bun. No installed runtime or dependency signature was changed.

An isolated Electron DEV target used the source launcher and the new renderer at `file:///Users/alex/Dev/nekodex/launcher/dist/index.html`, with a disposable core/Codex home and no copied credentials. It saved manual submission time 180 and Firefox browser selection through actual IPC, rendered the usage panel with zero renderer errors, and the production response observer read `DIL reply preserved` and `const n = 7;` from the DIL/PUIK fixture in Electron. Screenshot artifacts are retained in the task artifact directory. The passing interaction took 2073ms. Controller teardown did not settle within its outer bound; its exact DEV processes were subsequently terminated gracefully. Earlier attempts exposed an overly broad preference guard and an ambiguous first-window selector; both were corrected before the successful observation.

Automated verification wall-time is approximately 58 seconds across type checks, build attempts, focused tests, and bounded DEV observations. The standing 60-second budget is effectively exhausted: do not start additional automated validation, full suites, or repeat successful cases. Remaining delivery/source review uses the obtained evidence and manual inspection. No agents were dispatched.

Evidence limits: actual signed-in Firefox passkey login is unverified (Firefox is not installed on this Mac). The new Firefox path reads only its newly created, closed temporary profile; it filters eligible ChatGPT/OpenAI cookies and the normal Launcher verification still decides whether a session is authenticated. Pro compaction variants, live rate-limit pacing, external proxy endpoints, remote MCP shutdown failures, and cross-platform packages were not exercised against user accounts. The local usage panel reports accepted sends and observed outcomes, not official account quotas; unavailable model versions and manual sends remain unknown. PAC/fixed-proxy URLs do not accept embedded credentials.

Source review after the DEV observation also removed the session-level retained-conversation key when fresh-turn mode is enabled; runtime and session ownership now agree. This small boolean gate was manually reviewed rather than rerunning the passing checks. CLI help was updated afterward (documentation-only).

Installed `/Applications/NEKODEX.app` remains 5.2.0-nekodex.9. No production profile, route, account login, or settings were changed. Source publication and app delivery are still pending at this checkpoint.

## Attribution

Adapted upstream v5.0.8 selected-skill attachment transport and DIL response-root selector, PR #474 compaction execution policy/contract, PR #462 Web-only collaboration filtering, and the ideas/changes in #550, #559 and #567. Preserved existing project licensing and authorship; this integration also contains original NEKODEX account safety, network, usage UI/storage, Firefox capture and lifecycle adaptations.


## Source publication

Implementation commit `637ce65bd0fe497da4a3be4e4d6eb7f1ee8f5e61` was pushed to `origin/codex/upstream-v508-complete`; `git ls-remote` confirmed that exact SHA. Draft review: https://github.com/Froraut/NEKODEX/pull/1. `[skip ci]` prevents additional validation beyond the completed focused budget. Author and committer are FroRaut with the canonical GitHub no-reply address. Unrelated untracked branding inventories and dependency symlinks were not staged.

The app delivery portion of the active goal is not complete: installed NEKODEX is still `.9`; source publication is not installed behavior. Continue from the existing branch/PR and reuse the recorded verification. Do not start another review or repeat tests. Before any package/install work, follow the existing source-ready evidence, preserve production accounts and the active route, and distinguish build/package/install outcomes. Current development runtime tool is `/tmp/nekodex-v508-development-tools/bun` (task-owned ad-hoc copy, not the installed executable); remove it after delivery no longer needs it. The three disposable DEV homes and their exact app processes have been retired. Screenshot evidence is outside Git in the task artifact directory.


## Delivery constraints discovered after publication

The effective `/Users/alex/.codex/config.toml` still routes `openai_base_url` through `http://127.0.0.1:17841/v1`; do not stop or replace its owner casually. Current installed app is the connection dependency. `launcher/scripts/package.cjs` runs platform signing/runtime integrity checks and expects `node` on PATH; `prepare-runtime.cjs` runs the runtime bundler. The task-owned Bun copy can build the renderer without the installed executable's library-validation restriction. Repository stable-release instructions include broad live/platform gates that were not run and are not authorized by the standing small-check policy; local development/alpha packaging must not be described as a verified stable release. Do not auto-trigger CI or full verification to complete packaging.


## Signed prerelease delivery in progress

Prepared version `5.3.0-nekodex.1` at source/tag commit `de79f5d5ec8a41f599acfa393760c219a95dad34`, preserving the existing `nekodex` updater channel. The existing macOS-only release workflow was dispatched explicitly: https://github.com/Froraut/NEKODEX/actions/runs/35353147606. It packages ARM64 and Intel, enforces publisher signatures, notarization, artifact integrity and signed update metadata; no full behavioral suite was added or requested. Version-only source markers and prerelease notes are committed on the same PR branch.

Before delivery, production renderer ID `DC65C370F03C37ADB35B688E6DD4B7E4` at the owned CDP endpoint `http://127.0.0.1:49491` was identified by its exact installed-app file URL. Its snapshot reports version `.9`, production, zero running browser tabs, no active operation, and `authenticated: false` already before update. Native bridge health reports PID 1759, `.9`, accepting turns and zero active HTTP/browser/compaction work. Launcher PID is 1452. These are baseline observations, not evidence that Web login is usable.

Private permission-preserving configuration rollback copies are in `~/.codex/backups/20260918-nekodex-5.3.0-nekodex.1/`. No browser credentials were copied into development profiles. Use the installed updater once the authenticated new release is available; do not replace it with an ad-hoc app or stop the current bridge during active work. The post-update end-to-end native response requirement remains outstanding; do not claim that health alone proves it.


## Publisher result and current installation boundary

Release workflow `35353147606` completed successfully: both macOS builds and the publication job passed. Published prerelease: https://github.com/Froraut/NEKODEX/releases/tag/v5.3.0-nekodex.1. It contains ARM64/Intel DMG and ZIP packages, runtime archives, checksums, signed release metadata and licenses. The installed .9 updater recheck returned `{status: available, version: 5.3.0-nekodex.1}` through the actual production renderer.

The old browser's false authentication state was examined more precisely: its message is `ChatGPT session verification unavailable: session HTTP 403`, and the actual embedded Temporary Chat page says `Unable to load site`. This is not evidence that credentials were erased or the user signed out. `upgradeManagedRuntime()` explicitly refreshes capabilities, and setup calls `inspectLauncherCapabilities()`, so replacing the working native bridge while that condition persists can fail the managed runtime migration. No installation was attempted and no guard was bypassed.

The user was asked to restore ordinary access in the existing NEKODEX Browser, and separately to permit exactly one 20-second native response probe after installation beyond the already consumed shared verification budget. Both answers remain pending; a default-selected option is not approval. Continue independent source integration; keep the goal active until installation and the agreed response evidence are complete (or report a genuine repeated block according to the goal policy).


## Main integration

PR #1 is integrated into `main` by merge commit `32896d1db91f122c8217d7621937588a116c69e0`; the remote main SHA was confirmed. Published tag `v5.3.0-nekodex.1` remains immutable at `de79f5d5ec8a41f599acfa393760c219a95dad34`, whose runtime code is included in main. No additional behavioral checks were triggered. The release workflow watcher completed with success and no task-owned development app remains running.

Only the installed handoff remains: current `.9` continues to serve the native route. Both required user answers (existing ChatGPT access and a single extra bounded native response probe) are still pending. This is the first goal turn in which the external HTTP 403 installation blocker was established; do not mark the goal complete or blocked yet. Revalidate the live state on a later continuation; do not treat silence as permission, and do not re-run source tests.
