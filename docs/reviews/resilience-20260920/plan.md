# Resilience and complete UI review

User request: review application stability and architecture, improve update/port/tunnel reliability,
perform a complete UI review with parallel agents, improve usability/motion, and update the existing
operations skill with recurring failures. Earlier requested per-account Codex quotas, quick official
login and an upstream review ledger remain in scope.

Baseline: released/installed 5.6.0-nekodex.3, main e10c52a. Native6 cloud connector exists and exposes
start/poll/cancel/status; installed Verify reports Healthy. Native route returned a fixed marker.
Desktop model picker still shows its existing native entries; catalog delivery is confirmed but the
Web picker confirmation is not fabricated. Native6 operations remain process-local.

## Review and ownership

First wave: 15 bounded manual code lanes, Sol. Four Daybreak attempts were intended (three started
and failed because the request lacked the required access-program mode, one hit the slot limit); all security lanes were re-dispatched with Sol. The user has Daybreak access; the missing per-task
mode must not be misreported as absence of account entitlement. Current docs/local UI confirm
Daybreak is separate from model selection for ChatGPT sign-in.
Coverage reports are code-01 through code-15. Agents write only their own reports and run no tests,
builds, live auth requests or publication. Parent owns integration and all coupled lifecycle changes.

Second wave: 16 bounded UI lanes sharing parent-owned isolated DEV captures and source. No 16
competing app instances or concurrent writers of App.tsx/styles. Implementation owners will receive
disjoint scopes after findings and backend contracts are settled.

The user explicitly authorized the complete UI check in the latest request. This permits a bounded
UI workflow review beyond the ordinary fast-check default, not a full repository/package test suite.
Parent will exercise each necessary UI scenario once and repeat only an actually failed case after
correction. No release packaging before the changed development target and focused checks pass.

## Acceptance

- A browser/account/tunnel issue is distinguishable from native runtime availability, with a clear
  recovery action and preservation of active work.
- Update readiness/rollback proves the candidate's actual usable startup and retains a coherent
  prior app/runtime/config; no version-only success claim.
- Account/token/tool boundaries remain enforced; no fabricated quotas or silent auth switch.
- Every principal UI surface has loading, empty, success, error, disabled and recovery behavior
  reviewed as applicable, including keyboard, small window, long labels and reduced motion.
- Motion improves feedback without moving click targets, hiding state or blocking actions.
- Source publication, platform packages, installed app and actual account behavior are reported
  separately. Original accounts/profiles and unrelated files remain intact.
