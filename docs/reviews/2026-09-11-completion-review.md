# Completion review for 5.1.0-froraut.1

Date: 2026-09-11. Upstream refresh: **19:35 UTC**. Implementation baseline: fork commit
`ba02c2ea94947591ec27119acdd3817773f4162d` (**5.0.7-froraut.1**).
This report describes the subsequent **5.1.0-froraut.1 working tree**; it is not a release tag,
installation receipt, or account-acceptance certificate.

The previous [security/reliability review](2026-09-11-review.md) and
[upstream triage and 5.0.7 installation checkpoint](2026-09-11-upstream-triage.md) remain
historical records. Their test totals, installed hashes, and observed login handoff apply to
that earlier checkpoint. They do not transfer automatically to this candidate.

## Current conclusion

The previously deferred source changes and the nine improvement areas now have concrete
implementations, bounded verification, or an explicit external acceptance gate described below.
The candidate preserves exact model/tool selection, turn-scoped MCP authority, Codex approvals,
separate Automatic/Manual tunnels, and the user's existing profile and route ownership.
No missing signing credential, unperformed account flow, or untested platform is recorded as
completed merely because supporting code or a local fixture exists.

The local verification and installation checkpoint below records directly observed outcomes.
Native CI is attached to the published commit; account and distribution-signing gates remain
separate. The focused runs below overlap and must not be added together as a unique test total.

## Fresh upstream disposition

The read-only refresh retrieved the complete current open lists: **24 issues and 8 PRs**, up
from the prior review's 23 and 7. Upstream `main` still resolves to
`e85e3693fdb4e3e033348c08df0298c20fcdb612`. The additions relative to the earlier triage are
issue #441 and PR #442. PR #430, #432, #439 and #442 retain the inspected heads below; all remain
open upstream. The refresh also checked recent issue/PR metadata. It did not reopen every
historical attachment or treat author-reported tests as this fork's acceptance evidence.

| Item | Current fork disposition | Implementation and limits |
| --- | --- | --- |
| [PR #430](https://github.com/miuuyy/codex-chatgpt-web/pull/430), oenderg / `bbdb4077a9ca488c2b6c41162234c228da696f22` | Implemented with explicit connector migration. | [MCP server](../../src/adapters/chatgpt-web/mcp-server.ts) adds `codex_read_thread` with read-only annotations and the native read options. It invokes only one exact structured outer `mcp__codex_app__read_thread`; wrong namespace, freeform replacement, duplicates, missing tools and retired/unstarted references fail. Public contracts have fresh `Codex Native3`, `Codex Native3 DEV`, and `Codex Zero Risk2` identities and pinned ABI digests. Creating/renaming a connector is not proof of dispatch; installed Automatic and Manual task reads remain required. |
| [PR #432](https://github.com/miuuyy/codex-chatgpt-web/pull/432), gmoroz / `5b8face7b97f066da8e5fe40fbfcc4d7c0e0a3c8` | Implemented with narrower tooltip attribution. | [Pro retry hint](../../src/adapters/chatgpt-web/pro-retry-hint.ts) accepts only a visible tooltip explicitly associated with the unique exact Pro control. Unrelated chat text or an unlinked tooltip cannot supply a retry date. If attribution is absent, the original terminal error remains; a date is never fabricated. The upstream observed wording and synthetic accessibility linkage are distinguished in the [fixture evidence](../../tests/fixtures/pro-retry-tooltip.md). |
| [PR #439](https://github.com/miuuyy/codex-chatgpt-web/pull/439), JulianZJN / `039c385f09ba43eac398259eb6360ffe02ede75e` | Implemented and adapted to fork ownership/capability rules. | Optional Pro pins `5.6`, `5.5`, and `6` default to Follow ChatGPT, are saved through an authorized idle-checked command, and are snapshotted per request. Exact version and effort are rechecked before sends. Pins separate retained browser history while preserving logical cancellation/replay ownership. No model/context/tool-capability fallback is introduced. Fresh account evidence for the selected families remains required. |
| [PR #442](https://github.com/miuuyy/codex-chatgpt-web/pull/442), zm2231 / `cf75a3162ee28621dcb0beef730c01443a3a1fdb` | Implemented; exact upstream production regex retained. | [Prompt replay scrubber](../../src/adapters/chatgpt-web/prompt.ts) covers `turn`, `binding`, `call`, `request`, `control`, and `handoff` with exact 32-character bodies and JSON-escape-aware boundaries. Fork tests cover all JSON control bytes, inline/multipart replay, wrong-length/embedded near-misses and the separately supplied current token. |
| [Issue #441](https://github.com/miuuyy/codex-chatgpt-web/issues/441) | Concrete repeated-submission failure mode guarded; provider root cause unproven. | The reporter describes a generic provider error during retained turns and corrected an initial message-length hypothesis. [Adapter error classification](../../src/adapters/chatgpt-web/adapter-error.ts) and the [browser worker](../../src/adapters/chatgpt-web/browser-worker.ts) mark this generic failure non-retryable after a response or context-part send has been activated. The [actual worker-path fixture](../../tests/browser-submitted-provider-error.test.ts) proves one send, cleanup, and an explicit `chatgpt_submitted_provider_error`. This prevents automatic replay of an already activated request; it does not claim to repair ChatGPT's underlying error or reproduce the reporter's account. |

The other open PRs remain as recorded in the earlier triage: #435's complete hook ownership
change is already integrated with its provenance; #415's dependency advisories are already
covered by the fork's audited dependency floors; #412/#413 inform reporting/localization without
absolute risk claims. No additional patch was imported merely because its PR was newly listed.
Detailed attribution is in [MCP migration](../mcp-task-access-migration.md) and
[Pro feature integration](../upstream-pro-features-integration.md).

## Disposition of the nine previous improvement areas

| Previous area | Current implementation and verification boundary |
| --- | --- |
| **1. Remote-content permissions** | [Remote permission policy](../../launcher/electron/remote-permissions.cjs) installs both Electron check/request handlers before remote navigation. Silent checks deny; only an owned, visible, allowed HTTPS main frame can ask for a single clipboard consent. The asynchronous answer is revalidated against the exact document and generation. Navigation, renderer death, hidden views, timeout and teardown revoke pending consent. Unsupported media, devices, screen capture and broad filesystem access deny. [Tests](../../launcher/tests/remote-permissions.test.cjs) cover the boundary; native clipboard, ordinary attachments and account sign-in still need platform acceptance. |
| **2. Signed, authenticated releases** | [Release trust](../../launcher/electron/release-trust.cjs), [native signing](../../launcher/scripts/release-signing.cjs), full-SHA-pinned workflows and [publication](../../scripts/publish-release.cjs) authenticate bounded release metadata, exact bytes, fork/version/source and native publisher identity. An independently stored local Ed25519 key and packaged public root exist; local sign/verify and tamper rejection succeeded. This does not supply a usable Developer ID private key, Windows publisher certificate, notarization result, configured protected CI secrets, or published GitHub attestation. See the external gates below. |
| **3. Transactional update recovery** | [Worker](../../launcher/electron/update-worker.cjs), [validation](../../launcher/electron/update-validation.cjs), [supervisor](../../launcher/electron/update-launcher.cjs), [readiness](../../launcher/electron/update-readiness.cjs) and [recovery](../../launcher/electron/update-recovery.cjs) stage and validate before replacement, journal transitions, preserve the previous app until authenticated startup proof plus liveness, and recover interruption without trusting a recycled PID. Native POSIX subprocess tests and three platform transaction shapes are covered. Native Windows/Linux/macOS x64 installation, reboot/login recovery and real update acceptance remain distinct gates; [transactional update documentation](../transactional-updates.md) states their limits. |
| **4. Account and platform acceptance** | The [release gate](../release-validation.md) now names connector migration, permission prompts, bootstrap recovery, session reuse, cancellation, compaction and updater scenarios. This area remains an **external acceptance gate**, not a locally completed outcome. This report has no new successful ChatGPT login/import, installed Codex/MCP task, or native Windows/Linux result to record. |
| **5. Browser UI drift evidence** | Sanitized [Pro picker fixture](../../tests/fixtures/pro-model-picker.json), [linked-tooltip fixture](../../tests/fixtures/pro-retry-tooltip.html), strict version/effort tests and explicit account-bound release steps provide reproducible known-DOM evidence. [Diagnostic retention](../../src/adapters/chatgpt-web/browser-diagnostic-retention.ts) protects live traces while bounding completed retention; peer browser acquisition has its own cancellation/deadline handling. These are local diagnostics and an opt-in acceptance process, not a claim that future ChatGPT UI changes are monitored automatically or that unknown selectors are accepted. |
| **6. Architectural concentration** | Focused units were extracted at existing ownership boundaries: permission policy, startup recovery, release trust/staging/recovery, passkey control/progress/guide, Pro preference/retry hints, bounded process framing and saved-route diagnostics. The existing broker/outer-agent and browser ownership models remain. The large modules still exist; this is a bounded reduction of responsibilities rather than a claim that all architectural debt was removed. |
| **7. Manual mode naming** | UI, catalog display labels, runtime notices and English/Chinese/Japanese documentation now use **Manual mode**. Existing `chatgpt-web/zero-risk` and `chatgpt-web/zero-risk-pro` IDs, CLI flags, persisted keys and exact connector identifiers remain compatible. The public MCP descriptions use Manual mode; the new connector is still named exactly `Codex Zero Risk2`. No no-risk promise is made. |
| **8. Fork release identity** | The owner's explicit replacement choice is recorded as `installationMode: replace-upstream`. The app retains `dev.codexwebgpt.launcher`, its product name, NSIS GUID and profile locations, while update/publish ownership remains Froraut. This preserves the existing installation instead of creating a second profile. Native replacement acceptance is not inferred from the manifest decision. See [release identity](../release-signing.md). |
| **9. Import phase and resource budgets** | [Main-process progress](../../launcher/electron/passkey-login-progress.cjs), the [renderer guide](../../launcher/src/PasskeyLoginGuide.tsx) and [owned CLI control](../../src/passkey-login-control.ts) reconstruct the active import UI after a renderer reload and expose Import/Reveal/Cancel only for the current phase. A fresh launcher process requires a fresh owned attempt; persisted UI does not authorize importing a stale Chrome process. [Byte budgets](../../src/adapters/chatgpt-web/resource-budgets.ts) bound trace/text/Markdown, replay and helper frames/queues; overflow terminates explicitly. [Server lifecycle](../../src/server.ts) exposes idempotent signal-handler disposal. These retained-payload bounds do not claim a total process-memory bound. |

Startup failure recovery also addresses the invisible-process outcome reported in
[issue #422](https://github.com/miuuyy/codex-chatgpt-web/issues/422). The
[native recovery helper](../../launcher/electron/startup-recovery.cjs) reports a safe phase,
bounds cleanup, keeps the last-window event from silently quitting before the dialog, and exits
the failed process after Quit or an explicit fresh-process Restart. It does not establish the
original Windows ARM64 timeout's cause or remove its initialization deadline.

The setup diagnostic opportunity from #267/#438 is implemented through
[saved-route diagnostics](../../src/route-diagnostics.ts) and the
[localized UI](../../launcher/src/RouteDiagnostics.tsx). It reports base/profile configuration,
provider/catalog overrides and pending journal recovery without repairing files. Successful
catalog requests served by the bridge are shown separately. Saved settings and such a request
counter do not identify the effective command-line options or selected model of a particular
running Codex task. Existing provider choices are not silently deleted or replaced.

## Focused execution evidence

These are individually observed runs during integration and this follow-up review on macOS
arm64 with the pinned Bun 1.4.0. Counts overlap. Passing a fixture is not a live-account result.

| Command/scope | Observed result |
| --- | --- |
| `bun test tests/pro-model-selection.test.ts tests/pro-model-identity.test.ts tests/pro-retry-hint.test.ts tests/pro-retry-hint-worker.test.ts tests/browser-submitted-provider-error.test.ts tests/browser-diagnostic-retention.test.ts tests/chatgpt-resource-budgets.test.ts` | **71 passed, 0 failed**, 256 assertions; rerun for this completion review. |
| `node --test launcher/tests/release-trust.test.cjs launcher/tests/release-signing.test.cjs launcher/tests/update-validation.test.cjs launcher/tests/update-worker.test.cjs` | **74 passed, 0 failed**; rerun for this completion review. These include test keys and synthetic platform transaction shapes, not owner publisher signing. |
| `node --test launcher/tests/remote-permissions.test.cjs launcher/tests/startup-recovery.test.cjs` | **20 passed, 0 failed** in the independent permission/recovery review. |
| Prompt/config/Manual lifecycle focused run: `tests/prompt-contract.test.ts`, `tests/runtime-layout.test.ts`, `tests/zero-risk-mcp-lifecycle.test.ts` | **65 passed, 0 failed**, 934 assertions before the additional public Manual ABI pin; the final Manual ABI test then passed with 41 assertions. |
| Native complete stdio MCP contract test | **1 passed, 0 failed**, 148 assertions, including native ABI hash and negative tool/turn-reference cases. |
| Browser retired/cached connector subset; launcher connector/identity subset | **6 passed** and **10 passed**, respectively, with no failures. |
| Legacy launcher uninstall subset | **2 passed, 0 failed**; migration does not bypass owner checks or block already authorized teardown. |
| Full localization suite | **9 passed, 0 failed** when checked after migration-document links were added. |
| Core TypeScript | `bun run typecheck` passed after concurrent integration fixes. The final integrated gate must recheck the final source tree. |

Additional suite evidence and reproducible commands are recorded with the owning implementation
documents. The current aggregate counts and installed hashes below come from this candidate,
not from the previous-version checkpoint.

The [scoped acceptance runner](../account-ui-acceptance.md) is implemented with versioned,
sanitized structural fixtures. Its default performs 34 offline checks; explicit local startup
serves one synthetic response in temporary homes. A real account prompt requires an explicit
one-prompt option, uses a fixed marker with no tools, and forbids a second Send activation.
Reported or skipped Codex/MCP checks cannot satisfy required gates. The runner's focused
regressions passed **38 tests / 107 assertions**; no live account result is inferred from them.

The [offline native Electron permission scenario](../../launcher/scripts/smoke-remote-permissions.cjs)
passed on Electron 41.10.7. It exercises real main-frame/child-frame request details,
explicit consent decisions, silent denial, navigation cancellation, and media/screen denial.
Its final native clipboard callback deliberately always denies, so it never reads or changes
the OS clipboard. Visibility and consent selection are simulated; successful clipboard transfer,
the real consent dialog and physical devices still require their own acceptance checks.

## Local verification and installation checkpoint

The candidate passed the following local stages on macOS arm64 with Bun 1.4.0:

| Check | Observed result |
| --- | --- |
| Version parity and frozen installs | Version `5.1.0-froraut.1`; both frozen installs completed without dependency changes. |
| Dependency audits | No vulnerabilities reported: 106 core packages and 351 launcher packages. |
| Core tests | **944 passed, 0 failed, 1 Windows-only skip**, 5,204 assertions across 69 files. |
| Launcher tests | **481 passed, 0 failed, 1 Linux-only skip**, 482 cases. |
| TypeScript | Core and launcher checks passed. |
| Renderer, runtime and license builds | Production renderer and relocatable runtime built; third-party notices generated. |
| Relocated runtime | `RELOCATABLE_RUNTIME_SMOKE_OK`; includes actual runtime relocation, strict manifest verification, loopback lifecycle controls and browser-engine check. |
| macOS package | ZIP/DMG built, extracted application passed strict deep signature verification, and `PACKAGED_LAUNCHER_SMOKE_OK darwin/arm64` passed. This is an ad-hoc local signature. |
| Local Codex compatibility | Catalog smoke and scoped local acceptance passed on Codex 0.154.0 and bundled 0.153.4. Each acceptance run passed 34 offline fixtures, local startup and isolated catalog checks, with zero prompt activations or live tasks. |

The integrated local run completed the core suite; the launcher suite and remaining smoke stage
were rerun after correcting obsolete connector/activation fixtures and documentation-link parity.
All listed stages are green. Native CI runs the complete `bun run verify` command against the
published source and performs matching-platform package checks separately.

The verified archive replaced the existing macOS installation after the previous app, profile,
configuration and archives were preserved in a private rollback backup. The running **Settings**
screen reports **5.1.0-froraut.1**. Existing English, automatic interaction, launch-at-login,
background-running and browser-display preferences were preserved. The new routing action ran
inside the installed app and reported the actual saved default OpenAI provider, no installed
bridge, and unavailable catalog observation; it did not claim a successful Codex integration.
The selected configuration/hook/journal files remained byte-for-byte unchanged during the
read-only diagnostic check.

- macOS arm64 ZIP SHA-256: `50d9087804dff144a578e192aa329f976dcac35350888094a15cc779d346d717`
- Installed `app.asar` SHA-256: `9af0b2600e01861ee9373bb508b8459001f0769cd479b71030dbdad5ec0d6c5e`
- Runtime bundle identity: `3d4353935bc1ba7dd97a48194813fbb8fa316aa7964c1f8b75eff50eb72f6fa4`

The final post-package edits affect only verification scripts, their fixtures and documentation;
the installed production/runtime bytes are the ones covered by the checks above. Source
publication and installation do not imply live ChatGPT, Codex/MCP or notarization acceptance.

## External release and acceptance gates

- **Apple distribution signing is not available locally yet.** Xcode lists a Developer ID
  Application certificate whose private key is **Not in Keychain**. The locally usable Apple
  Development identity cannot satisfy Developer ID distribution. Obtain the matching authorized
  private key or a new authorized Developer ID identity, then perform timestamped signing,
  notarization, stapling and Gatekeeper validation. No successful result is claimed here.
- **Windows publisher signing remains unavailable.** The owner confirmed that an accessible
  Windows publisher certificate is not available. Native Windows signing and platform acceptance
  require that external resource and a matching Windows runner. An unsigned/local package is
  not evidence of Authenticode or SmartScreen acceptance.
- **Metadata key and CI gates are separate.** The local Ed25519 private key exists outside the
  repository with mode `0600`, and local sign/verify tests succeeded. Protected remote release
  secrets are not configured. No signed public release, published GitHub attestation, native
  notarization or Windows signature follows from possessing the metadata key alone.
- **Fresh session and installed-tool acceptance is still pending for this candidate.** Verify
  ordinary login, macOS passkey/Touch ID, completed import, session persistence after restart,
  model selection and a real result. Then create the fresh connector identities and execute an
  installed Codex task through Automatic and Manual MCP, including the task-reader action,
  cancellation and compaction. Connector visibility, a catalog request or a startup smoke does
  not substitute for those results.
- **Cross-platform/reboot acceptance remains pending.** Test native Windows, Linux and macOS
  x64 packages, clipboard/file controls and update rollback/login recovery on their actual
  platforms. Local fixtures and macOS arm64 subprocess tests do not certify all targets.

Until those outcomes are recorded, this document reports implemented and locally tested source
changes with named external gates, not complete stable-release acceptance. See
[release validation](../release-validation.md), [MCP migration](../mcp-task-access-migration.md),
and [release signing](../release-signing.md) for the concrete reviewable steps.
