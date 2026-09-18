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
