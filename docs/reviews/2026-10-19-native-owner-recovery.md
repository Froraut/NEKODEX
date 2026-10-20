# Native stale-owner recovery and shell document lifetime

P23 now exposes an explicit recovery plan and separately confirmed durable action.
Only proven stale Native ownership markers can be archived; authentication and
original action journals are outside the mutation. A partial archive remains
unknown and held. Exact receipt lookup reconciles an existing action without
renaming more markers or replaying an old effect. See the
[recovery contract](../design/native-owner-recovery.md).

The macOS observer uses the actual pinned Bun/libproc boundary. Candidate Native
processes, incomplete evidence and uncertain states block recovery. An unrelated
path lookup refusal can be excluded only through paired kernel accounting-name
evidence; additions are fully inspected and removals require strict ESRCH.
The fixed observer source hash participates in the reviewed plan identity.

The shell fixes a related lifetime gap: viewport registration belongs to one main
renderer document. Main-frame replacement/reload/crash revokes cached registration
in both AccountBrowserPool and BrowserHost. Existing views remain offscreen until
fresh registration. Queued renderer intent is checked before IPC and again before
showing the browser; cleanup cannot invalidate a newer intent.

## Focused development evidence

| Boundary | Evidence |
|---|---|
| Recovery transaction and failure handling | Seven retained cases / 60 assertions passing; no full target replay |
| Kernel identity and bounded inventory reconciliation | One new deterministic case / 38 assertions passing |
| Actual macOS libproc with original owned Bun | One case / five assertions passing; runtime hard link count two, no copied replacement |
| Existing authority and IPC | 14 cases / 138 assertions retained passing |
| Recovery panel, actual React in Chrome | One case / 22 assertions passing; isolated fixture did not serve application CSS, so this is behavioral evidence |
| Surface command queue | One case / four assertions passing |
| Actual Electron shell document reload | Process/session/drafts preserved; old registration revoked, activation alone cannot reuse old bounds; fresh bounds accepted; same-document/subframe and obsolete-window events leave the current registration intact |
| Actual main executable pins | Reviewed 446,394,224-byte worker, official CLI and original 63,558,256-byte hard-linked Bun admitted; complete real process observation safely refused archival while two matching production CLI children remained live |
| Final development build | Root and renderer TypeScript passed; staged Vite renderer built 201 modules; main syntax and architecture map checks passed |
| Live DEV window | Correct explicit core storage home verified; 11 previous tasks, four retained dialogs and cached 10-model account catalog visible. Actual Cmd+R and restored Codex page showed no ChatGPT overlay; account execution remained closed |

The initial expectation of a successful actual-main-pin archive was not met.
Those existing CLI children belong to production tunnel-client owners and were
preserved. No recovery action ID or archive mutation was issued in that attempt;
the disposable metadata was removed after recording the expected refusal.
Positive archival with all actual main pins remains unverified on that live host.
It must not be inferred from the controlled transaction cases or the separate
actual macOS observer case. No authentication or inference request was sent.

The private launcher initially omitted the core storage environment, which showed
an alternate empty task list; a subsequent GUI launch was refused by the existing
DEV/production home equality guard. Both failed launch owners were reconciled
before replacement. The corrected core now asserts its exact storage home, and
GUI profile resolution is checked before launch. Existing tasks and dialogs were
then verified through the visible application. The user-selected DEV pair remains
open, while superseded processes and the prior renderer output are removed.

This batch is source/development work. It does not establish installed-app
delivery, Windows/Linux recovery support or completion of the full adoption set.
