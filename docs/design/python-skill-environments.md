# Python skill environments: implementation contract

This describes the current macOS development implementation, not universal Python
dependency support or completion of P16/P17. See the
[verification report](../reviews/2026-10-19-python-environments.md) for completed
checks and pending live acceptance. General shell/external commands, broader
dependency formats, network grants and other operating systems remain open in
the [adoption program](full-adoption-program.md).

## One runtime, separate preparation and execution authority

`src/agent-tools/composition.ts` owns one `SkillPythonEnvironmentStore` at
`join(coreHome, 'skill-python-environments')`. It shares the same lazy, branded
`AdmittedPythonRuntime` object with `SkillScriptExecutor`; it does not select a
second interpreter. The fixed protected Apple runtime supplies its full Python
version from a pinned canonical header. Bootstrap checks the three-part runtime
version rather than inferring a patch version from the version family.

The connected flow has three distinct decisions:

1. Explicit local **Review** selects canonical wheel files and snapshots their
   exact bytes; explicit **Prepare** confirms the returned action/review digest.
2. Explicit **Attach** binds an admitted environment to the exact task and current
   generation. An environment's existence or preparation gives no task authority.
3. Each selected Python script invocation still requires its normal workspace
   grant and ToolJournal approval. Attach does not approve execution or add tools.

Guarded HTTP, main IPC/preload and the skill scripts UI expose these decisions
and exact action inspection/reconciliation. Requests carry bounded local paths
for Review, opaque environment/action identities and explicit intent; wheel bytes
do not require raising the existing 128 KiB control-body bound. Models receive
the exact bound environment ID in the tool schema, not a host filesystem root.

## Offline selected-wheel policy

`skill-python-environment.ts` performs preparation synchronously with no package
import, Python startup, subprocess, pip, resolver, setup/build hook or network.
Artifacts must already have been obtained and explicitly selected by the user.
The accepted format is pure `py3-none-any` or `py2.py3-none-any` wheel without a
build tag; it is a declared supported wheel policy, not every valid wheel format.

Central/local ZIP records, member bounds, paths, case collisions, regular-file
types, compression, actual expanded sizes and CRC are checked. Bounded streaming
DEFLATE shares one aggregate budget across all selected artifacts. METADATA,
WHEEL, tags, normalized distribution identity and exact SHA-256 RECORD coverage
must agree. No selected path can escape or replace an existing foreign path.

The complete selected distribution assignment must satisfy declared dependencies
and the exact admitted Python version. `@renovatebot/pep440` is pinned to 5.0.1.
A narrow adapter corrects its simplified exclusive comparisons using its version
parser/order and the [PyPA exclusive comparison rules](https://packaging.python.org/en/latest/specifications/version-specifiers/#exclusive-ordered-comparison),
including `>1.7.post2` accepting `1.7.post3` and `<1.0rc2` accepting `1.0rc1`.
Explicit artifact selection opts into that artifact's prerelease; no package
discovery or automatic version choice occurs.

PEP 508 markers, extras and direct URLs are explicitly refused. *Status 2026-10-21: superseded on `main`: `src/agent-tools/skill-python-requirements.ts` now evaluates PEP 508 markers, extras and direct-URL pins, but only against explicitly selected artifacts with exact SHA-256 mappings; nothing is fetched or resolved (see [standalone skills resources](standalone-skills-resources.md)).* Native extensions,
native executable payloads, `.pth`, bytecode/startup customization, editable
metadata, `.data` installation schemes/scripts, sdists, VCS/build inputs, declared
external requirements and unsupported archive/metadata features are refused.
No dependency is silently omitted to make a closure pass. This policy does not
claim static proof of every Python import or universal code-origin enforcement.

Bounds: 16 wheels; 8 MiB per artifact / 32 MiB selected compressed bytes;
4,096 aggregate archive entries; 2 MiB per expanded file / 64 MiB aggregate
expanded bytes; 32 retained actions; 2 MiB signed registry and manifest bounds.
Registry publication reserves 1 KiB per retained action for terminal metadata.
There is no automatic environment update, deletion or garbage collection API.

## Immutable identity and private ownership

The environment ID binds policy version, exact runtime closure, normalized locked
distribution versions/artifact hashes and the complete extracted path/hash/size
tree. Review retains immutable artifact and extracted snapshots. Prepare verifies
those snapshots and publishes a new read-only private data tree; it never updates
an environment in place. Existing destinations must match exactly or are preserved.

Only the store can create the WeakMap-branded `AdmittedPythonEnvironment`.
Admission validates the signed ID-bound manifest and complete data tree. Dispatch
rechecks the brand, exact runtime, metadata and content; a plain object copy is
not authority. Passive capabilities use metadata checks rather than rehashing
the environment on every UI refresh.

Public descriptors expose identities, packages, counts, availability and bounded
reasons. Private roots, snapshot paths, integrity keys and branded authority objects
do not cross UI/model boundaries. The sandbox's public ancestor-read projection
also excludes the private environment ancestry. Typed public error helpers retain
fixed validation reasons and replace arbitrary OS/runtime errors with a generic
safe reason, preserving unrelated tools status if this optional store is damaged.

## Durable preparation and explicit reconciliation

All mutations hold a persistent private canonical `.lock` inode using Darwin
`O_EXLOCK | O_NONBLOCK`; the lock is never unlinked. Fresh signed registry state is
loaded under the lock, which covers review/preparation/publication/settlement.
The kernel releases the advisory lock on close/death; there is no PID takeover,
process kill or stale-lock replay. Other platforms cannot claim this mutation
boundary from the macOS implementation.

Prepare first durably records the exact prepared action, then stages/fsyncs the
private tree, publishes its final directory and records ready. A signed pending
registry publication projects its exact action unknown/held across restart.
Malformed or contradictory evidence fails closed. Passive `inspect`, `actions`
and `list` never settle or retry preparation.

Separate explicit `reconcile` first persists held identity before archiving exact
pending publication evidence. It can validate an already-published matching tree
and settle the same action, or recover an exact reviewed snapshot as reviewed.
It does not extract, reinstall or rename an environment again. Missing/partial
final evidence remains unknown/held and blocks new preparation; a new UUID is
not a bypass. Successful lock acquisition alone proves neither no effect nor ready.

## Execution and revocation

The admitted environment data root is read-only input, not an executable-mapping
or write grant. Overlapping workspace write grants are rejected before creating
a run directory. The existing `-I -S -B` runtime, clean environment, no site
processing, Seatbelt-before-selected-code, sealed/closed control FD, fork/exec and
network denial remain unchanged. Bootstrap adds the exact admitted environment
to `sys.path` only after sealing. Stdlib-only Python remains the default when no
environment is bound; JavaScript cannot consume a Python environment argument.

Provider binding and invocation revalidate exact task/generation/environment
identity. Revocation cancels/drains accepted operations through physical settlement;
an early unknown promise does not clear physical ownership. Existing supervisor
PID/start, timeout/output/cancel/EOF receipts and no-replay semantics remain in
force. An execution receipt does not by itself verify a business outcome.
