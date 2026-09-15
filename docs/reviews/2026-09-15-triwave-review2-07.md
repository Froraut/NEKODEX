# Triwave review 2, lane 7 — browser worker

HEAD: `3740505b0107af9a83053fd523ae1ad30be36465`.

Independent manual read of the current `src/adapters/chatgpt-web/browser-worker.ts` connector mention, personalization proof, selection, prompt attachment, retry and verification paths, challenged against `2026-09-15-triwave-review1-07.md` and the adjudicated four-wave ledger. Read-only review: no tests, typechecks, scripts, browser/runtime actions, production actions, code edits or commit. The only written artifact is this report. Native4, Native4 DEV and Zero Risk4 names and public ABI are unchanged.

## Counts and disposition

- **New independent concrete bugs:** 0.
- **Repeats of adjudicated defects:** 2 (`T2-7-1`/D14 and `T2-7-2`/D15).
- **Known limits:** 2 (`T2-7-3`, `T2-7-4`); neither is a new defect.
- **Optional improvement:** 1 (`T2-7-5`); no source change proposed without live DOM ownership evidence.

### T2-7-1 — repeat D14; first-wave scope claim holds, with a narrower proof claim

**Classification:** repeat, not a new source path. The current locator for exact connector rows is nested under visible `.popover` at `browser-worker.ts:3225-3229`. Before typing, both structural proof and normal selection require no visible popup (`:3273-3275`, `:3324-3328`). Both inspect the literal `@codex` composer text (`:3288`, `:3337`). Visible exact-row proof requires one popup (`:3282-3294`, `:3377-3386`), while selection additionally requires one exact row, keyboard highlight, and the exact selected composer pill (`:3388-3441`). The page-wide sidebar-row D14 trigger in the frozen ledger is therefore no longer a source path for these observations. Prompt attachment awaits selection at `:3485-3504`; verification awaits it at `:3871-3875`.

**Challenge to wave 1:** `T1-7-1` describes selected-pill proof as preventing a successful wrong connector. That is true for the normal selection branch, but structural personalization proof returns on a visible exact row and one popup **before** any pill is selected (`:3282-3294`). Its narrower guarantee is an exact visible row after a fresh mention, not a bound ChatGPT connector selection. The sole concurrently opened foreign popup boundary in `T1-7-3` applies to this proof branch; the final pill gate only protects the later selection. This refines the assurance statement, not D14's repaired sidebar root or a separate demonstrated failure.

### T2-7-2 — repeat D15; observation rejection is no longer an empty catalog

**Classification:** repeat. If the exact row wait times out and `menuRows.allInnerTexts()` rejects or exceeds its bounded observation time, `connectorMentionRowTitles` now throws a diagnostic with the original error as `cause` at `browser-worker.ts:3128-3145`. The timeout branch at `:3346-3374` cannot silently treat that failure as `[]` or trigger the ordinary missing-menu message. A successfully observed empty title list remains a distinct state at `:3152-3155`. The one-refresh caller at `:4970-4982` acts only on `ChatGptConnectorCatalogStaleError`; an observation failure continues to surface as a failure. No current replacement for the old D15 catch-and-empty path was found.

### T2-7-3 — known limit: a failed mention can consume fewer than three trigger attempts

**Classification:** known limit already stated in `2026-09-15-four-wave-fix2-08.md`, not a new defect. Exact trigger: a mention opens a sole visible popup with alternate rows but no configured exact row; the exact-row wait times out; catalog refresh is unavailable and no legacy/DEV mismatch applies. The code enters the next of up to three iterations at `browser-worker.ts:3321-3376`. If `composer.fill("")` leaves that popup visible after the 250 ms settle, `assertNoPriorPopup` at `:3324-3327` throws **before** the next `pressSequentially`. Thus the diagnostic may stop after one complete trigger even though the budget allows three. The catch at `:3442-3451` clears composer state and fails closed. The first-wave report's references to “after three complete mention attempts” should be read as a maximum; the source does not guarantee all three when a popup persists. Whether ChatGPT actually keeps the popup open after clearing requires live account DOM evidence.

### T2-7-4 — known limit: popup structure and concurrent provenance

**Classification:** documented DOM boundary, not a new independently established bug. `popup` is any visible `.popover` on the page (`browser-worker.ts:3225`), and `popupCount` rejects zero or multiple popovers at proof/selection points (`:3230-3239`, `:3289-3294`, `:3377-3386`). A valid mention popup rendered outside `.popover`, or a second visible popup, fails closed. A sole foreign popup opened concurrently after the pre-trigger zero count can pass the structural proof if it contains an exact row; the source has no composer-to-popup ownership attribute to distinguish it (`:3252-3255`, `:3274-3294`). The literal mention check narrows the race, and normal selection still demands an exact selected pill. These are the same account-dependent provenance and selector limits recorded by the prior correction and first-wave review, with no live reproduction here.

### T2-7-5 — optional: use a stable composer-to-popup ownership marker if observed

**Classification:** optional improvement. A stable `aria-controls`, owner ID, or equivalent ChatGPT DOM relation, if actually observed for this mention UI, could strengthen `popup` ownership before structural proof and normal selection. Current source provides no such marker, so this review does not propose an invented selector, a page-wide fallback, or a change to connector names, schema, approval, or tool ABI. Preserve the existing exact row, highlight, pill, cause, and cleanup gates if that evidence becomes available.

## Boundary for parent verification

This is source review only. It does not establish live ChatGPT popup shape, account connector creation/schema/approval, retained-task behavior, installed-app readiness, or production success. The parent retains the single final focused verification budget of at most 60 seconds and ten expanded scenarios; this lane performed no executable verification and requests no additional test pass.
