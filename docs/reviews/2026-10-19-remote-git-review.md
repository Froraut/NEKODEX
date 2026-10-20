# Remote Git Review development verification — 2026-10-19

This report covers the implemented development-source Remote Git Review batch.
The [implementation contract](../design/remote-git-review.md) retains the full
status/diff/conflict and separately approved stage/unstage/commit scope assigned
to P07/P08 in the [adoption program](../design/full-adoption-program.md).
It is not installed-app acceptance, full local/remote P07 parity, or completion
of all 44 program requirements.

## Implemented owner and approval boundary

One main-owned controller uses the existing selected SSH transport and per-host
exclusive owner. Captures bind the connection, repository and common-directory
identities, HEAD/base/index, merge state and selected file revisions. Private
plans contain exact reviewed bytes; IPC exposes bounded review metadata only.
Prepare has no Git index/object/ref effect. Separate Apply approves its exact
action ID and review digest.

Stage preserves unrelated index entries; Unstage changes only the index. Commit
uses the complete reviewed staged tree, explicit message and author/committer,
including unborn and resolved-merge parent handling. Fixed Git options disable
hooks, signing, editors, replacement objects, external diff/textconv, credential
and transport callbacks. Unsupported conversion and repository states are
refused, with global/system Git configuration and attributes isolation disclosed.
There is no implicit add, checkout, fetch, reset, push or Agent tool grant.

The v2 RemoteWorkspace registry atomically persists each signed prepared action
with its signed started receipt, and atomically settles the matching pair.
The helper fsyncs a separate remote UUID ledger before effects and owns a private
common-directory gate across aliases/worktrees. Git `index.lock` and ref CAS
protect publication against ordinary Git writers. These operations still use the
SSH user's permissions; the repository root is not an OS command sandbox.

Lost acknowledgements and persistence uncertainty retain unknown/held ownership.
Exact inspection can establish an existing result without redispatch. Passive
offline action listing does not contact SSH. Explicit local pruning is limited
to safe reviewed or settled nonheld rows and leaves remote deduplication records
intact. Missing local actions cannot be applied again.

## Completed focused evidence

| Boundary | Result | Scope |
| --- | --- | --- |
| Independent source peer review | No remaining material finding at source freeze | Controller, fixed helper and facade; no runtime acceptance claim. Final helper SHA-256 `626ceec84efc2e4bc05f3ae3d010fd107ff38c96304cd18a5bfeca636bf5d9f8`. |
| Backend `tests/remote-git-review.test.ts` | **5 PASS / 74 assertions** | Pinned Bun 1.4.0; temporary real Git repositories, no SSH. |
| Facade + retained Agent remote flow | **2 PASS / 67 assertions** | Atomic signed registry/receipt integration, lost-result inspection and unchanged Agent boundary. |
| Rendered component fixture | **1 PASS / 28 assertions** | Behavioral review/approval/unknown-state flow and Russian limitation-copy assertions; inert port, no real SSH or integrated CSS claim. |
| Root and renderer TypeScript | **PASS** | Both affected type boundaries. |
| Staged renderer build | **203 modules, PASS** | Development source compilation; no installed replacement claim. |
| Architecture map check | **PASS** | Changed ownership map consistency. |
| Actual isolated SSH/UI flow | **24/24 independent checks PASS** | CUA conflict/editor/review/Apply flow; three completed signed action/receipt pairs and three terminal remote ledgers. |

The five backend scenarios cover normal stage/unstage/exact-tree commit with
rename, binary and unrelated staging; unborn commits and stale file/index/ref
refusal; attribute/callback refusal; conflict stage reads and resolved merge
parents/metadata; lost commit reply and restart inspection without replay; alias
serialization and preservation of foreign index locks/remote gates. A local
terminal publication failure is held until exact settlement, without another
remote command. Mutation children were joined through natural close before
temporary repository cleanup. The one target finished exit 0 in 22.69 seconds;
no broad suite or live business repository was used.

Private backend log and terminal receipt were retained under
`nekodex-remote-git-backend-proof-h9cu7nmx` in the task's macOS temporary directory.
Unchanged earlier Native, SSH worktree and local Git proofs were reused rather
than rerun as evidence for this new surface.

## Real isolated SSH/UI acceptance — PASS

The retained private evidence record `remote-git-real-20261019.json` records the
completed QA-only flow, independently verified at 03:00:03 UTC. No model offers
were used. Actual CUA interaction inspected ours/theirs conflict stages and opened
the conflict path in the SFTP editor. An independent fixture writer changed the
file before Save: Save refused without overwrite and retained the exact draft.
QA explicitly accepted the new baseline, saved the retained resolution and read
it back. This demonstrates the observed concurrent-edit boundary, without claiming
an OS sandbox or adversarial filesystem CAS.

Each of three actions used a separate actual QA review checkbox and Apply under
the authorized isolated test scope; this is not personal human approval evidence.
Stage selected only `conflict.txt` and `notes.txt`. Unstage selected only
`notes.txt` and preserved its worktree bytes. The staged diff showed the intended
resolution. Commit review showed the complete two-entry index, including the
unchanged staged baseline of `preserved.txt`, with explicit author/committer,
message and both merge parents.

Independent SSH observation matched the completed commit receipt:

- Commit/HEAD: `39a30470c3817b687e60af7523d6b2c3147a1d2a`.
- Tree: `db04cc5e0ece73e4824d9e71c644ae292461edd7`.
- Exact parents: `7386182468aacb7c4558f083091617ddd2745b1c` and
  `944ab62b53211e97873b15bf2fab37b5b779a997`.

All 24 independent checks passed: exact resolution/index/tree, preserved unrelated
working changes and untracked notes, no remaining unmerged entries, settled merge
metadata, explicit author equal to committer, exact message and no callbacks.
The three distinct main-owned signed action/receipt pairs and all three remote
UUID ledgers were completed/nonheld, with no mutation replay.

Root disconnected the UI transport, observed active count zero and completed
guarded fixture retirement at 03:02:00 UTC. Cleanup removed only the verified
71 fixture-owned nodes; durable local records were retained. Public documentation
omits the private host address, temporary root nonce and receipt signatures.

No real mid-effect network interruption was injected. Lost reply, restart and
unknown reconciliation were exercised by the focused backend/facade checks,
and must not be presented as a live network-loss result. Binary/truncated editing,
unsupported conversion/sequencer states, declared bounds and simultaneous non-Git
writer limitations remain explicit.

## Final development delivery observation

The final Russian/English copy maps all eight known helper limitations to clear
explanations. A focused update of the existing rendered case confirmed the
Russian explanation is visible and the raw helper token absent: **1 PASS / 28
assertions**, superseding the earlier 26-assertion result. Its browser/server
closed; this component fixture does not serve application CSS.

Renderer TypeScript and the final 203-module build passed. Root gracefully
retired the superseded development pair and opened the final build against the
same private profile. Actual macOS CUA loaded all three completed Git action
records offline after restart, with SSH disconnected and no redispatch. The
real connected-flow window established integrated styling; the final copy-only
build retained those styles. Twelve Agent tasks, cached qualification metadata
for ten Native models and four retained Native dialogs remained visible. Native
execution stayed closed and the Git batch sent no model offer. The user app was
left open on retained dialogs; superseded renderer intermediates were removed.

The new CI step runs only the two focused remote Git targets on Linux under the
existing automatic source workflow. Exact-head CI publication is separate from
the local macOS/SSH evidence above. No installed replacement, release asset,
local mutation parity or full 44-requirement completion is claimed.
