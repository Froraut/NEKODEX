# Performance and architecture follow-up

Baseline: `f0a267b30674d6de5a25bfdac0f3a02d74e47a9c` on
`codex/architecture-refactor-20260922`. This pass addresses avoidable launcher
work: eager screen loading, root React updates for logs, redundant browser
navigation observations and repeated usage calculations. It does not claim a
percentage improvement in total application startup, memory or provider speed.

## Changes and ownership

- `deferred-surface.tsx` owns loading/error presentation for Accounts, Settings,
  Task Center, Activity and Updates. Their code loads on first navigation.
  App retains startup, subscriptions and shared operation state. Shared navigation
  labels do not import feature modules. A failed module fetch leaves navigation
  alive and offers an explicit renderer reload (a failed import promise may be
  cached by Chromium). Reload is a user action, not an automatic restart.
- `launcher-log-store.ts` retains the last 300 ordered records with stable row
  IDs, reconciles initial snapshot/event overlap using a set, and notifies only
  subscribed views in 100 ms batches. It schedules no notification timer without
  listeners and cancels the timer when the last listener leaves. Overview and
  Activity consume it directly; unrelated screens and the shell no longer update
  for each log. Durable logging and immediate task/error/lifecycle IPC are unchanged.
- Activity reuses a time formatter within each projection, preserves row identity
  when prepending records, and memoizes UsageDashboard so log events/search do
  not recompute its report. Search/filter/focus and the current 300-row retention
  behavior remain intact; animation-frame suspension does not stop log delivery.
- `account-browser-snapshot.cjs` separates cross-account display projection from
  pool ownership. Pool snapshot creation observes native navigation only for the
  selected host and uses `BrowserHost.turnTabSnapshots()` for other accounts.
  Previously it called full snapshot once for the selected account and once for
  every host, including the selected host again. It still obtains fresh task,
  queue, workspace and account identity data; no session cache or new owner exists.
- Usage reports reuse filtered receipts and one detached duration sort for median
  and p95, globally and per diagnostic group. Persistence, coverage/unknown token
  semantics, account filters and future-day exclusion remain unchanged.

## Comparative evidence

The same production-built renderer fixture and Chromium installation were used
before and after. Synthetic IPC emits 120 log events, 5 ms apart, after the
screen settles. React's commit hook records actual commits. Values below describe
this local sample, not a timing SLA or a live-account benchmark.

| Measurement | Before | After |
| --- | ---: | ---: |
| JavaScript requested for initial Overview | 828,555 bytes | 738,853 bytes |
| Same initial JavaScript, gzip comparison | 262,291 bytes | 235,417 bytes |
| Settings React commits for 120 log events | 120 | 0 |
| Activity React commits for 120 log events | 120 | 7 |
| Activity rows after 120 offscreen + 120 visible events | 240 | 240 |

Initial JavaScript is 10.8% smaller (10.2% gzip). This is a deferred-work reduction,
not a reduction in the sum of all feature chunks; opening those screens still
loads their code. The existing main-chunk >500 kB build advisory remains.
The gzip figure is a size comparison, not a claim about Electron file transport.

`measure-usage-projection.cjs f0a267b` compares actual baseline/current projection
functions, asserts complete output equality, then alternates seven measured runs
after two warmups. The final fixture uses 10,000 synthetic receipts per source,
within both source retention limits, with matching lifetime aggregates:

| Projection | Baseline median | Current median | Reduction |
| --- | ---: | ---: | ---: |
| Web | 4.975 ms | 3.483 ms | 30.0% |
| Native | 4.245 ms | 3.155 ms | 25.7% |

An initial exploratory 12,000-receipt fixture also matched outputs but exceeded
the Native store's 10,000-receipt cap. The numbers above use the corrected fixture;
no store limits were changed. Timings depend on history shape and machine load.
These are synchronous projection CPU measurements, not disk or end-to-end times.

The account pool fixture uses actual pool/host methods with two live hosts and a
closed-account ledger. It proves one full navigation observation, both accounts'
correct tab identities/selection, retained task ordering and unavailable-history
warnings. Background-host navigation reads are rejected by the fixture.

## Focused verification

Ten distinct behavior scenarios passed:

1. Two log-store cases: startup reconciliation, bounded ordered bursts, stable
   records, cancelled notifications and offscreen/return behavior.
2. One account snapshot case: actual pool composition, selected-only navigation,
   all-account tabs/tasks, closed-account retry semantics and queue/health rows.
3. Four existing usage cases: detached rows, future-day exclusion, unknown versus
   zero tokens, mixed outcome coverage, account filters and grouped diagnostics.
4. Two compiled renderer scenarios: all five deferred screens, 300-row retention,
   filter/focus/row identity during new logs without animation frames; an injected
   failed feature fetch with preserved navigation and successful explicit reload.
5. One actual source Electron run through real preload/snapshot IPC, using a
   temporary isolated Manual DEV profile: Overview, Accounts, Task Center,
   Connections, Activity, Updates and Settings. Each screen is awaited, not merely
   clicked. No page errors, no horizontal overflow, no created core config.
   The Settings screenshot was inspected; the owned process/profile were removed.

Launcher TypeScript checking and the 108-module renderer build passed. The
architecture map/check and changed Electron syntax checks are included with this
change. The comparative probes are explicit developer tools, not added background
tasks or default test batteries. No full repository/package suite was run.

Reproduction from the repository root:

```sh
bun run --cwd launcher build:renderer
node launcher/scripts/measure-ui-work.cjs
node launcher/scripts/measure-usage-projection.cjs f0a267b
bun test launcher/tests/launcher-log-store.test.ts
node --test launcher/tests/account-browser-snapshot.test.cjs launcher/tests/usage-report-projection.test.cjs launcher/tests/usage-diagnostic-groups.test.cjs
node --test launcher/tests/performance-ui-preview.cjs
node --test launcher/tests/architecture-refactor-electron-preview.cjs
```

Local raw evidence lives in ignored `launcher/output/architecture-refactor/`
and `launcher/output/playwright/architecture-refactor/`. Runtime version stays
`5.9.0-nekodex.5`. This source/DEV work does not replace `/Applications/NEKODEX.app`,
publish an installer, change account/tunnel configuration or submit provider turns.

## Further candidates

The initial graph still includes shared multilingual copy and the primary browser,
setup and onboarding surfaces. A future measured pass can split locale loading
with explicit startup/language-change fallback, inspect IPC snapshot size under
large real task histories, and profile browser observation CPU with an isolated
authorized workload. Those require their own measurements; increasing concurrency
or reducing readiness/cancellation checks is not a demonstrated optimization.
