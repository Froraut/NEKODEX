---
name: nekodex-regression-prevention
description: Prevent recurring NEKODEX runtime, connector, evidence, lifecycle, gateway, and UI-readiness regressions when changing the backend or Electron bridge. Use for NEKODEX code changes that cross async operations, external resources, cached proof, accounts, tools, tunnels, services, or renderer state.
---

# NEKODEX regression prevention

Use this skill when a change can affect runtime state, connector identity, account evidence, browser or tunnel control, service files, journals, MCP/DEV tool transport, startup recovery, or readiness shown by the renderer. The goal is to prevent a previously fixed class of bug from returning through a new caller or state transition.

## Before editing

- Identify the state owner, the external resource, and the proof that a successful result is current.
- Search the direct callers and every positive writer of the state being changed. A new caller must use the existing invalidation and ownership path.
- Preserve the generation-4 connector pins: `Codex Native4`, `Codex Native4 DEV`, `Codex Zero Risk4`, their public schemas, App IDs, and ABI. A local fixture or visible connector name is not proof of live ChatGPT-side state.
- Keep read-only inspection separate from repair, reconciliation, uninstall, and recovery. Do not make a diagnostic read mutate files.

## Six invariants for every change

### 1. Async proof must be identity-bound

Any operation that publishes positive evidence after `await` must capture an epoch or complete identity before the await and re-check it immediately before publication.

The identity normally includes the relevant account, mode, connector contract/schema digest, runtime PID or instance, configuration revision, and operation generation. Invalidation must clear every dependent proof field, not only a boolean.

- Late success must be discarded after logout, account switch, mode change, connector failure, startup failure, migration, or runtime replacement.
- Use one backend predicate for current proof; do not let the renderer reconstruct readiness from unrelated booleans.
- A proof writer must be the only path allowed to create positive evidence. Ordinary `state.update({ ready: true })` is unsafe for proof state.
- Manual connector selection is operator evidence, not local runtime health. Represent the distinction explicitly.

### 2. External mutations need ownership checkpoints

Before and after each mutation of a plist, journal, cache, socket, browser popup, helper child, or service, retain a checkpoint containing the operation ID, owner, expected bytes or identity, and observed external state.

- Record ownership immediately after the mutation and before the next external call that can fail.
- Rollback only when the live resource still matches the operation's checkpoint. Never overwrite a concurrent edit or unconditionally remove a changed file.
- If the state is unknown, fail closed and provide recovery information; do not treat an error as proof that the resource is absent.
- A successful commit followed by cleanup failure is a successful operation plus a maintenance warning. Preserve both outcomes.
- A process is owned until exit and stream/close settlement is observed. SIGTERM, timeout, or a rejected promise alone does not prove that it is gone.

### 3. Caches and selections use invalidate-before-start and currentness-after-await

For account capabilities, catalog probes, browser operations, selection, smoke checks, and tool readiness:

1. invalidate the old evidence before starting a new inspection;
2. capture the revision/epoch and owner;
3. perform the async work;
4. re-check revision, owner, cancellation, and operation identity;
5. publish only if still current.

Failed inspection must not leave old capability claims usable. New explicit user selection must not be replaced by a late result from an older selection. Admission for a new turn is separate from readiness of an exact retained continuation.

### 4. Transport boundaries have an explicit representability contract

Before dispatching a nested MCP/DEV/gateway operation, determine whether its arguments and result can be represented at the outer boundary.

- Reject unsupported arguments before executing them.
- Preserve success/error state, structured data, metadata, bounded diagnostics, and supported non-text content according to one documented envelope contract.
- Never convert a nested error into success or silently drop its identity.
- If an action fails and cleanup also fails, retain the action as the primary error and attach cleanup failure as bounded cause/detail. Cleanup becomes primary only when the action succeeded.
- Keep public connector ABI stable; do not alter Native4 or ZeroRisk4 schema to hide an internal transport problem.

### 5. Diagnostics are report-total and failure-classified

A status or doctor command should still emit all independent checks when one probe fails.

- Convert each probe failure to a structured result with a stable issue code, safe category, and bounded detail.
- Distinguish expected “not found” from permission, timeout, transport, malformed-state, and unknown failures.
- Keep exit status consistent with the diagnostic result.
- Avoid bare `catch {}` in diagnostic or recovery paths. Every catch must explicitly recover, rethrow, downgrade, or record a safe fallback signal.
- Best-effort failure recording must report whether recording succeeded without blocking recovery.
- Service and `launchctl` probes must have explicit timeouts bounded by the enclosing deadline. A timeout or unclassified nonzero result is unknown state, not unloaded state.

### 6. Protocol records fail closed at the parsing boundary

Do not silently filter malformed protocol records into an apparently successful response.

- Detect call-shaped output before filtering it.
- Require non-empty, bounded call IDs and valid tool name/input at parse time.
- Reject undeclared, malformed, unsupported, and duplicate calls.
- Pair each result with the exact originating call ID, not merely the tool name or a fresh receipt ID.
- Clean up partially created brokers, sockets, workers, and transports when startup fails before the normal cleanup owner exists.

## Focused review before handoff

Perform a manual review of the changed path and direct callers. Ask:

- What can finish late, and what invalidates it?
- What exact resource does this operation own, and what proves it is still ours?
- Can rollback delete or overwrite a concurrent change?
- Can a cleanup error hide the primary error?
- Can a diagnostic probe block beyond its advertised deadline?
- Can the UI claim readiness from stale or incomplete evidence?
- Can a malformed tool call or nested result be silently accepted or lose fields?

Use only a small focused check relevant to the changed behavior (up to five named cases, within the repository's fast-verification limits). Do not turn this skill into a full-suite or broad audit requirement.

## Renderer and UI state invariants

Apply these checks to every launcher surface, wizard, settings form, account card, dialog, popover, and custom control. Static visual similarity is not evidence that interaction state is correct.

### Verified state must lock its form

- After account authentication, model check, connector check, credential save, or another completed verification, disable or make read-only every ordinary edit and verification control.
- Keep one explicit `Replace`, `Edit`, or `Upgrade` action as the re-entry path. Do not leave `Sign in`, `Check`, connector verification, enablement toggles, or credential inputs active beside a verified state.
- Do not allow an account with incomplete authentication/readiness evidence to become the current account. Selection must use the same readiness predicate as turn admission.
- Test the transition in both directions: pending → verified and verified → explicit replacement. A screenshot of the verified state alone is insufficient.

### Wizards and dialogs expose state to keyboard and assistive technology

- A stepper exposes the current step with `aria-current="step"` and a meaningful group/list label. CSS classes alone are not state semantics.
- A dialog has a labelled title, initial focus, Escape handling where appropriate, focus containment while open, and focus restoration to the opener on close.
- A dialog close must not leave focus on a removed element or behind an inaccessible overlay. Do not rely on `autoFocus` on one close button as a complete focus model.
- Re-entry, retry, success, error, and busy states must update accessible status text without making the whole surface appear inert.

### Custom controls must behave like their ARIA roles

- A `radiogroup`/`radio` uses roving `tabIndex` and Arrow/Home/End navigation, or uses native radio inputs instead.
- A `listbox`/`option` has an active option, keyboard navigation, selection semantics, and focus restoration to its trigger.
- A `role="tab"` must not contain a nested interactive close button. Separate the tab and close actions or use a valid composite pattern.
- Every disabled control must be disabled for the actual completed/busy state, not only visually dimmed with CSS.

### Motion and responsive behavior preserve function

- Reduced-motion or decorative-motion guards must not disable functional loading/progress feedback unless an equivalent non-motion status remains visible.
- Review narrow widths, long localized labels, empty states, errors and retry states. Check that controls remain reachable and focusable, not just that cards fit in a screenshot.
- When content remounts after a step/state change, announce or focus the new heading when that is needed for keyboard and screen-reader users.

### UI review evidence

For a UI change, record the state sequence used (`pending → checked → verified → replace`, or equivalent), the exact control expected to be locked, and the focused accessibility/keyboard behavior. Separate source-level evidence from a live screen-reader or installed-app observation. Do not accept a no-finding UI review that only searched strings or inspected one static viewport.

## Evidence and limits

Report source evidence and the exact state layer established: source contract, local runtime, installed app, or live account/ChatGPT behavior. Do not claim that a local schema, connector label, health endpoint, or passing focused test proves account-side approval, live DOM selection, or production behavior.

Known boundaries that require explicit handling rather than optimistic assumptions include cross-process compare/write races, non-cooperating child processes, OS scheduling interleavings, account-side connector cache/approval, and manual-mode connector selection.
