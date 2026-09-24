# Launcher PR review, 2026-09-24

Source: saved public PR snapshots in `/Users/alex/Dev/nekodex-upstream-v6-evidence-20260924/items/`. This lane reviewed the recorded patch and current extracted launcher modules; it did not cherry-pick upstream commits or modify the installed application.

| PR | headSha | sourceUpdatedAt | Decision |
| --- | --- | --- | --- |
| [#654](https://github.com/miuuyy/codex-chatgpt-web/pull/654) Restore offscreen window | `1cb4acb6461a80765e7c1bfb446fc7b16cdf9f5f` | `2026-09-23T20:59:56Z` | Adapted in `launcher/electron/window-state.cjs`. A saved position is retained only when at least 96 px of the window width and 32 px of its 46 px title-bar region remain within a display work area. Invalid positions retain the saved size and reset placement. |
| [#656](https://github.com/miuuyy/codex-chatgpt-web/pull/656) Recover rotated Activity | `90adf9dc9f37349cfef85448536bb9d72d4449b7` | `2026-09-23T20:59:58Z` | Adapted in `launcher/electron/logging.cjs`. Startup reads the rotated log before the active log, validates and sanitizes records, and retains the latest 300. Each file read is limited to its final 4 MiB, so an oversized legacy file cannot cause an unbounded startup read. |
| [#658](https://github.com/miuuyy/codex-chatgpt-web/pull/658) Protect diagnostics export | `f3173055eea2976aebdd4cb3c62faeb3ac0f489c` | `2026-09-24T12:29:33Z` | Adapted in `launcher/electron/logging.cjs`. Export rejects destinations with the same resolved file identity as the active or rotated source, including symbolic and hard links. It writes a private temporary file and atomically replaces the selected destination entry, preserving source bytes even if an alias is swapped in after the identity check. Existing redaction and the launcher's IPC guard remain in use. |

Changed paths: `launcher/electron/window-state.cjs`, `launcher/electron/logging.cjs`, `launcher/tests/window-state.test.cjs`, `launcher/tests/logging.test.cjs`, and this review. The existing `main.cjs` export handler already calls `exportSanitizedLogs`; no integration patch is needed. No runtime import or module ownership changed, so the generated architecture map is unaffected.

Focused verification: `node --test launcher/tests/window-state.test.cjs launcher/tests/logging.test.cjs` and `git diff --check` on these paths. The cases cover invisible title bars, rotated ordering and the 300-record limit, an oversized legacy log tail, and hard/symbolic aliases to both source logs. These are source tests; no installed-app or live-account result is claimed.

## Model review lane

Reviewed the parent's in-progress `src/chatgpt-web-models.ts` and `src/model-catalog.ts` against the source and catalog contracts. Added focused cases only to `tests/model-catalog.test.ts` and `tests/chatgpt-web-models.test.ts`; no model source or shared ledger was edited in this lane.

- The native catalog rows remain unchanged in order, including a leading Astra, Sol and Luna fixture. The original five fixed Web rows retain their order ahead of all five named additions. The bounded Compatibility V1 subagent roster still contains native Sol and the same first four fixed Web rows.
- Named Sol Instant has its separate low budget; named Sol groups Medium, High and account-eligible Extra High only when their context and compaction limits match. A deliberately mixed low/high row is rejected. Named Luna exposes Low and Medium on Luna-only accounts; the two named Pro routes require Pro and accept Max. Unsupported efforts and unavailable account capabilities are rejected, while the legacy fixed slugs continue ignoring conflicting client effort.
- The current `server.ts` request router passes client reasoning to route resolution and forwards the selected 5.6/6 family without rewriting the raw client body. The added test covers this integration. No actionable defect was found in the two reviewed model source files at this revision. Runtime browser selector behavior and live account entitlement remain for the parent's integrated verification.

Verification: one run of `bun test tests/model-catalog.test.ts tests/chatgpt-web-models.test.ts` passed **35/35** cases (191 assertions). `git diff --check` on the two test paths passed before the run. These are source-level fixture checks, not installed-app or live-account proof.


Parent integration resolved the conversation-policy counter-review findings using
one lifecycle lease, account reservation checks, and an account-pool recovery
blocker. After a committed policy with a failed projection, unrelated admission
reopen calls cannot resume turns; retrying the setting successfully reconciles
state and clears only that blocker. Focused transition fixtures exercised both
competing operation admission and the post-commit failure boundary.
