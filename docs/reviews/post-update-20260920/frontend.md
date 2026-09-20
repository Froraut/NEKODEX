# Frontend review: 5.7.0-nekodex.2

Scope: bounded manual review of the released `v5.7.0-nekodex.2` frontend at `715fcfe`, limited to update flow, account recovery, and directly related usability/accessibility. Evidence included the current source, all six supported locale paths, current action wiring, and screenshots 32–36 in `resilience-ui-after`.

Excluded from findings: the parent-owned `UpdateProgress.tsx` unknown-total progress-bar correction; live-app recovery; source implementation; and screenshot 7's connector-unavailable state, whose fixture omitted `browserInteractionMode` and is not a product bug.

## Findings

### [P2] A transient active-login poll error permanently stops status recovery

- **Source:** `launcher/src/AccountSettings.tsx:146-189`, especially `:173-180` and the effect dependency at `:189`.
- **Trigger:** An official Codex sign-in is active and one `codexLoginStatus` request rejects temporarily.
- **Impact:** The catch handler sets `loginSnapshotStatus` to `"failed"` and then calls `schedule()`. That state change reruns the effect, whose cleanup clears the newly scheduled timer and increments the revision; the next effect returns immediately because the status is no longer `"ready"`. The UI therefore stops observing a sign-in that may still complete, switches every account to the uncertain-login recovery state, and requires a manual retry to learn the real result. This undermines the intended recovery behavior and can leave account identity unresolved after a momentary IPC failure.
- **Small fix:** Keep the active poller in the ready/recovering state after an individual poll rejection, report the first error inline, and continue the bounded poll schedule. Set `loginSnapshotStatus` to `"failed"` only when the poll budget/deadline is exhausted or a terminal snapshot read proves that status cannot be recovered.

### [P2] A failed account refresh leaves stale readiness data with no in-page retry

- **Source:** `launcher/src/AccountSettings.tsx:38-84` and `:289-310`.
- **Trigger:** The initial `accounts()` request succeeds, then a browser/operation event causes a later refresh to fail.
- **Impact:** The catch path sets `loadFailed`, but the retry UI is rendered only when `state` is null. With an existing snapshot, the account cards remain visible without any stale-data marker or retry action, and the focus effect targets a retry ref that is not mounted. A dismissed global toast leaves “Models checked,” “Local tools,” routing eligibility, and active-task counts looking current even though their refresh failed.
- **Small fix:** Render the localized failed-refresh toolbar whenever `loadFailed` is true, including above an existing snapshot; identify the cards as last-known data and wire its retry button to `attempt`. Keep the old snapshot visible so recovery does not blank the page.

### [P2] Connector setup's three required actions are flattened into one paragraph

- **Source/rendering:** `launcher/src/App.tsx:2126-2135` renders every wizard body as one `<p>`.
- **Locale data:** the three numbered actions are embedded in a single string in English (`launcher/src/i18n.ts:472-473`), Simplified Chinese (`:1001-1002`), Japanese (`:1530-1531`), Russian (`launcher/src/i18n-ru.json:463-464`), Traditional Chinese (`launcher/src/i18n-zh-TW.json:338-339`), and Korean (`launcher/src/i18n-ko.json:338-339`).
- **Impact:** Screenshot 36 shows the result: three security-sensitive connector actions run together in a dense paragraph directly above two similar connector identities and several actions. Visual scanning is poor, and assistive technology receives no list/step structure for the sequence. A user can readily miss the authentication setting, exact-name requirement, or return-and-verify step.
- **Small fix:** Store the three localized instructions as three items (or three explicit locale keys) and render an `<ol>` with one `<li>` per action; keep the permission/sandbox explanation as a separate paragraph after the list.

## Review boundary

No tests, builds, network requests, live UI actions, or product-source edits were performed. Screenshots 32–36 were inspected as existing evidence. Screenshot 32 confirms the corrected initial retry presentation, screenshots 33–35 did not add a separate actionable finding within this lane, and screenshot 36 supports the connector-instruction accessibility finding above.
