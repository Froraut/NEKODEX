# Review of the VM product refactor (629be10)

Independent review of `feat: connect VM output review and export with recoverable
task scope` on `codex/full-adoption-20261018` (PR #98). Line numbers refer to
`629be10`. Status: **fixed here** (this branch, with tests) or **open**.

## Fixed in this branch

1. **VM status fails while the VM owner is busy** — `src/execution-environments/product.ts:48`.
   Task-scoped `vmStatus` reconciles every saved `vm-shell/run` whose journal row
   exists. A begun run keeps its `outcome_unknown` row while the VM is live, and
   `VmExecutor.reconcile` throws `vm-owner-busy` (`executor.ts:139`), so the whole
   status request failed during every live run (and while another profile held the
   store lock). Restoration is now best-effort and retried on the next status;
   identity conflicts still fail closed. Test: `tests/execution-vm-product-status.test.ts`.
2. **Unknown export outcomes could not settle through the tool path** —
   `src/execution-environments/export-tools.ts:17`. `reconcile` mapped to
   `bridge.receipt` → main `inspect()`, which never confirms the retained
   written-node proof (`workspace-vm-export.cjs:541`). A lost response after
   publication stayed `outcome_unknown` forever, which also blocks
   `refresh-execution`. Unknown receipts now escalate to main `reconcile()`
   (proof confirmation, never a re-offer). Test: `tests/execution-vm-export-tools.test.ts`.
3. **Consumed reviews are still offered to the model** — `launcher/electron/workspace-vm-export.cjs:619`.
   `list()` returned reviews already bound by an accepted intent; a second call is
   always refused as `review-consumed` (and, see open 1, left unknown). `list()` now
   omits them; receipts stay listed. Test: `tests/workspace-vm-export-review-list.test.ts`.
4. **Protected destinations were compared case-sensitively** — `workspace-vm-export.cjs:238-251`.
   On a case-insensitive APFS volume `.SSH/config` reaches `.ssh/config`. Case is
   folded on darwin/win32 (can only refuse more). Same test file.
5. **Candidate reads after a core restart** — `src/agent-tools/composition.ts` `readVmCandidate`.
   The in-memory operation map was only restored by a task-scoped `vmStatus`, so an
   approved export of a pre-restart review failed with `vm-candidate-unavailable`
   unless the user had refreshed VM state. Candidate reads now restore first.
6. The export review zod schema in `launcher-export.ts` is now bound to
   `export-contract.ts` with `satisfies`, so the duplicated wire schema cannot drift
   silently from the renderer/main contract.

## Open (for the owner of the main export service)

Status 2026-10-21: all eight items are fixed on `main` by `eccf6f3`; the renderer
reconcile action from item 2 landed in `b8217da`. The findings below are kept as
reviewed, with the fix noted under each.

1. **Refusals before an intent leave the core journal `outcome_unknown` forever** —
   `workspace-vm-export.cjs:431-457`, `launcher-export.ts:98-117`, `control-server.cjs:695-697`.
   `review-consumed`, `prior-export-held-or-capacity`, `closing`, lock `EWOULDBLOCK`,
   transient `validateIntent` failures, and the bridge's "listed exact review" /
   "instance changed; no request was sent" all throw; the host keeps the pre-dispatch
   unknown row, `inspect`/`reconcile` return `null` (no action dir). Write a signed
   terminal `failed` record under the action key for pre-intent refusals and return
   `failed` from the bridge where nothing was sent (typed error, not message matching).
   **Fixed (`eccf6f3`):** pre-intent refusals settle a signed terminal `failed` record
   (`accepted: false`) under the action key, and the bridge returns `failed` with
   `vm-export-not-sent` through the typed `VmExportNotSentError`. Tests:
   `tests/workspace-vm-export.test.ts`, `tests/execution-vm-export-bridge.test.ts`.
2. **Retained unknowns veto quit/updates and have no UI reconcile** —
   `workspace-vm-export.cjs:672-686,704`, `main.cjs:1124`, `AgentVmExport.tsx:71`.
   `reconcileVmExport` is exposed by preload/IPC but no renderer code calls it. Count
   only in-flight work as the current global operation; add a reconcile action.
   **Fixed:** `activeCount`/`currentOperation()` count only queued and in-flight work
   (`eccf6f3`); `AgentVmExport.tsx` has the "Inspect exact saved export outcome" action,
   which calls `reconcileVmExport` with the saved exact request (`b8217da`). Test:
   `tests/vm-export-reconcile-view.test.ts`.
3. **Knowable states never settle** — `workspace-vm-export.cjs:578-580, 436-437, 468-469, 639-641`.
   No `publication.json` proves nothing was renamed (it is written in `beforePublish`),
   yet reconcile returns unknown; an action dir without `intent.json` is unknown forever
   and makes `hasRetainedState` true for every workspace.
   **Fixed (`eccf6f3`):** reconcile settles a missing `publication.json` as signed
   `failed` (`vm-export-publication-not-started`), and an action dir without
   `intent.json`, publication or terminal record as a signed refusal
   (`vm-export-intent-not-recorded`). Until that exact request is reconciled, the dir
   still counts in `hasRetainedState`. Test: `tests/workspace-vm-export.test.ts`.
4. **In-process lock contention fails instead of queueing** — `workspace-vm-export.cjs:211`
   (`O_EXLOCK|O_NONBLOCK`): a Review click during an export's candidate read fails.
   Chain in-process operations before taking the file lock.
   **Fixed (`eccf6f3`):** in-process operations are chained on one queue before the
   file lock is taken. Test: `tests/workspace-vm-export.test.ts`.
5. **Capacity is permanent** — `workspace-vm-export.cjs:197-198, 377, 445`: reviews and
   actions are never pruned; after 64 of either, export stops working.
   **Fixed (`eccf6f3`):** `compact()` moves settled actions to signed `settled/` receipts
   with `consumed/` review markers and evicts the oldest unaccepted review when a new
   one needs room; exact replay and consumed-review refusal survive. Test:
   `tests/workspace-vm-export.test.ts`.
6. **One half-written review dir breaks `list()`** — `workspace-vm-export.cjs:414-416`;
   discovery then silently drops the export tool. Write under a temp name and rename.
   **Fixed (`eccf6f3`):** reviews are written under `.pending-<id>` and renamed;
   discovery skips staging names and dirs without `review.json`. Test:
   `tests/workspace-vm-export.test.ts`.
7. **Refresh un-pauses tasks** — `src/agent-mode/store.ts:226`: `paused` and
   `awaiting_input` become `ready`. Preserve an explicit user pause (owner-recovery
   pauses may reasonably resume).
   **Fixed (`eccf6f3`):** refresh keeps an explicit user pause (`reason: 'pause'`) and
   `awaiting_input`. Test: `tests/agent-mode-refresh-execution.test.ts`.
8. **Duplicated request schemas with different limits** — toolCallId 200 (`control.ts:8`)
   vs 512 (`launcher-export.ts:49`, `workspace-vm-export.cjs:33`); idempotencyKey 240 vs
   512; two different exported `VmExportScope` types. Move one zod module into
   `export-contract.ts`.
   **Fixed (`eccf6f3`):** one dependency-free validator,
   `launcher/electron/vm-export-contract.cjs` (`VM_EXPORT_LIMITS`: toolCallId 200,
   idempotencyKey 240), serves `workspace-vm-export.cjs` and `control-server.cjs`;
   `export-contract.ts` wraps it as the zod schemas used by `control.ts` and
   `launcher-export.ts`, which no longer exports its own `VmExportScope`. Test:
   `tests/execution-vm-export-contract.test.ts`.

## Quality

The review note calls the result "readable blocks", but the core files remain very
dense: `tools.ts` has 15 lines over 200 characters (max 378), `AgentVmShell.tsx` 17
(max 1173), `AgentVmExport.tsx` 14 (max 782). `activeCount` re-reads and HMAC-checks
up to 64 records synchronously on every `currentGlobalOperation()` call. Splitting the
JSX and the `tools.ts` provider into named functions would make the next change cheaper.
Status 2026-10-21: `activeCount` now reads only in-memory counters (`eccf6f3`, item 2).

Verified correct: write/fsync/rename order, intent recheck after awaited reads with no
await before publication, execute replay returns the saved terminal, no candidate bytes
or filesystem proofs cross renderer IPC, `.d.cts` declarations match the `.cjs` exports.
