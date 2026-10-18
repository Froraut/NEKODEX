# Restricted selected skill scripts

The macOS source supports explicitly selected `.js`/`.mjs` under
`scripts/` as v3 `selected-local-executable-package`:32 KiB code each,16 resources
and512 KiB aggregate. Existing v1 text and v2 mixed-image identities/digests remain
unchanged. Immutable code is retained with the same package hash/tree owner;
selectedSkills contains script metadata only, never executable source in the prompt.

`skill-script/run` executes only the exact current attached package/entry closure.
The same ToolJournal owns per-operation human approval, durable intent, duplicate
outcome and reconciliation. A separate explicit task-generation workspace grant
captures canonical root/inode and read-only or read-write access. Picking a path
alone grants nothing; schemas enumerate at most8 current grant IDs. Grants are
ephemeral, never restored on restart; generation/access changes require fresh
acknowledgement. A grant permits at most128 operations. Import does not attach,
attachment does not grant filesystem access, and grant does not approve a run.

A plain trusted Bun executable pin runs fixed bootstrap/supervisor code. The
bootstrap calls macOS sandbox_init before importing selected code; the profile
denies fork, all further exec and network operations (socket allocation itself
may be allowed). Read/write roots and private scratch are scoped, with disclosed
global filesystem metadata and system-library reads. This is a deprecated Seatbelt
boundary, not a claim that every byte interpreted at runtime has immutable origin:
readable mutable workspace data can still be interpreted by selected JavaScript.
No shell/native executor, network grant or Native/account RPC is added by that
JavaScript route. The separate Python route is described below.

A supervisor durably records exact PID/start identities and the launch permit
before import. EOF, timeout, output cap and cancellation trigger physical reaping.
The selected runtime is bounded to15 seconds,16 KiB stdout/stderr,2 live operations
and256 retained executions. Supervisor SIGKILL/host loss remains unknown without
replay; retained live owners must also block a fresh executor instance. A bounded scan of at most256 retained private owner receipts now runs before
capabilities, admission and close, including fresh instances. Retained live or
missing-receipt ownership reports recoveryRequired/supportfalse and holds close.
The exact pinned Bun1.4.0 executor proof3/39 passed2.41s: fresh-instance status,
admission and close held until exact fixture physical cleanup, then close passed
while the original effect remained unknown. Root lazy close also opens retained
state when its directory exists. Peer closure re-review closed the P1 restart/lazy-close findings with no additional material findings. Failed cleanup must retain owner state and support only reconciliation,
not rerun. stdout/stderr are untrusted execution output, not verified task evidence.

Renderer review shows exact script text/SHA/manifest before import; generation and
access acknowledgement reset when changed. Dedicated picker/observe/revoke paths
preserve privacy during drain while new picker/grant admission is refused. Real
component evidence and real macOS execution evidence are separate, as recorded in
[review](../reviews/2026-10-18-restricted-skill-scripts-and-ssh-aliases.md).

Other binary formats, shell/other executables, network resources,
automatic dependencies and official/vendor copies remain unsupported. Native's
separate image binding budget is unchanged; execution does not prove real-model
success, external business outcome or installed delivery.

Final post-fix bothTS20:02, renderer197/1.20s and plainCLI648/11.29MB/exact `.9`
20:04 passed; peer P1closed/no additional findings. Root module-map is written,
finalcheck/paths pending after docs freeze; source commitCI and temporary CLI
cleanup remain root-owned.

## Selected Python resources

Explicit `scripts/*.py` resources use `text/x-python`, `kind: "script"` and
`runtime: "python"`. Packages containing Python have a new v4
`selected-local-polyglot-package` domain. Text/image/JavaScript-only v1/v2/v3
descriptors and digest domains remain unchanged. The Python source has the same
32 KiB per-resource and 512 KiB mixed-package bounds; review shows exact source,
runtime, bytes and SHA. Selected model packets contain metadata only.

The script owner determines the runtime from the verified attached resource;
the model cannot choose an interpreter or pass an execution runtime argument.
Discovery exposes a Python entry only when that runtime is admitted, and actual
handoff rechecks it. Generic JavaScript availability never authorizes Python.
Import/review remains possible without a Python runtime. The UI reports the two
runtime capabilities separately.

`skill-python-runtime.ts` admits one fixed Apple Xcode Python 3.9 framework.
Admission is passive: no PATH lookup, `/usr/bin/python3` shim execution, child
process, installer, user-site lookup or dependency installation. It bounds and
pins the canonical root-owned protected interpreter/stdlib dependency closure;
an in-process branded admission cannot be recreated from model/HTTP paths.
Status uses cheap retained identity checks. Dispatch revalidates dependency
metadata and the executable hash. A missing or changed framework leaves Python
unavailable while preserving the JavaScript runner.

The existing pinned Bun supervisor launches the admitted interpreter with fixed
`-I -S -B` arguments and a clean private environment. A fixed application-owned
Python bootstrap validates interpreter/base-prefix/search paths, waits for the
supervisor's durable PID/start permit, applies Seatbelt, writes and closes the
sealed control FD, then reads, hashes and compiles the exact selected `.py`.
Only then are immutable package directories added to module search paths.
No site customization or automatic dependency loading is enabled. Runtime and
bootstrap identities are retained with the execution receipt.

Python uses the existing per-operation approval, exact scope, ephemeral workspace
grant, limits, physical child reaping, retained-owner recovery and unknown/no
replay contracts. Its disclosed runtime read/map closure extends the JavaScript
system-library boundary. Fork, further exec and network operations remain
denied; writable workspace grants cannot overlap the admitted runtime. Selected
code can interpret data it is allowed to read, so this is not a guarantee that
every interpreted byte originated in an immutable package. stdout/stderr remains
untrusted output, and a successful script does not verify a task result.

Other Python distributions/versions, third-party dependencies, shell, PDF OCR/full visual interpretation,
network resources and Windows/Linux execution remain separate work. This source
contract is not installed-app acceptance or a real-model result.


Selected PDF v5 packages retain bounded raw PDF files as immutable dependencies,
without expanding non-PDF/code limits. Their separate approved text reader and
isolated PDFKit process are described in the [PDF contract](selected-pdf-skill-resources.md);
script execution never autoloads a PDF parser or receives new network authority.
