# Launcher interface hardening

Date: 2026-09-20  
Branch: `codex/nekodex-product-hardening`  
Owner scope: `launcher/src/**`

## Findings implemented

### Reporting-period chart omitted zero-use days

The former chart rendered only dates present in stored rows and stretched those dates across the
whole width. A single active day in a 90-day range therefore looked like a full-period series. The
dashboard now consumes the report period, creates exactly 1, 7, 30, or 90 calendar entries, and
fills absent dates with zero. The visual chart is hidden from assistive technology and has a
toggleable table containing the exact daily values.

### A transient refresh failure erased the last trustworthy report

Usage reports are now cached by the exact `source + days + accountId` filter. A failed background refresh
keeps the last successful report for that same filter and labels it as stale. Switching filters
cannot render the previous account's report under the new selection; an uncached selection shows
its own loading or error state. The renderer retains at most the twelve most recently refreshed
filter reports, so exploring account/range combinations does not create an unbounded session cache.

### Repeated update activation could show a false failure

The renderer now takes a synchronous `installPendingRef` lock before invoking installation and
mirrors it in state so the button and progress presentation disable immediately. A second click
cannot reach the host while the first invocation is crossing IPC. Published download, verification,
and installation states clear an obsolete renderer error. Existing `UpdateProgress`, `Updates`, and
NEKODEX progress CSS were retained and integrated.

### Modal dialogs did not contain or restore focus

The tutorial-video and Bigger Context dialogs now share one lifecycle: focus enters the dialog,
Tab and Shift-Tab stay inside it, Escape closes it, non-dialog siblings become inert, and focus
returns to the element that opened it. The behavior also survives React Strict Mode effect cleanup.

### Composite selection controls lacked their advertised keyboard behavior

The settings language picker is now a native `select`. The remaining visual radio groups use one
tab stop and implement Arrow keys plus Home and End. The Zero Risk popover focuses its selected
radio when opened and restores focus to its trigger when closed.

## Rich local statistics interface

The Activity page now supports separate Web and Native sources plus 1, 7, 30, and 90-day ranges.
Web supports all-account or per-account filtering; Native disables that filter because native token
accounts are not known to be browser accounts. Account labels, including labels that happen to be
email addresses, are shown only in the onscreen selector. Web totals are accepted browser messages,
including context stages. Native totals are requests observed through the native proxy. The two
sources are never combined into a misleading total and neither claims universal native-model usage.

Reports expose total, completed, failed, cancelled, incomplete when supplied, and unrecorded.
Incomplete is a distinct Native outcome and is never folded into success or failure. Per-model
aggregation and CSV subtract incomplete from unrecorded just as the top-level and calendar reports
do. Web keeps incomplete at zero for compatibility.

The completion-rate card names its source-specific denominator. Web uses completed divided by
completed + failed + cancelled; Native additionally includes incomplete. Unrecorded outcomes are
shown separately and explicitly excluded. Duration cards report accept-to-outcome median and p95
only for source-appropriate observed samples, alongside the exact sample count. The UI does not
display model provenance, so configured and measured model identity cannot be
confused while the backend contract is still being coordinated. Optional unique-owner counts are
typed as observed browser runs with message sample coverage; they are never labelled as exact
logical Codex tasks because retries or helper replacement can change the owner hash.

Dates are formatted with the selected NEKODEX language passed explicitly from `App`. Backend
`timeZone` and ISO day buckets define the reporting period; renderer date formatting uses the ISO
calendar day without shifting it, and CSV always retains the stable ISO value.

Failure breakdown accepts the Web allowlist plus the Native public report categories for HTTP auth,
rate limit, client/server responses, transport, stream, protocol, abort and unknown outcomes. The
renderer maps those bounded codes to localized labels and never renders raw failure text.
The CSV is generated from the displayed aggregate report. It includes source, `all` or
`selected-account` scope, aggregate outcomes including incomplete, full daily buckets, public model
counts, duration samples, optional reported token totals, and allowlisted failure counts. It excludes
account IDs and labels, receipts, traces, credentials, routes, raw prompts, responses, and exception
messages. Missing token reports and optional cached/reasoning fields remain blank in CSV and use an
em dash onscreen rather than being converted to zero; reported and unreported sample counts remain explicit. Cached-input
and reasoning totals also show their own optional field-level sample coverage.

## Localization

The richer dashboard copy is present in English, Simplified Chinese, Japanese, Russian, Korean,
and Traditional Chinese. Labels preserve the distinction between accepted browser messages,
known outcomes, unrecorded outcomes, and observed accept-to-outcome duration samples.

## Backend integration contract

The renderer calls `usage({ days, source, accountId? })`, defaults to `source: "web"`, and omits
`accountId` for Native. Every report must echo `source`. Native may add optional `incomplete` to
metrics, calendar rows and grouped rows; its `knownOutcomeTotal` and completion rate must already
include incomplete in the denominator. The renderer deliberately does not reconstruct that rate.

Native token data is consumed from optional public `tokens`. `reportedSamples` and
`unreportedSamples` are required when that object exists; cached-input and reasoning totals plus
their field-level coverage are optional. The public projection uses `reasoningTokens` and
`reasoningReportedSamples`; internal storage and telemetry deliberately retain
`reasoningOutputTokens` names. Unknown token values remain null or absent.

## Experimental long-running tools

Settings exposes an explicit opt-in, `Long-running tools (Native5) · Experimental`, only after an
Automatic Full setup and only while launcher work is idle. It uses the dedicated
`setAsyncToolOperations` API transaction and never changes model or workspace routes. The UI tells
the user to create and verify a separate Codex Native5 connector (Codex Native5 DEV in development)
before use; Native4 stays supported and remains the default, while ZeroRisk4 is unchanged. Product
copy explains that cancelling after dispatch stops NEKODEX observation, while an already-started
external action may continue, without exposing the start/poll/ack protocol in the workflow.

## Actionable active browser runs

Overview turns its existing active count into a compact list of browser tabs whose observed status
is running, loading, or testing. Each row preserves the account-prefixed title supplied by the
account pool, shows the observed status and interaction mode, selects that exact existing tab, and
then opens the Browser surface. It does not invent progress, elapsed time, stalled-state guesses,
task telemetry, or cancellation actions.

## Manual coverage

Implementation and direct-caller review covered:

- `App.tsx`: updater state, modal lifecycle, onboarding/settings radio groups, Zero Risk popover,
  language selection, tutorial video, Bigger Context dialog, Native5 opt-in, and exact-tab opening;
- `Overview.tsx` and its responsive NEKODEX CSS for observed active browser runs;
- `UsageDashboard.tsx`, `usage-lifetime.css`, and the Activity-page embedding;
- `types.ts` usage query/report contracts;
- `i18n.ts`, `i18n-ru.json`, `i18n-ko.json`, and `i18n-zh-TW.json` for all six languages;
- existing dirty `Updates.tsx`, `UpdateProgress.tsx`, and updater rules in `nekodex.css`.

Direct-caller review also followed renderer calls through the preload pass-through, usage IPC query
validation, `AccountBrowserPool.usageSnapshot`, and the final Web/Native public projection in
`usage-store.cjs`. The public Native projection exposes `tokens.reasoningTokens` and
`tokens.reasoningReportedSamples`; internal telemetry and persistence retain
`reasoningOutputTokens` names. Overview exact-tab opening uses the existing
`selectBrowserTab(tabId)` API before activating the Browser surface. The Native5 setting uses the
existing guarded `launcher:async-tool-operations` transaction.

## Parent focused checks

No renderer test was added or run in this lane. The shared parent budget should remain limited to
these two cases:

1. `launcher/tests/electron-hardening-focused.test.cjs` — `usage v3 migrates legacy attribution and aggregates account durations, failures, tasks and zero days`.
2. Manual renderer case `Web/Native source isolation and private aggregate export`: switch Web →
   Native, confirm account filtering disables, incomplete is not counted as unrecorded, nullable
   tokens show an em dash while measured zero remains `0`, then inspect the displayed-source CSV
   for source/model/incomplete columns and absence of account labels or IDs.

Material limits: source review does not prove visual behavior at every window size, screen-reader
announcement order, downloaded CSV behavior in a packaged Electron build, migration of real user
history, or live Native5 connector verification. Installed app, active routes, accounts and runtime
were not touched. Packaging, clean development launch, focused execution and rebuild remain parent
work after source integration.

No backend, storage, IPC handler, account data, route, runtime process, packaging script, or updater
worker was changed by this owner. No test, build, runtime launch, agent, commit, or push was run;
the parent owns focused verification and integration with the backend report producer.
