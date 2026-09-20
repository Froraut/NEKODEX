# Frontend implementation handoff — 5.7.0-nekodex.2

Branch: `codex/update-startup-recovery`

Baseline: release `v5.7.0-nekodex.2` at `ba7e030fb76ef178247d611ae892c6ba6c21a817`.

## Implemented scope

- `launcher/src/AccountSettings.tsx` now tolerates two consecutive active Codex sign-in status-poll failures without a global toast. A successful poll resets the consecutive-failure count. The third consecutive failure stops automatic polling and exposes the existing in-page Retry action with specific localized status copy. Retrying reads the authoritative login snapshot and resumes polling with the saved flow ID, account ID, and remaining deadline; active open, copy, and cancellation actions retain their existing ownership.
- A failed account-list refresh now keeps the last successful account snapshot visible, marks it as potentially stale, focuses an inline Retry action, and prevents account changes until a fresh `accounts()` result clears the failure. Routing, enablement, credential replacement, selection, account and connector checks, pacing, proxy, allowance refresh, new Codex sign-in, and add-account controls are blocked. An already active Codex sign-in keeps its open, copy, and cancel controls so stale account metadata cannot strand cancellation ownership.
- The automatic connector setup instructions are now a semantic three-item ordered list. The ChatGPT permission, Codex sandbox, and approval boundary remains separate and unchanged. Manual-mode connector guidance retains its distinct existing paragraph.
- New account recovery and connector instruction copy is present for English, Russian, Simplified Chinese, Traditional Chinese, Japanese, and Korean.

## Files owned by this change

- `launcher/src/AccountSettings.tsx`
- `launcher/src/App.tsx` (connector instruction rendering only)
- `launcher/src/connections.css` (connector instruction list only)
- `launcher/src/i18n.ts`
- `launcher/src/i18n-ru.json`
- `launcher/src/i18n-zh-TW.json`
- `launcher/src/i18n-ko.json`
- `docs/reviews/post-update-20260920/frontend-handoff.md`

`launcher/src/UpdateProgress.tsx` and `launcher/src/Updates.tsx` already contained parent-owned changes when this implementation started and were not edited in this lane.

## Verification boundary

Per instruction, no tests, builds, typechecks, network requests, live application actions, or UI automation were run. Verification was limited to a manual review of the edited branches, action-disable gates, locale-key coverage, and the final scoped diff.
