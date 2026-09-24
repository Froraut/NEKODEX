# Browser publication and observation ordering

Baseline: `f858e66ea204e1e983ccfd4ad7889d6d0500115f`. This pass reduces repeated
browser/account snapshot construction and fixes stale UI observation races.

## Findings and changes

1. A pooled BrowserHost constructed its own snapshot before calling a callback
   that ignored the argument and constructed the aggregate pool snapshot again.
   `publishBrowserSnapshot` now signals the pool through an explicit publication
   port. Standalone hosts keep the original synchronous callback contract.
   Manual turn, lifecycle and existing-Chrome progress publishers use the same
   helper; no transition/receipt ownership moved into it.
2. Each synchronous browser change published a full cross-account history.
   `createSnapshotPublisher` coalesces presentation changes with `setImmediate`
   and reads current state only at flush. Authentication-evidence invalidation
   stays synchronous. Destroy cancels queued work; a failed projection is logged
   and does not prevent a later publication. Direct state/setup handlers in main
   route through pool publication so every notification advances its revision.
3. The account hook rejected a read whenever a notification arrived during the
   wait, even if the host had captured that read after the notified change. The
   new controller uses optional source/revision stamps shared by browser/account
   observations to accept a read that already covers the event. Delayed duplicate
   notifications do not cause another query. Mutation receipts and explicit or
   operation-driven refreshes still fence older requests. Older host revisions,
   replaced sources and late failures remain rejected. Legacy unstamped producers
   retain their conservative behavior.
4. App's startup merge always preferred a pending browser event, even when the
   initial snapshot was newer. Live events likewise could replace a newer state.
   The shared observation helper now keeps the newest same-source browser state;
   equal revisions retain identity. Different sources/legacy states retain arrival
   handling in App, while the account controller also tracks retired sources.
5. Account availability scanned all reservations separately for each account.
   One grouped pass now preserves each account's active-plus-reserved count.

These stamps are presentation freshness metadata. Existing authentication,
operation-lease, task ownership, cancellation, durable journal and admission
checks remain the authoritative boundaries. Presentation batching does not delay
those checks or the operation-error channel.

## Measurement

`node launcher/scripts/measure-browser-publication.cjs f858e66` compares the actual
baseline/current host state setter and pool snapshot/publication methods. Native
views are inert fixture ports: four accounts, 128 history rows each, four event-loop
bursts of 16 synchronous changes. The final snapshots match exactly after excluding
the new observation stamp, and both contain all 512 task rows.

| Measured work | Baseline | Current |
| --- | ---: | ---: |
| Host snapshot constructions | 128 | 4 |
| Aggregate snapshot constructions | 64 | 4 |
| Presentation publications | 64 | 4 |
| JSON representation of published state | 10,744,628 bytes | 671,780 bytes |

Publications and equivalent JSON volume fell about 93.75% in this burst workload.
The JSON size is not a measurement of Electron's binary IPC wire format. Events
spread across separate event-loop turns coalesce less. This comparison does not
establish application-wide CPU/RAM, startup or provider-speed improvements. The
new payload includes a small source/revision stamp, and the current renderer main
chunk remains below 500 kB (about 495.3 kB).

## Focused verification

Eighteen distinct behavioral cases passed:

- Four controller/merge cases: startup/live ordering and legacy compatibility;
  an overtaken but current read; mutation/stale-read fencing; replacement-source
  recovery and ignoring late shutdown failure.
- Three publication cases: actual pooled-host bursts, immediate authentication
  invalidation, pending-work disposal, standalone compatibility, recovery after a
  projection error, and reservation counts (connected assertions within cases).
- One existing account snapshot case: selected-only navigation, all-account
  identity/task projection, closed-account history and queue data.
- Three existing account-hook cases: legacy event/read race, failed refresh with
  retained evidence and mutation receipt, and account-handoff identity changes.
- Three existing lifecycle cases: failed terminal journal/retry, Manual shutdown,
  and automatic allocation/progress preserving failed submitted documents.
- Two existing Chrome cases: declined-consent settlement and safe failure progress.
- One compiled UI flow: an older pending startup event cannot replace a fresh
  signed-in snapshot; a covering account read settles with one query; 40 old
  notifications do not regress sign-in or add reads; a new revision does refresh.
- One real source Electron case: shared pool source and monotonic revisions through
  preload IPC, seven screens, Russian locale loading and saved-language IPC. No
  page errors; temporary DEV process/profile removed. This uses an empty disposable
  Manual profile, not a live provider session.

Renderer type checking and the 118-module development build passed. Changed
Electron files passed syntax checks. Main's three mode/setup publication call sites
were reviewed as the same pool-owned path; no real setup/tunnel operation was run.
Architecture map/link checks accompany this change. No full suite was run.

Raw local evidence is in ignored `launcher/output/architecture-refactor/` and
`launcher/output/playwright/architecture-refactor/`. Version remains
`5.9.0-nekodex.5`; no installed-app replacement, release, account change or provider
submission is part of this pass.
