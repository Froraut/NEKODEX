# Selective Chat On Steroids adoption

This change implements the selected workflow and usability features reviewed from
Chat On Steroids `18b24b5fe718193522c2f62c10e797a3bb4aee38`, against NEKODEX base
`f1016ab5cc82ad3a12f74d147cf6daff9c97345b`. It adapts product ideas to NEKODEX's
existing client/broker/account ownership. It adds no dependencies, standalone
worker scheduler, message sender, transcript store, plugin installer or general
browser-control subsystem. The schematic assets are original NEKODEX artwork.

## Implemented scope

| ID | Result | Owners and limits |
| --- | --- | --- |
| N01 | Unified support report, available in Settings and Activity alongside the existing safe-log export | `support-report.cjs` strictly projects cached state, per-report pseudonyms, bounded structural logs, numeric process memory and observed tool aggregates. `support-report-sources.cjs` starts no probes/repairs. Retired health is stale; unreadable histories and queue work are explicit. Missing measurements remain unavailable. Saving uses existing guarded preload/IPC and a private atomic file write. |
| N02 | Attention-first task overview with queue and recorded-task filters | `TaskCenter.tsx` and `task-center-model.ts` project existing owners. `QueueControls.tsx` remains the single reason/cause presentation owner and supplies the exact jump target. |
| N03 | Task detail with send/acceptance/uncertain/cancellation receipts and current capabilities | `TaskDetails.tsx` never resends work or grants an action from a label. Version 1 ledger records gain bounded optional milestones; original uncertainty/acceptance evidence survives repeated tool rounds and restart. |
| N04 | Task continuity across retained compaction, exact-parent checkpoints and owned browser observations | Actual compaction/checkpoint/rebind/assistant-replacement boundaries produce links. A browser rebind proves reconnection to the owned surface, not replacement of a document. Links are metadata and grant no replay authority. |
| N05 | Verified native request and parent/worker associations | Canonical SQLite-indexed current-turn metadata verifies identities. Missing or unsupported native evidence remains unavailable. The recorded state is request-observed; the application does not invent live worker status or own worker scheduling. |
| N06 | Read-only selected tool/skill provenance | Exact namespace/name inventory, explicit selection and returned success remain separate. Skill digests identify transported content, not publisher authenticity. Prompts, instructions, schemas, tool arguments/results and source paths/URLs are excluded. |
| N07 | Localized settings search with keyboard navigation and exact destination focus | Mounted marked controls supply localized names/descriptions. Search reveals controlled disclosures without invoking an action, resetting a setting or replacing a draft. Disabled controls retain their state. |
| N08 | Account/mode-bound illustrated connector help | Localized guidance uses original text-free schematic SVGs, existing dialogs/focus handling and captured-account handlers. It never receives key values or writes readiness/tool proof. |

The additive observation schema is bounded to 12,000 UTF-8 bytes before crossing
the existing 16 KiB control request boundary. It retains at most 128 tool rows,
16 skills and 16 continuity links, with explicit truncation. The existing
2,048-record journal limit remains, with a 32 MiB bounded read ceiling. Native
proof reads a bounded 1 MiB rollout tail through the existing index; it performs
no transcript-directory scan. Old journal records remain readable.

## Authenticity and ownership review

The [necessity review](2026-10-18-authenticity-ownership-review.md) evaluates each
selected boundary by the failure it prevents. Publisher signatures, actual-byte
hashes and platform application validation establish different facts. IPC sender
identity, account principal/epoch, exact turn/helper/surface ownership, one-shot
receipts and tunnel PID/config generations similarly prevent distinct races or
misattribution. They remain in place.

One redundant dependency was removed: in-app update discovery/staging no longer
requires or downloads unsigned `checksums.txt`. Its digest previously had to
equal the already authenticated metadata's asset digest. Staging now uses that
signed digest directly. Exact package name/size/repository/version, signature,
stream/cache/staged-copy hashes and application validation remain enforced.

D01 is complete as a [shared credential-provider design](../design/tunnel-credential-provider.md).
Encryption migration remains a later implementation: Electron, Bun CLI and
headless tunnel-client startup must share an established delivery/profile
contract. No credential, profile or storage-format migration occurs here.

## Focused development verification

Passing targeted evidence was retained across the coherent implementation;
unchanged tests were not rerun as a finishing ritual.

- `tests/support-report.test.ts` and `tests/support-report-sources.test.ts`: actual
  saved file/privacy/bounds, source-log alias protection, private permissions,
  process roles/byte totals, current versus retired cached health, unavailable
  histories, queue inclusion and no probe/host/process creation.
- `tests/task-observation.test.ts`: private content exclusion, strict bounds,
  old-journal compatibility, restart uncertainty, owner rejection and real
  helper HTTP-to-lifecycle-to-ledger transport. The retained-compaction case uses
  the actual handoff owner, broker token and checkpoint store, forwards the
  production-created lineage through control/persistence, checks reopening and
  proves a consumed token cannot replay. Native fixtures use real local SQLite
  and canonical session/turn metadata. No provider is contacted.
- Existing `tests/tool-proof.test.ts` and feed-progress checks passed for the
  changed progress contract; success remains distinct from retirement/unknown.
- `tests/task-center-overview.test.ts`: mixed attention/recent ordering, filters,
  withdrawn capabilities and localized detail labels.
- `tests/settings-search.test.ts`: six-language matching, exact navigation,
  disabled-control fallback and draft preservation.
- `tests/update-authenticated-staging.test.ts`: discovery without the sidecar,
  real metadata-signature refusal before package download and real stream/cache/
  staged-copy integrity rejection. Extraction writes inert structural fixtures;
  no installer or update worker runs.
- Core TypeScript, launcher TypeScript, renderer development build and Node
  browser-helper bundle completed. Bun 1.4.0 was used for the integrated build;
  installed lockfiles were preserved. Vite retains its existing large-chunk
  advisory; the build succeeds.
- Architecture map generation/check and documented-path validation completed.

## Observed user flows

The built renderer's credential-free preview was inspected through Computer Use
with synthetic task/account data. The affected flows covered Russian task
details, send uncertainty and provenance, exact task filtering, cancellation
dialog/focus restoration, settings search revealing a closed Advanced section,
keyboard selection and preservation of an unsaved capacity value. Connector help
was opened with a synthetic draft, switched between topics and closed with
Escape; account/mode and draft values were preserved. Dark layout at the default
viewport and the 840 px narrow layout were inspected; the light theme was also
checked. These observations do not establish live provider or installed-app
behavior.

The real source Electron application was additionally launched in a separate
temporary DEV profile with no user accounts/keys. Its exact renderer path and
DEV identity were checked. The support-report action crossed the real preload,
guarded IPC and macOS save dialog and saved a 6,334-byte JSON report with mode
`0600`. It contained six observed process entries and explicitly unavailable
route/broker/tool-counter observations for the unconfigured profile. The app
reported a saved result after the write. This is development export evidence,
not evidence of a configured provider task.

The source DEV process was gracefully closed after that check. Temporary
preview tabs/server and disposable profiles are closed/removed at handoff.
Screenshots and the local DEV report are retained outside the repository as
task evidence. No release package, production deployment, installed application
replacement or live-account configuration change is part of this source change.
