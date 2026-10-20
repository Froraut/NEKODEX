# VM product integration and recovery refactor

## Problem and resulting behavior

The offline VM leaf already ran real commands, but its product flow crossed
independent eligibility rules in the core, tool composition, main export owner
and renderer. A completed task could not review its output (`review_required`
was rejected as if it were an execution request). Restart or correction changed
the current task generation and hid its retained output. A newly qualified Native
admission also left the task pinned to an unavailable old admission without an
explicit recovery action.

The development app now completes the connected path: select a prepared offline
runtime, attach explicitly chosen inputs, approve one saved VM call, retain its
private output, review a host destination, approve a separate saved export call,
observe the real written file, then explicitly verify the Goal. A retained output
can be reviewed in a later generation of the same task without replaying execution.

## Responsibility and authority

- `execution-environments/product.ts` owns environment/attachment coordination
  and exact retained-result rehydration. The generic composition delegates; the
  existing ToolJournal remains the approval owner.
- `output.ts` distinguishes current task access from original output generation.
  Both renderer consumers use one candidate selector; candidate reads use its
  same-task/source-generation predicate. Old bindings and approvals stay invalid.
- `export-contract.ts` owns renderer-safe review/receipt DTOs, shared with main
  declarations. Bytes and private filesystem proofs remain outside renderer IPC.
- Private export control permits review of the current owned completed task, but
  publication still requires a current pending call and its already begun exact
  ToolJournal intent. Main rechecks this intent after awaited candidate reads.
- The main export service is expanded into readable blocks with one visible
  signed-intent/publication/settlement transaction. Unknown outcomes reconcile
  their written-node proof and never reapply the export.
- Explicit `refresh-execution` resolves the current host-selected admission for
  the same model/provider, invalidates the old generation and grants, preserves
  completed stages/history/bounds, and sends no inference. Live/unknown work
  refuses refresh. UI explains the currently connected account; original tasks
  have no persisted account-source tuple proving historical account equality.

## Actual macOS development acceptance

On 2026-10-19 the task `3c97984c-135d-4021-8538-21bb08c9f41e` ran an external
BusyBox awk command through the offline ARM64 VM. Its one completed VM operation
`40df805d31c47a1cdb4203c51b3132aee83acbf08a0022cf33d7c951bf7f966d` retained
`result.csv` privately. The runtime and GUI were replaced with settled-owner
observations; no VM command was replayed. An explicit same-model admission refresh
and stage correction retained the completed calculation. Generation 4 reviewed the
original generation-1 candidate and exported it through the actual UI.

Export review `3d59259f-32a6-4cad-9fb4-9318ef2ca2d2` and completed receipt
`df85045e-5eb1-42de-9389-9f16b227ed8e` bind the separate host publication.
The independent file read and main artifact observer agreed:

```text
marker,total
VM-PRODUCT-662c2723-238f-42da-9d48-b9e62c1c585f,46.00
```

67 bytes, SHA-256
`e114b9601367c6156d7462d0affdc0515253d5fb57a1d4492bf536e1b78b79e4`.
The original input independently determines the marker and arithmetic. Four
Native offers and two separately approved tools (one run, one export) settled.
The main file observer covered r1, and explicit QA Review/Verify reached
`verified_complete`. Approvals were performed by the agent in the authorized QA
workflow, not a new personal human approval.

The last model summary confirmed the export hash but did not report marker/total,
because the later stage's report context did not include those raw prior tool
values. File correctness is independently proved; arbitrary long-task semantic
context retention is not established by this acceptance.

After acceptance, active VM operations and task VM bindings were empty; temporary
Native workers were closed. The current DEV pair and accepted CSV were retained.

## Focused verification

- Product recovery, private export admission and main export: 9 pass, 99 assertions.
  Includes real 16 MiB binary publication, stale edit/draft protection, protected
  destinations, lost-response reconciliation, historical output and final intent
  revalidation. These ran after the extraction/readability changes.
- Explicit task admission refresh: 2 pass, 21 assertions; no sends, preserved
  completed stages/history, exact retries and unknown/stale rejection.
- Root/renderer TypeScript checks and renderer build passed (207 modules).
- Main export and Agent IPC syntax checks passed; the architecture map was updated.
- Earlier VM provider, bridge and physical-stop checks remain retained evidence for
  unchanged behavior; no broad repository suite was run.

This is source/development delivery. It does not establish a new installed app,
production VM runtime, native compilers/Python builds, network grants, arbitrary
helper-loss recovery or Windows/Linux parity. Full P16/P17 and the 44-item macOS
program remain open. One-file revision checks are application-level protection,
not adversarial OS-level compare-and-swap.
