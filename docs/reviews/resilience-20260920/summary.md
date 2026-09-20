# Resilience and UI implementation

Baseline: installed/released 5.6.0-nekodex.3. Implementation release: 5.7.0-nekodex.2.

The requested review completed 15 bounded Sol code lanes and 16 Sol UI lanes. One actual Daybreak
Blue counter-review completed through the official app-server, using Sol and the explicit per-turn
cyberAccessProgram. Earlier model-alias-only failures omitted that program; they were not evidence
that the user lacked Daybreak access. Workers ran no test suites or builds. Parent retained ownership
of integration, checks and release work.

Implemented changes are recorded in the implementation notes in this directory and in the release
notes. The critical seams are native/Web admission separation, a durable runtime-generation rollback,
account identity/operation leases, official login cancellation reconciliation, task-bound continuation
history, Native6 result acknowledgement/cancellation, and truthful UI recovery states.

## Development evidence

- Six focused Bun cases passed: native response with Web admission closed; continuation owner
  mismatch; invalidated in-flight quota; dispatched observation cancellation and replay guard;
  configuration-generation rollback preserving a concurrent edit; and stopping the candidate before
  restoring and starting the previous generation.
- One named updater case passed: a matching executable version alone cannot acknowledge readiness;
  locally usable lifecycle evidence is also required.
- Root TypeScript check and renderer development build passed. This did not run the full test suite.
- 24 affected synthetic Electron UI scenarios rendered without page exceptions or duplicate React
  keys. A long account sign-in label and a restart notice hidden by the titlebar were corrected and
  only affected scenarios were repeated. Test-only missing static resources are separate from app
  exceptions; they were not described as live product defects.
- A synthetic UI interaction started Codex login for a nonselected account, copied the one-time
  code, cancelled, and confirmed that Web selectedId remained unchanged.
- The actual Electron main/preload/renderer started in an empty, isolated DEV profile. New account
  IPC was present; no login flow or cached quota existed, and the one empty account remained signed
  out. The first harness attempt selected the embedded ChatGPT page; it was corrected to identify
  the exact file renderer before interaction. Temporary Electron processes were closed.

## Evidence boundaries and retained limits

- Synthetic account/quota/login data proves presentation and UI coordination, not live provider
  acceptance of every ChatGPT session. The allowance reader uses the official backend contract and
  reports unsupported authentication as unavailable. It does not borrow the parent's Codex quota.
- Official device authorization remains user-controlled. Saving shared Codex authentication is
  distinct from changing an already-running desktop account; no credentials are copied or staged.
- Native6 ownership is process-local. Cancelling observation cannot undo a dispatched external tool.
- Native telemetry remains bounded best effort, and recorded totals do not imply complete coverage.
- A recent receipt can be pruned before lifetime aggregates; historical receipt detail is not
  reconstructed. Continuations above the durable snapshot budget can remain memory-only.
- Generic JSON-Schema enforcement and active dynamic-tool registry pinning were not added because
  their compatibility contract needs separate work. The prompt delimiter defect was fixed.
- Public-host validation cannot pin the OS browser's later DNS lookup; no stronger claim is made.
- macOS and Linux package production, Windows preview artifact production, installed-app activation,
  live quota responses and desktop model-picker confirmation are separate delivery observations.
- The upstream review ledger imports 95 historical records (highest observed PR 590 / issue 570).
  Missing revision fingerprints stay marked for recheck; these are not presented as a fresh scan.

The global daybreak-activation and codex-web-operations skills were saved outside this repository.
The upstream checkpoint skill is canonical under .agents/skills and linked into global discovery.

## Additional requested layout and action review

Product Design was applied to the existing implementation, retaining its current brand and assets.
The affected flow was inspected before and after changes. The updater now shows Download, Verify,
and Restart as real phases; a failed check cannot rename an install action to an ambiguous Retry.
Unknown-length downloads still display observed byte counts, invalid readings cannot render NaN,
and binary units are labelled MiB. Account cards omit repeated coverage prose and collapse optional
model buckets. An unavailable login-status request now offers an explicit recovery action.

Five additional bounded UI scenarios passed: changing download progress, compact Russian verification,
reduced-motion verification, login-state retry, and compact allowance details. The 1.2-second motion
sample observed 145 animation callbacks and 142 distinct fill positions, with no value exceeding the
latest reported bytes. This is a small renderer sample, not a cross-machine frame-rate guarantee.
Reduced motion disabled the progress animation. The changed UI build/typecheck passed.

See [the five-step design review](product-design-audit.md) for accepted screenshots and limits.
The global maintain-learned-skills skill was created and enabled in first-party discovery, with a
narrow global AGENTS trigger. Existing failure guidance gained six confirmed lessons from this work.


## Final README and retry correction

The README was reduced from 230 lines to a compact current guide with accepted renderer images,
correct Native6 defaults, Connections navigation, platform delivery and account/update boundaries.
The initial .1 packaging run was cancelled before publication. The .2 follow-up clears the obsolete
login failure toast on explicit retry; that exact scenario passed after the correction.
An earlier synthetic connector capture omitted browserInteractionMode. Setting the required fixture
mode restored the expected Native6 identity; this was a fixture defect, not a product defect. The
corrected exact-identity field and current README screenshots were inspected before publication.
