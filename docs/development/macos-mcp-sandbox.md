# macOS MCP process isolation

`src/agent-tools/sandbox.ts` builds an optional launch specification for the
official local `/usr/bin/sandbox-exec` provider. A requested sandbox fails closed
on Windows/Linux, if the provider is missing or unsafe, or if the reviewed
configuration, executable pin or directory identities no longer match. A server
without this option remains a separate, explicitly user-privileged MCP process.
There is no automatic fallback from requested isolation to user privileges.

## Trusted review and launch

Only the trusted server-configuration owner calls
`reviewTrustedSandboxConfig({ codeRoots, readRoots, writeRoots })` after the user
reviews those filesystem grants. The returned version 1 configuration records
the canonical path and device/inode identity of every root. Persist it with the
reviewed recipe. Model prompts, tool arguments, server output and raw Seatbelt
profile strings are not configuration sources.

The host passes that configuration, the exact executable and SHA-256 pin,
reviewed argument vector, current working directory and dedicated private HOME
and TMP directories to `buildTrustedMcpSandboxLaunch`. The private directories
must already exist, belong to the current user and exclude group/other access.
They are host-owned per-server storage, not the user's real HOME or a credential
directory. Writable roots must not overlap the executable or code roots.

The returned specification has `command`, `args`, `cwd`, `env`, `boundary` and an
`assertCurrent()` method. Pass the command/arguments/environment to the official
SDK stdio transport. Call `assertCurrent()` immediately before connecting it
after any asynchronous preparation. It rechecks the executable bytes, root
device/inode identities, private permissions and captured directory ancestors.
Symlinks, path quotes/backslash escapes, NUL/control characters and same-path
root replacements are refused. This is validation immediately before launch;
it does not claim an atomic filesystem lock against another process owned by
the same user. Package/entrypoint integrity remains the recipe owner's separate
pin verification; code-root read grants alone do not authenticate package bytes.

The environment contains only private HOME/TMP variables, a fixed system PATH
and C locale variables. It contains no copied credentials. The transport owner
must provide only its normal stdio pipes and no pre-open user file or network
handles. This matters because sandbox restrictions generally apply when a
resource is acquired; they do not revoke already open descriptors.

## Actual boundaries

The generated profile starts with `deny default`. It permits data reads only
from the reviewed read/code/write roots, dedicated HOME/TMP, and explicitly
listed system library/resource locations. Writes are confined to the reviewed
write roots and private HOME/TMP, plus exact `/dev/null` and `/dev/zero` writes.
Executable mapping is restricted to the pinned executable, code roots and
system libraries. New process execution is restricted to the pinned executable;
fork and self-signals are allowed. New network access has no allow rule.

The profile deliberately allows filesystem metadata reads on all paths, hardware
sysctls under `hw.` and the exact OS/runtime sysctl names returned in `boundary`.
Process-argument/environment sysctls receive no grant. This is not
filesystem-metadata confidentiality. Apple dyld on
snapshot boots also needs the system Cryptex library/cache paths and permission
to open the exact `/` directory as an `openat` anchor. The `/` exception is a
literal directory grant, not a recursive filesystem read grant. These exceptions
are returned in `boundary` alongside the user grants. Runtime module resolution
also receives literal directory opens/listings for ancestors of the granted
roots and executable; those exact paths are returned as `ancestorDirectoryReads`.
They do not grant reads of sibling file contents.

The provider is a deprecated OS interface, not an App Sandbox entitlement,
TCC override or replacement for the normal account's OS permissions. Protected
access can still be denied by those other controls. No global policy, SIP, TCC
setting or application entitlement is changed. A runtime requiring an additional
resource fails under the selected profile; a successful wrapper launch alone
does not establish MCP server compatibility or a business outcome.

The bounded fixture verifies that a fork child retains the same denials while
its sandboxed parent is alive and waits for it. It does not establish recovery,
termination or resource ownership for descendants that outlive the profile's
initial process. The MCP transport remains the child lifecycle owner; do not
label unobserved post-exit descendants terminated or verified.

## Verification and primary local evidence

On macOS 27.2, `/usr/bin/sandbox-exec` is present as a root-owned system binary.
Apple's installed `sandbox-exec(1)`, `sandbox(7)` and `sandbox_init(3)` manuals
describe custom profiles, inherited restrictions, resource acquisition and the
deprecation. The current `sandbox_init(3)` manual warns against using the old
named profiles with SDK 27 or newer; this provider generates an explicit profile
and never chooses a named fallback. Apple's installed
`/System/Library/Sandbox/Profiles/dyld-support.sb` supplies the primary explanation
for Cryptex-backed dynamic-loader reads and the literal root-directory open.
Those Apple profiles are private OS interfaces and may change with OS updates.

Focused verification is `bun test tests/agent-tools-sandbox.test.ts`. It compiles
a tiny C process into a disposable code directory and launches the generated
specification with only stdio. The process reads allowed synthetic content,
writes the selected output, receives kernel permission denials for an outside
synthetic read/write and a connection to an owned loopback TCP listener, verifies
the same denials in its fork child, and waits for that child. The parent test
checks exit code/signal, the JSON receipt, zero accepted connections, unchanged
outside bytes, absent outside writes and a reaped initial PID. The same focused
case checks grant replacement, symlink, argument/path injection and executable-pin
refusal; a second case checks unsupported-platform refusal.

A separate disposable script also started the installed Bun binary under the
same corrected profile, returned exit 0 with no signal/stderr and observed the
dedicated private HOME. That is Bun initialization evidence; the host's actual
MCP business flow remains a distinct integration check. A focused additional
case uses the official SDK `Client`/`StdioClientTransport` with this wrapper and
the existing local `tests/fixtures/agent-tools-server.ts`: it initializes,
discovers `record`, invokes it to write one allowed synthetic counter, checks
the exact structured result, closes both owners and verifies the PID is reaped.
It downloads no package and does not establish installation or behavior of an
external official server package.
