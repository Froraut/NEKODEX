# Triwave review 1, lane 7 — browser worker

HEAD: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`).

Read-only source review. Scope: `src/adapters/chatgpt-web/browser-worker.ts`, its direct callers in the same adapter and browser helper, and the prior four-wave results/adjudication. No tests, typechecks, scripts, broad audits, runtime/browser actions, production actions, code edits, commits, or ABI changes were performed.

## Counts

- **New independent concrete bugs:** 0
- **Repeated/adjudicated roots:** 2 (`T1-7-1`, `T1-7-2`)
- **Known limits, not counted as new bugs:** 1 (`T1-7-3`)
- **Optional improvement, not counted as a bug:** 1 (`T1-7-4`)
- **Source changes:** 0

The prior adjudication assigns the browser-worker area to D14/D15. The current source contains the corresponding fixes, so those paths are repeats of already adjudicated defects rather than new triwave findings.

## T1-7-1 — repeat of D14: connector-row observations remain the corrected popup-scoping root

- **Classification:** repeat; no new ID beyond the triwave review ID.
- **Trigger:** a connector selection or verification call reaches the mention flow while ChatGPT exposes connector rows in a visible popup. The current code derives `popup` from visible `.popover` elements and `menuRows` from visible `.__menu-item[tabindex="0"]` descendants at `browser-worker.ts:3222-3229`. It then requires one visible popup at `:3377-3386`, one exact configured row at `:3388-3396`, keyboard highlight at `:3403-3421`, and the exact selected composer pill at `:3430-3441`.
- **Consequence in the old source:** page-wide menu-row lookup could treat a sidebar history row as the connector mention result, causing false personalization/catalog evidence or misleading missing/duplicate-row errors. That is the D14 root recorded in `2026-09-15-four-wave-adjudication.md` and the old wave reports.
- **Current evidence:** the page-wide `.__menu-item` lookup is gone from this path. `selectConnector` scopes rows to one visible `.popover`; it rejects multiple visible popovers, requires the exact row, requires highlight before `Enter`, and proves the selected pill afterward. The direct attachment caller awaits `selectConnector` at `browser-worker.ts:3467-3493`, and connector verification awaits it at `:3865-3877`; both therefore receive the same fail-closed path.
- **Counterevidence and limit:** a concurrent foreign popup that appears after `assertNoPriorPopup` and becomes the sole visible `.popover` can still satisfy the structural locator if it exposes an exact same-named row. The source itself documents this residual provenance limit in the prior correction report. The selected-pill proof prevents claiming success unless ChatGPT actually reports the configured connector as selected. This is a known boundary, not a new independent defect or an ABI issue.

## T1-7-2 — repeat of D15: observation failures retain their cause

- **Classification:** repeat; already corrected as D15.
- **Trigger:** the exact connector row does not become visible within the 2.5-second wait at `browser-worker.ts:3338-3347`, and reading the visible popup row titles rejects or exceeds its bounded observation timeout.
- **Old consequence:** the former catch converted every non-abort `allInnerTexts()` failure into `[]`, so the caller could report “menu did not open,” suppress the catalog-refresh path, or tell the user to create a connector even though the DOM observation itself failed.
- **Current evidence:** `connectorMentionRowTitles` calls `menuRows.allInnerTexts()` through the bounded observation wrapper at `browser-worker.ts:3128-3137`. For any non-abort failure it throws `ChatGPT connector mention popup DOM title observation failed` with the original error as `cause` at `:3138-3145`. The missing-row branch at `:3346-3369` therefore receives a real observation failure rather than an empty title list. The direct caller's refresh handling remains limited to the explicit `ChatGptConnectorCatalogStaleError`, so preserving the cause is the correct fail-closed behavior for an observation failure.
- **Counterevidence:** an actually observed popup with zero non-empty row titles still returns `[]` and can produce the ordinary missing-menu diagnostic at `:3152-3165`; that is distinct from an observation rejection and is intentional. Abort errors are rethrown unchanged at `:3138-3140`.

## T1-7-3 — known limit: sole foreign popup provenance is not fully attributable

- **Classification:** documented known limit; not counted as a new bug.
- **Trigger:** after the pre-trigger check at `browser-worker.ts:3252-3255` observes no visible popup, an unrelated actor opens a visible `.popover` concurrently with the typed `@codex` mention. The unrelated popup is the only visible popup and contains a row whose exact text equals the configured connector name.
- **Potential consequence:** the visible-popup locator at `:3225-3229` cannot prove that the popup was opened by this composer. The exact row may pass `appResult.waitFor`, and the keyboard path may proceed through `:3377-3441`.
- **Counterevidence:** the source checks the literal mention text in the active composer at `:3240-3250` and `:3337`, checks one popup, exact row count and highlight, and finally requires the configured connector pill at `:3430-3439`. A wrong connector selection cannot be reported as successful without that final pill. The prior `2026-09-15-four-wave-fix2-08.md` explicitly records this foreign-popup boundary and says live account DOM evidence would be needed to refine it. It remains a bounded attribution limit, not a demonstrated current failure.

## T1-7-4 — optional improvement: bind popup observation to stronger local ownership evidence

- **Classification:** optional improvement; no defect counted.
- **Current gap:** `popupCount` only counts visible `.popover` elements (`browser-worker.ts:3230-3238`), and `assertMentionAttached` checks the editor text/focus but does not require a popup attribute or DOM relationship that ChatGPT explicitly associates with that editor (`:3240-3250`).
- **Possible improvement:** if a stable, account-observed ownership marker becomes available, require it before treating the popup row as mention evidence. Any such change should preserve the current exact-row, highlight, selected-pill, cleanup, and fail-closed checks.
- **Why it is optional:** the repository has no current source evidence for a stable ChatGPT-specific ownership marker. Inventing a selector or changing connector behavior based on an unknown DOM shape would risk breaking valid accounts and is not justified by this read-only review.

## ABI and scope boundary

No changes are proposed to connector names, schemas, tool descriptions, or routing. `Native4`, `Native4 DEV`, and `ZeroRisk4` remain outside this lane's findings. The account-side connector creation/schema/approval state, live DOM variants, and installed-app behavior remain documented delivery limits from the prior results, not source-proven browser-worker bugs here.

**Finding IDs:** `T1-7-1` (repeat D14), `T1-7-2` (repeat D15), `T1-7-3` (known limit), `T1-7-4` (optional improvement). **New bug count: 0.**
