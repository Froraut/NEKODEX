# Triwave review 3 — lane 7 — browser worker

HEAD: `3740505b0107af9a83053fd523ae1ad30be36465` (`3740505`).

Final adversarial read-only pass for the browser-worker scope. Read the current source at `src/adapters/chatgpt-web/browser-worker.ts`, its direct browser-helper path in `src/adapters/chatgpt-web/browser-helper-main.ts`, and:

- `docs/reviews/2026-09-15-triwave-review1-07.md`
- `docs/reviews/2026-09-15-triwave-review2-07.md`

No tests, typechecks, scripts, browser/runtime actions, production actions, code edits, commits, or ABI changes were performed.

## Counts and disposition

- **New independent concrete bugs:** 0.
- **New finding IDs:** none. No `T3-7-n` ID is assigned because no concrete new path survived the adversarial pass.
- **Confirmed repeats/refinements:** the D14 popup-row root and D15 observation-cause root remain repeats of the earlier waves.
- **Known limits:** popup provenance, account-dependent DOM shape, and an attempt budget that is a maximum when cleanup leaves a popup visible.
- **Optional improvement:** bind the popup to a stable ChatGPT composer ownership marker only if live account evidence supplies one.
- **Source changes:** 0.

## Final candidate-root review

### Repeat/refinement — D14: visible popup row scope remains corrected

The current selection and personalization paths construct `popup` from visible `.popover` elements and derive `menuRows` and the exact configured row below that popup at `browser-worker.ts:3222-3229`. The proof path rejects multiple visible popovers and checks the literal mention text in the active composer before accepting a visible exact row at `:3282-3294`. The normal selection path repeats the one-popup check, requires exactly one exact row, requires keyboard highlighting, activates through the composer, then resolves the replacement composer and proves exactly one selected connector pill at `:3377-3441`.

The old page-wide `.__menu-item` sidebar-history collision is therefore not a current source path. The wave2 refinement still holds: personalization proof establishes a fresh exact visible row, while only the normal selection branch establishes the selected connector pill. These are different proof claims, but neither reveals a new concrete failure.

### Repeat — D15: DOM observation failures retain their cause

`connectorMentionRowTitles` wraps `menuRows.allInnerTexts()` in the bounded browser observation and abort wrappers at `browser-worker.ts:3128-3145`. A non-abort rejection becomes an explicit observation error with the original error as `cause`; an abort is rethrown. The ordinary empty-title result remains reserved for an actually observed popup with no non-empty row titles. The catalog-refresh caller still reacts only to `ChatGptConnectorCatalogStaleError`, so an observation failure cannot silently become a missing catalog and cannot incorrectly trigger refresh. This remains the D15 correction.

### Known limit — popup ownership is still account-DOM dependent

A sole foreign visible `.popover` that appears after `assertNoPriorPopup` can still be structurally indistinguishable from the mention popup if it contains an exact row with the configured name. The source has no stable composer-to-popup ownership attribute to prove origin. The literal composer mention, one-popup check, exact row check, keyboard highlight and, for normal selection, selected-pill proof reduce the risk and prevent a wrong selected connector from being reported as normal selection success. Structural personalization proof can still only claim the exact visible row, not popup ownership. No live DOM evidence is available in this pass, so this remains a known limit rather than a demonstrated new defect.

### Known limit — three trigger attempts are an upper bound

When a missing exact row is observed, the code can continue toward `MAX_CHATGPT_CONNECTOR_TRIGGER_ATTEMPTS = 3` at `browser-worker.ts:3321-3376`. If clearing the composer leaves a visible popup, the next iteration stops at `assertNoPriorPopup` before another trigger. Cleanup then fails closed. The source and wave2 report correctly describe three as a maximum, not a guarantee. This is the previously recorded account-dependent behavior, not a new path.

### Confirmed interaction — catalog refresh does not cross the retry boundary incorrectly

The normal turn initializes one `connectorAttemptBudget` and permits one catalog-refresh opportunity for a local-tools, non-reused, non-multipart turn around `browser-worker.ts:4940-4982`. A stale-catalog error is the only condition that consumes the refresh opportunity; the page is refreshed and the temporary surface/model/baseline are rebuilt before retrying. Observation errors, identity mismatches, aborts, and ordinary connector-unavailable errors do not enter this refresh branch. The shared trigger budget intentionally survives the refresh, preventing an unbounded second set of attempts. No cross-scope retry or replay bug was found.

### Confirmed interaction — attachment cleanup preserves the selection transaction

`selectConnector` owns its mutations and clears the composer on every selection failure. Once it returns, `attachPrompt` owns the selected pill and inserted prompt together. If prompt insertion or readback fails, `attachPrompt` clears the composer and reports a persistent-state error if cleanup cannot prove an empty composer. This preserves the D14/D15 fail-closed behavior through the direct attachment caller; no detached-composer or stale-pill path was found.

### Confirmed interaction — final model verification fails closed before send

Immediately before the irreversible send, `sendAttachedPrompt` rechecks the expected model/effort after connector attachment and file handling. A mismatch remains a pinned-model error, and Escape cleanup cannot replace that safety-relevant error. If verification succeeds but the menu cannot close, cleanup still fails closed. This browser-worker path does not alter connector identity or tool ABI and does not create a Native4/ZeroRisk4 interaction.

### Confirmed interaction — launcher lease and browser helper settlement are scoped

For launcher turns, `runExclusive` records the lease, starts the heartbeat, and always sends the matching end notification with completed/failed/aborted status. Connector binding is reported only for completed native/local-tool turns. The helper validates per-run identity, keeps abort controllers, prompt selections and completion-fence waiters keyed by the exact run ID, rejects outstanding waiters during settlement, and emits `turn_settled` after per-turn cleanup. No browser-worker candidate root was found where a failed connector path could release a different turn or reuse a deterministic trace ID before cleanup.

### Rejected candidate — Native4, Native4DEV, ZeroRisk4 or ABI drift

No change or new source path was found that renames, aliases, routes, or mutates the public connector/tool contract. The browser worker carries the configured `appName`; the explicit DEV mismatch diagnostic remains limited to the production `CHATGPT_CONNECTOR_NAME` versus `DEV_CHATGPT_CONNECTOR_NAME` menu observation. `nativeConnector` only enables the existing local-tools/browser capability and launcher connector identity binding. Native4, Native4DEV, ZeroRisk4 and the public ABI remain preserved.

### Optional improvement — stable ownership marker

If a live account supplies a stable `aria-controls`, owner ID, or equivalent relation from the active composer to its mention popup, the source could require that relation before structural personalization proof and normal selection. The current repository does not establish such a marker; inventing a selector would be riskier than leaving the documented account-DOM boundary. No change is proposed.

## Parent handoff

The three waves converge on **zero new concrete browser-worker roots**. The final parent pass can stay within the requested `<=60s` and `<=10` scenarios. The most useful focused scenarios are:

1. sole foreign popup during personalization proof;
2. multiple visible popovers;
3. missing exact row with legacy or DEV identity;
4. popup left visible across a retry;
5. catalog-stale refresh followed by the shared attempt budget;
6. observation rejection from `allInnerTexts()`;
7. prompt insertion failure followed by cleanup;
8. final model mismatch after connector attachment;
9. launcher abort followed by lease release;
10. helper settlement with pending selection/fence waiters.

This report is source-only evidence. It does not establish live ChatGPT DOM variants, account connector creation/approval, installed-app readiness, or production success.
\nEOF
wc -l docs/reviews/2026-09-15-triwave-review3-07.md
sed -n '1,35p' docs/reviews/2026-09-15-triwave-review3-07.md
git status --short -- docs/reviews/2026-09-15-triwave-review3-07.md