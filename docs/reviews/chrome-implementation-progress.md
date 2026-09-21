**Chrome/Web implementation — active scope**

Requested: implement the six offerings and all eight issues in the review handoff. Baseline: `b90f4e4`. Source/development work; no distributable release or installed-app replacement is implied.

This checklist is an evidence ledger, not a completion claim. A checkbox requires final affected behavior, not only source or mocked checks.

- [ ] F1 Existing Chrome profile connection: searchable choice, actual ChatGPT identity binding, deterministic supported capture, remembered successful connection, cancellation/rollback.
- [ ] F2 Task center: exact submission phases, retained ambiguous incidents, targeted cancel and truthful global cancel, state-derived recovery actions.
- [ ] F3 Account/model readiness: capability projection, separate tools readiness and actual provider quotas, pacing-aware balanced admission.
- [ ] F4 Admission queue: stable ownership, no duplicate submission, queued cancellation, pause new work, resume revalidation, explicit restart state.
- [ ] F5 Files in both directions: actual PDF/CSV/image bytes, unresolved-reference failure, upload acknowledgement, generated artifacts with provenance and usable local results.
- [ ] F6 Browser workspaces: correct navigation, usable account/window/tab switching, identity mutation protection and supported workspace restoration.
- [ ] I1 Selected Chrome profile must be causally bound to session capture.
- [ ] I2 Google profile metadata must not substitute for ChatGPT identity.
- [ ] I3 Workspace navigation must use workspace policy rather than auth-only policy.
- [ ] I4 Balanced routing must avoid accounts blocked by local pacing before assignment.
- [ ] I5 Browser-only account selection must not require a connector.
- [ ] I6 Singular cancellation must not silently cancel all work.
- [ ] I7 File references must not masquerade as delivered contents.
- [ ] I8 Ambiguous submissions must remain inspectable without unsafe resend.

Verification plan: focused logic contracts per implementation slice; isolated DEV UI checks for connected controls and states; actual Chrome/account and file-transfer outcomes before those features are marked verified. Preserve production sessions and active user tasks. No broad test suite, installer, signing or publication.

**Progress**

- Baseline source and review re-read. Implementation started with shared account availability needed by routing and queue.

- Slice 1 source: added pure pacing availability shared with final admission; Balanced skips blocked unbound accounts without moving pinned/selected ownership. Scheduled breaks have fixed deadlines and expire without a probe extending them. Added account capability projection/cards, removed connector requirement from browser-only Select, exposed provider allowed/exhausted quota states in six languages.
- Slice 1 checks: three focused admission tests and two focused readiness/quota tests passed; two existing quota presentation cases passed; launcher typecheck passed. First admission fixture run exposed a stale test fixture missing accountOperations, corrected without weakening production gates. Real DEV interaction remains pending; F3/I4/I5 are not marked fully verified.
