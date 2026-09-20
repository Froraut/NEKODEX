# Full backend and frontend review — 2026-09-21

Base: `d6f8733` (merged PR13–15), source branch `codex/full-stack-stability-review`.
This is an integrated source review and improvement batch. It does not publish a new installer or
replace the installed application. Native6's public tool contract remains unchanged.

## Coverage and ownership

Five disjoint Sol lanes reviewed native transport; the Responses/browser/MCP bridge; updates and
runtime installation; accounts, quota and storage; and all frontend screens. The parent reviewed
main-process composition, supervisor/tunnel ownership, configuration transitions, shared UI wiring
and architecture documentation. The parent owns all runtime checks; workers did not run test suites,
builds, live account operations or release work.

- [Native transport](full-stack-20260921-native.md): request/response forwarding, redirects, body
  rejection, cancellation, proxy fallback, telemetry and native independence from GUI availability.
- [Bridge](full-stack-20260921-bridge.md): browser acquisition/pre-send stages, continuation and
  compaction ownership, Native6 operation replay/result delivery/acknowledgement, retry retention.
- [Updates](full-stack-20260921-updates.md): authenticated downloads, progress, staged identity,
  readiness, recovery registration, cancellation and extractor ownership across platforms.
- [Accounts and storage](full-stack-20260921-accounts.md): session/epoch identity, official sign-in,
  quotas, proxy mutation exclusion, read cancellation, durable writes and usage recovery.
- [Frontend](full-stack-20260921-frontend.md): Overview, Accounts, Browser, Activity, model/tool
  Connections, Settings, Updates and onboarding, including retry, busy and localized states.

## Architecture decisions

Retain the current separation between the persistent native daemon, browser/account pool, tunnel
supervisor, configuration-generation journal and UI. Replacing them all or renaming the public
connector to Native7 would not solve the observed local ownership defects.

Add one launcher lifecycle admission owner for startup, update preparation and exit. It fences new
mutating IPC commands before any asynchronous work can yield, passes exact ownership from the
updater to quit, and releases only its own lease after precommit cleanup. Cancellable observations
and window layout remain available. The context queue also defers while this owner exists.
The renderer consumes the same transition state, using shared lifecycle types rather than its old
duplicate interfaces. Snapshots avoid proof reconciliation while a transition owns the graph.
Native Quit during startup is retained and coalesced until that owner settles; full-stop intent
dominates ordinary interface exit/restart.

Read-only account quota requests use a separate cancellable lease: active and new browser turns
remain usable, while proxy/login/logout mutations cannot cross an account-token read. Holding the
existing exclusive account-operation lease for quota was rejected because it unnecessarily stopped
work. Likewise, startup authentication is kept as a separately cancellable inspection rather than
holding the global startup owner until a slow browser inspection finishes.

Update preparation has an explicit cancellation boundary before worker handoff. Download and
extraction cancellation must settle their physical owners before deleting staging. Unproven
extractor exit preserves evidence and reports failure. Committed worker replacement remains owned
by the updater's existing rollback/readiness transaction.

## Verification and counter-review closure

- Three focused lifecycle-admission cases passed. An isolated Electron main/preload/renderer flow
  then proved startup mutation fencing, snapshot purity, a queued single SIGTERM, cancellation and
  joining of a stalled read-only inspection, and shutdown mutation fencing (0.68 seconds).
- A second actual Electron flow exercised the real update IPC and renderer against a controlled
  preparation owner: mutation exclusion, cancellation while the lease remains held, pending cleanup,
  a normal `false` installation result, and restored actions without an app restart (0.706 seconds).
- Three native cases passed. The initial background-proxy fixture reused Bun's cached import; only
  that failed case was repeated in an isolated subprocess after correcting the fixture.
- Four bridge cases passed: browser acquisition cancellation, pending compaction-token cancellation,
  submitted-but-unconsumed control expiry, and retry-capacity rejection without resetting an existing
  exhausted budget. The latter two took 217 ms together including command startup.
- Three quota/storage cases passed: readiness before a cancellable read lease, concurrent-turn
  compatibility with mutation exclusion and quit settlement, and an injected post-rename directory
  sync failure preserving live proxy, memory and disk consistency. The quota-read assertion also
  verifies that a read is absent from the global mutation veto. Backup-recovery's existing targeted
  case passed with the new Windows-safe quarantine rename.
- Ten updater cases passed, covering runtime file boundaries, progress restart, readiness identity,
  Linux recovery arguments, cancellation during metadata/download/extraction, unproven cleanup,
  worker-handoff refusal, and a real owned child that delays exit after SIGTERM. The real-child case
  took 639 ms including command startup and confirmed no surviving PID or late staging write.
- Root TypeScript and renderer typecheck/development bundle passed. The renderer retains its existing
  large-chunk advisory; it is not an installer build.
- Twenty-three synthetic UI scenarios passed across every main screen, ordinary/development profile
  differences, localized/invalid timestamps, retries, Manual confirmation, transition locks,
  cancellation and quota-read session mutation locks. The default whole-screen pass was followed
  only by changed or fixture-corrected scenarios. Screenshots were visually reviewed. Synthetic
  quota/history values are not live account evidence.

Independent counter-review corrections were integrated before handoff: retain unexpired retry
budgets; memoize browser disconnection; distinguish account read leases from mutation vetoes;
distinguish a committed rename from uncertain durability; make snapshot reads pure during a
transition; retain startup quit intent; align disabled UI controls with admission; and verify the
absolute Windows taskkill path and cancellation-helper exit. A null identity probe is treated as
unknown, not as process-exit evidence.

The UI harness initially used the Node Electron entry instead of the Electron built-in, then an
uncanonicalized macOS temporary path in Vite's allowlist. Both fixture errors were corrected before
product assertions. Three later fixture failures were a stale CSS selector and impossible terminal
login fixtures that still claimed an active login/signed-in account. Only those cases were repeated.
The lifecycle fixture initially lacked valid proof metadata and then changed a separate cached
state-store instance; it was corrected to seed the actual isolated main-process store. These are
verification-harness corrections, not hidden product failures.

## Delivery and limits

This source batch uses incremental commits and one combined PR. No release version bump, installer
publication, production application replacement, live provider login/quota call, or general test
suite was performed. The local skill's architecture reference was corrected to the current Native6
and background-daemon contracts; its unrelated procedures and authorization rules were preserved.

POSIX process cancellation was exercised on macOS. Windows/Linux-specific validation was checked
through targeted fixtures and source review, not live installed-platform runs. Directory-entry
flush is not claimed on Windows; POSIX post-rename uncertainty remains visible through a sanitized
process warning. Synchronous package trust validation remains bounded and cancellation is checked
again before any installer worker starts. Existing signed archive metadata remains the trust root;
independent checksum-text authentication was not promoted because archive validation already binds
the downloaded asset directly to its signed digest.

The review improves the proven boundaries and preserves the current working separation of
responsibilities. It does not claim that every future OS, filesystem, upstream service or browser
UI failure is eliminated. The installed application receives these source changes only in a later
combined release.
