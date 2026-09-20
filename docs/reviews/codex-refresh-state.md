# Codex client refresh status — 2026-09-20

The installed launcher had `codexCatalogVerified=true`, `codexPickerConfirmed=false` and
`codexRestartRequired=true`. `readState()` recreated the last flag from missing picker confirmation
on every launch, overriding the catalog monitor's earlier success/failure transition.

The source fix removes that derivation, normalizes the obsolete flag after a received catalog on
read and update, and preserves actual picker confirmation as a separate fact. Real configuration
changes still clear catalog evidence and wait for a current receipt; a failed receipt remains a
catalog error rather than recreating a generic restart instruction on reload.

Settings now distinguishes pending catalog, catalog failure, picker review, Manual profile refresh
and restored-route/removal. The action opens model connection settings without restarting an app.
Bigger Context descriptions no longer mandate a restart for every successful change. All six UI
locales describe restarting only if the intended models/settings remain unavailable.

Verification: three targeted persisted-state/status cases passed (19 assertions, 41 ms total);
renderer typecheck and Vite build passed; three production-component fixture states (Russian compact
picker confirmation, catalog waiting and catalog failure) rendered without errors/overflow and
opened the model connection via their action (2.783 s). Screenshots were visually inspected. A
focused independent Sol review found no state-transition or direct UI-wiring defect. No full suite,
installer packaging, application replacement or Codex restart was performed for this source change.
The installed 5.8.0-nekodex.3 app retains its old implementation until a future release includes this fix.
