# Standalone Agent tools and selected skills

This module is an independent Agent-mode tool host with authenticated admin routes,
a guarded Electron IPC registrar and a dedicated tools/skills surface. It does not import the
ChatGPT Web MCP broker, discover another client's registry, or change global
skills, plugin installations, credentials, AGENTS.md, or client configuration.
It has source implementation and an actual offline SDK/admin fixture; source
composition is distinct from an installed application and live provider result.

## Public composition

`src/agent-tools/index.ts` exports these host contracts:

| API | Authority and result |
| --- | --- |
| `defaultToolsConfig()`, `readToolsConfig(path)`, `writeToolsConfig(path, config)` | Versioned private metadata; defaults disabled with no servers. POSIX regular files use 0600; Windows is unavailable until an ACL backend exists. Metadata accepts credential references, not an environment-value field. |
| `StandaloneMcpHost({config, journalPath, isScopeActive, resolveSecret?, requestTimeoutMs?})` | Uses the installed official `@modelcontextprotocol/sdk` Client/StdioClientTransport. The task owner supplies the current task/generation predicate and credential owner. |
| `host.discover({taskId,generation,toolCallId}, {signal?})` | Starts only enabled, explicitly configured servers. Returns descriptors with exact `serverId/toolName`, JSON input schema and supported/unsupported status. Parallel scans construct local candidates and publish a complete catalog only after final scope/abort checks; a failed candidate preserves the previous complete catalog. Discovery is not permission to execute. |
| `host.authorize({scope,tool,arguments})` | Trusted host only, after human/policy approval of exact arguments; returns a one-use grant bound to task, generation, call, arguments and current schema. Never expose this method as a model tool or unguarded renderer action. |
| `host.invoke({scope,tool,arguments,grantId,idempotencyKey}, {signal?})` | Validates schema and exact grant, writes durable unknown before dispatch, then returns the terminal SDK result or retained unknown. |
| `host.getOutcome(idempotencyKey)` | Reads exact private receipt for reconciliation. Raw tool results can contain private content and should not be exposed as general diagnostics. |
| `host.terminalReference(key, requirementId)`, `host.resolveTerminalEvidence(task, reference)` | Trusted projection of the exact terminal protocol receipt, matching Agent-mode evidence-reference types. Only property `mcp.tool-terminal-result` is supported; task/generation, subject and result revision must match. The requirement text must exactly equal `mcpTerminalRequirement(subject)` and therefore explicitly ask for that protocol observation. Unknown results cannot become passing evidence. |
| `host.snapshot()`, `await host.close()` | Snapshot gives owned PID and connection state only. Close cancels pending requests, closes only owned SDK transports and waits for invocation settlement before closing the journal. |
| `ReadOnlySkillLibrary(rootGrants).discover(grantId)` / `.select(identity)` | Bounded source-aware discovery and selected content from explicitly granted canonical roots. Selection rechecks canonical identity and SHA-256. |
| `unavailableNativeSandbox()`, `requireNativeExecutionAuthority(...)` | Capability/policy contract. Native commands and writes have no executor in this implementation and remain unavailable. |

`createAgentToolsComposition({home, authorize, canStart?, isScopeActive,
resolveToolCall?, onOutcome?})` lazily owns the host and exposes `handle(Request)`
for POST `/admin/agent-tools`, `toolsPort`, `selectedSkillContent(scope)`,
`resolveEvidence(task, reference)`, `activeCount` and `close()`. Root composition
supplies Agent runtime `resolveToolCall` and `recordToolOutcome` through
`onOutcome`. The host only authorizes the exact privately persisted pending
call, never caller-provided arguments or a caller-provided result.

The server supplies `canStart` from local tools admission:
`admission.accepting && !launcherDetached`. It does not depend on the Web
broker or tool tunnel being ready. An attached, running local owner can prepare
task-generation browser/desktop bindings, select skills and discover the passive
unsupported descriptors while offline. New desktop permission inspection,
window listing, enablement and selection also require this local admission;
inspection can start the native helper only after its explicit user action.
Drain, committed shutdown and launcher detachment prevent new admitted work.
Status and explicit desktop disable/revoke remain available during drain for
cleanup, and closing the composition drains its existing owners.

Agent model admission is separate: `AgentModeRuntime.canStart` still uses
`acceptingTurns`, including Web broker/tunnel readiness. Offline local setup
does not offer a model request, create a pending tool call or authorize tool
execution. Invoking a previously recorded call still requires the exact active
task/generation, separately approved arguments, one-use grant and durable
journal admission. An already accepted tool owner can finish and retain its
receipt through a Web outage; another model stage waits for Web admission.
Launcher detachment refuses active Agent turns/tools rather than abandoning
their accepted owners.

Admin actions are `status`, `reviewServer`, `saveServer`, `setEnabled`,
`removeServer`, `discover`, `approveInvoke`, `receipt`, `skillRoot`,
`removeSkillRoot`, `skillsDiscover`, `skillsSelect`. Configuration review pins
the actual executable and scripts and returns a bounded review token; save
rechecks exact bytes and the configuration snapshot from review. Human review
has no arbitrary timeout. Shell/installer/inline-evaluation recipes are refused.
The config remains globally disabled until a separate explicit enable action.
Reconfiguration refuses while owned operations are active, drains the old host
before replacing saved settings, and participates in shutdown observation.
Removing a server removes its configuration; it does not uninstall user software.

`registerAgentTools({handle,runtimeHost,dialog,getWindow})` registers
`launcher:agent-tools` and `launcher:agent-tools-pick-skill-root`. It reuses the
existing guarded sender registration, current owned runtime readiness and
authenticated supervisor control. The native directory picker contributes an
explicit same-host read grant, not a model-selected filesystem path.
`AgentToolsSurface({api,language,disabled})` consumes injected `request`,
`pickSkillRoot`, `listTasks`, `getTask`. It shows configured sources/hashes/owned
PIDs, reviews exact argument JSON before explicit invocation, and shows retained
unknown outcomes without automatic replay. Root main/preload/navigation wiring
remains with the application composition owner.

The generic `StandaloneToolsPort` has `discover(scope, options?)` and
`invoke(invocation, options?)`; browser/desktop adapters can consume it while
retaining their own exact observation and target contracts. Their mapping and
grant resolver belong to the trusted host, not model arguments. A successful
SDK result is evidence of that exact protocol result. It does not independently
prove an artifact, delivery, browser action or requested business outcome.

### Trusted built-in execution and selected browser calls

`StandaloneBuiltinToolsProvider` is a small trusted registration contract:
`serverId`, `discover(scope, options)`, `execute(originalRequest, options)`,
optional read-only `reconcile(originalRequest, options)`, and optional
`invalidate(taskId)`. It owns no approval or journal. The existing standalone
host owns supported schema validation, exact one-use grants, durable
unknown-before-effect admission, terminal settlement and cancellation for both
MCP and built-in tools. Built-in journal events use their namespace (for example
`browser:`); MCP events remain `mcp:`. The `mcp` built-in namespace is reserved.
A configured MCP/built-in namespace conflict fails explicitly without replacing
or deleting the configured server or dispatching either source by alias.

Composition accepts trusted `builtins` and an optional `browserTools` control
port created by `createAgentBrowserToolsProvider`. The root supplies its current
companion runtime through a callback; status/discovery does not start a browser,
listener or pairing. MCP enablement gates MCP servers only. Browser tools remain
off until a human explicitly attaches the exact currently selected companion
binding to an owned task generation. Browser authority is not persisted across
restart. The existing generic tool admin route supports `browserStatus`,
`bindBrowserTools` (scope plus exact expected binding) and `revokeBrowserTools`;
there is no raw observe/click/type admin execution route.

The model receives fixed `browser/observe`, `browser/click`, `browser/type`
descriptors mapped by the existing Responses provider. An approved observe
returns bounded page text/refs to that task/model and its saved private tool
result. Each input requires the exact returned tab/window/session/document/
epoch/observation/ref, and consumes the usable observation. Changed selection,
stale refs or foreign task/generation fail without input. A fresh observe is
required before another input. The task's dispatcher and provider continuation
still own every separately admitted model turn; the browser leaf adds no sender,
model loop, scheduler or ChatGPT-send capability.

Built-in observation waiting is distinct from cancellation. The host forwards
only explicit caller/host shutdown signals to a built-in executor. Its bounded
response wait may return the already retained unknown receipt, while the original
execute promise remains owned until a terminal result or explicit cancellation;
it can then settle the same journal without resending or resuming a task. An
expired observation wait never supplies an input-cancellation signal. The
composition also observes passive native physical-owner counts after a native
controller returns an early unknown result, preventing a false idle handoff.

`approveInvoke` resolves arguments from the immutable pending model call, checks
for an exact retained journal receipt first, and only then discovers/authorizes
new execution. A known old receipt can therefore be restored after host restart
without reattaching the page or repeating an effect. `reconcileReceipt(exactRequest)`
is the trusted core callback: it validates the original journal fingerprint and
only reads a retained exact late built-in receipt. It never calls discovery,
authorization, startup, observation or input. Missing late proof stays unknown.
Core keeps its original unknown row and explicitly appends a reconciliation fact;
known terminal projections do not rewrite history or reactivate an older task
generation. `invalidateTaskTools(taskId)` lets the committed task-generation owner
revoke only that task's observations/owned pending work without lazy startup.

The Tools UI has a separate selected-document attachment panel and reuses the
existing exact pending-call approval view. Revocation/stop can cancel queued
work; input already accepted by the extension may still finish and must remain
unknown until its exact receipt is reconciled. Input completion proves browser
execution only, not website acceptance or business success. There is no arbitrary
page selection, navigation, new-tab creation, cross-frame provider or account
identity inference in this bounded route.

The one connected `tests/agent-browser-composition.test.ts` case loads the actual
MV3 extension in a disposable Chromium profile against an inert local page. It
verifies pairing is not page permission, independent task attachment with MCP
disabled, approved observe/type/fresh-observe/click, canonical function-call-output
continuation across five counted model requests, no duplicate click effect,
browser-prefixed receipt provenance, and known-result recovery after closing and
reopening the host without browser reattachment. It closes its profile/listener
and uses no real model account or ChatGPT sender. Separate focused built-in
fixtures check exact unknown-to-late-terminal reconciliation without executing
again; browser peer fixtures own lower-level stale/ref/cancel contracts.

The native desktop controller plugs into the same host through the optional
`desktopTools` composition port, which auto-registers its pure built-in executor.
Do not register that same object a second time through `builtins`. Its status is
passive; explicit `inspectDesktopPermissions`, `listDesktopWindows`,
`setDesktopEnabled`, `selectDesktopWindow`, `revokeDesktopTools` admin actions
use trusted controller methods. Root constructs the controller from the exact
pinned helper factory; renderer/model arguments cannot name executables or
native commands. Metadata inspection, enabling, exact window/task attachment
and model-requested capture/input remain separate actions. Selected-window
pending calls reuse the same approval view. On shutdown composition first
invalidates task scopes and closes/drains the native resource controller, then
waits for host calls and closes its journal. Browser/desktop receipts are not
mislabelled as MCP or offered as business evidence; the MCP-only terminal
evidence button is disabled for those namespaces in this batch. Their model
image codec and OS provider tests remain with the provider/core owners.

## Server recipes and ownership

Manual setup requires a trusted user-installed recipe with an absolute canonical
executable, its SHA-256, pinned script/package entry files where relevant,
canonical working directory, exact argument vector, source label/version and
environment secret references. The host checks pinned file bytes before launch
and uses `shell:false` through the SDK. It has no installer, package-manager
invocation generator, prompt-to-command setup or automatic registry import.
Setup must not put credentials into arguments or source labels. The unsandboxed SDK transport inherits
its documented small baseline environment; only the credential resolver supplies
additional named values, and launch diagnostics discard server stderr. The host
never copies another client's API keys or OAuth files. These recipes stay stdio
with `auth:none`. As of 2026-10-21 on `main`, remote HTTPS MCP servers are reachable
only through the separate Protected MCP OAuth owner described in
[ARCHITECTURE.md](../../ARCHITECTURE.md): a reviewed provider/account/resource pin,
a protected vault and a main-owned Streamable HTTP transport, used through the same
per-call approval and ToolJournal. One approved real Linear read-only call passed in
installed `.13`. Unauthenticated HTTP MCP and arbitrary package installation remain
unsupported. The fixed official npm recipe has the
separate managed installation contract below; it never installs a plugin into
another client's registry.

## Managed official npm installation

The limited catalog currently contains only
`@modelcontextprotocol/server-filesystem@1.0.0`, its fixed SHA-512 registry
integrity, and declared `mcp-server-filesystem -> dist/index.js` entrypoint.
The official [MCP filesystem documentation](https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/README.md)
describes its read/write directory scope; the exact package metadata was checked
against the [official npm registry](https://registry.npmjs.org/@modelcontextprotocol/server-filesystem/1.0.0)
on 2026-10-18. This is an explicitly limited supported recipe, not a general
catalog or automatic latest-version recommendation.

`ManagedMcpInstaller` owns a private `agent-mcp-installs/` tree. A stable action ID
and immutable request fingerprint are persisted before spawning any installer.
Preparation writes an exact root manifest and private Bun configuration, then
executes the owned Bun binary with `install --lockfile-only --ignore-scripts`.
The child gets private HOME/cache/config and no inherited user npm config,
authentication or proxy environment. All install requests force the official
registry. No shell, package bin, git source, custom URL or lifecycle script is
executed. The manager uses Bun's documented
[lockfile and frozen-install contract](https://bun.sh/docs/pm/cli/install).

Preparation accepts verified Bun text lock formats 1 and 2 and validates every
lock entry: exact npm package/version, official
default registry source and SHA-512 integrity; unsupported dependency sources,
excessive graph sizes or a changed official root pin fail explicitly. The user
can inspect the complete transitive graph plus lock/graph hashes. A separate
action approving that graph runs `install --frozen-lockfile --ignore-scripts`.
The lock bytes must remain unchanged. Installed root metadata/bin/version are
checked, and a bounded digest covers the full installed node_modules tree,
including safe internal symlinks. Registry tarball integrity, dependency graph,
installed tree identity and entrypoint hash remain distinct evidence.

Only a terminal successful installation is promoted from staging into its
unique package runtime. It does not configure, enable or start MCP. A further
review constructs the recipe, pins Bun, entrypoint, config, root manifest and
lock, and includes managed tree provenance. Runtime Bun uses `--no-install`,
`--no-env-file` and the private pinned config. The managed recipe must first be
saved disabled; per-server enablement checks the exact current recipe digest
and package bytes, while the global host enablement and connection remain
separate actions. Every future launch rechecks the complete installed tree.

Admitted in-flight preparation/install seen by another process owner is
`outcome_unknown`, never an automatic replay. The original owner can still
finish and publish its terminal receipt. Cancellation signals only the actual
owned Bun child, waits for its close outcome, then may archive confirmed owned
staging. Promotion and archive persist exact source/target/marker/pin intents
before renaming. After restart the receipt owner can re-observe a marked target
and terminal source absence to recover the terminal receipt without another
rename or package-manager call. Conflicting/unestablished ownership stays unknown.
Uninstall disables the matching
managed recipe and closes its idle owned MCP process before archiving the exact
marked package runtime. It retains server configuration, drafts, receipts and
selected-directory user data. No unknown/custom directory is recursively
deleted, and existing custom servers are untouched.

Admin actions additionally include `prepareInstall`, `installReceipt`,
`installReviewed`, `cancelInstall`, `reviewInstalled`, `uninstallManaged`, and
`setServerEnabled`. Pending requests return durable status immediately; the UI
uses explicit receipt inspection, without polling or consent expiry. The native
`launcher:agent-tools-pick-install-root` picker selects the exact read/write
directory. Installer count participates in service drain/shutdown.

One in-flight start and one connected child are owned per server. Connection and
request deadlines, an overall discovery deadline, page/tool/schema/input/output
limits and SDK message-buffer limits bound host operations. Duplicate tool names,
repeated cursors and unsupported schemas fail explicitly. AJV validates supported
input schemas with known formats; unsupported drafts/keywords/formats are not
silently treated as validated. Child lifetime belongs to the host; a discovery
caller cancelling does not transfer ownership or create another server process.

**A recipe without a separately reviewed OS profile runs with user privileges.**
User installation/configuration is a separate trust decision from per-tool
approval. Hash checks detect changed installed files at launch; they do not make
a writable executable immutable against hostile concurrent OS-level replacement.
Only trusted installations should be configured. The optional macOS boundary
is described below. Stdio shutdown follows the
SDK's owned-child shutdown contract; servers that deliberately detach unrelated
children are outside this host's containment guarantee.

## Grants, persistence and cancellation

The task owner rejects stale generations on discovery, approval and invocation.
The tool-call identity is part of the immutable request fingerprint. The grant
is not persisted, and old grants cannot grant a changed scope or schema. The
SQLite journal persists unknown before sending the call; a crash between that
write and send stays conservatively unknown. On exact repeat the stored receipt
is returned without another call, even across host restarts. A changed payload
under the same idempotency key is rejected. A caller
cannot bypass this guard by changing the key: the task/generation/tool-call
scope is also unique, returning the original receipt for an exact duplicate.
Changed payloads under the same scope are rejected. Cancellation, timeout,
transport loss or an unretainable oversized result cannot establish that a server effect did
not occur, so they retain unknown and prohibit automatic replay. A terminal
MCP `isError` is retained as failed rather than advertised as success.

`terminalReference` exposes the exact private protocol receipt reference. A
current explicit requirement may re-observe an immutable older-generation
terminal result from the same task. That new observation binds the current
task revision and exact original subject/hash; future generations, other tasks,
generic business requirements and unknown results are rejected. It cannot
revive an old execution grant. The Tools UI shows/copies that reference and its
required explicit protocol-observation text, and an injected guarded
`attachEvidence` adapter can submit it to the existing Agent evidence action.

No separate model-request sender, scheduler or action outbox is added. The Agent
mode dispatch owner still owns model requests, limits and turn accounting. This
journal covers the exact tool suboperation. A provider continuation must retain
the original tool-call IDs/results and account for every separately admitted
model request. The Agent provider consumes this discovery port and selected
content only when explicitly wired by root composition. A later external reconciliation feature must obtain an exact trusted
terminal observation rather than clearing unknown to retry it.

## Skills and native execution

The skill library receives explicit roots with source provenance (`user`,
`workspace`, `official-plugin`, `vendor-plugin`). It scans only a bounded number
of entries/depth, skips symlink directories and hidden/dependency directories,
and reads bounded UTF-8 SKILL.md content. A selection includes canonical relative
path, source and content digest, and fails if that identity changes or escapes
the root. The file descriptor and current file identity are reconciled after
the bounded read. Returned content is explicitly selected-skill instructions
below system, developer and user instructions; it never grants tool/filesystem
authority. Approved roots and generation-bound selections are saved in the
application's private `agent-skills.json`, rechecked when read, and can be
revoked explicitly without editing source files. There is no global
edit/import/update writer. Official plugin
installation and preserving local adaptations remain with their existing owner.

### Managed local text lifecycle

`ManagedSkillStore` in `src/agent-tools/managed-skills.ts` owns a separate private
`managed-skills/metadata.sqlite` and version directories. It does not change the
existing read-only root grants, source files, Codex skills, plugin distributions
or account/client registries. Explicitly selected local user/workspace
SKILL.md text and bounded selected text resources are supported. Official/vendor source tags and canonical resolved
ancestry under the effective/default Codex plugin roots are rejected before
reading import content. This is not a plugin installer, official distribution
replacement, whole-folder importer or background source watcher.

The [selected resource contract](standalone-skills-resources.md) adds an explicit
`reviewSkillPackageImport` action to the same composition/HTTP/guarded IPC owner.
The renderer supplies selected relative paths under `references/` or `assets/`,
then previews every file and digest before the existing separate commit. Only
UTF-8 `.md/.txt/.json/.csv` is admitted, up to 16 files, 32 KiB each and 128 KiB
including SKILL.md. Import never automatically attaches or executes resources.
The existing `selectedSkillContent` packet includes package digest and text
resources with source-material role, with no absolute source paths.

The review captures canonical root/file path and device/inode identities, file
timestamps, bounded UTF-8 bytes (including a preserved BOM), content SHA-256 and
the selected source identity. The file descriptor and source pins are rechecked
around reads and again at commit. The returned full-text preview is precisely
the staged text. A separate explicit commit must match its review digest and
retain a currently granted original source root. Source changes require a new
review; copying model-provided body text or arbitrary ungranted paths is not an
admin route.

Each review has a stable action identity. The private SQLite owner admits the
intent before copying, then stores an exact staged/target manifest and content
digest. Commit records `committing` before publishing its uniquely named
version directory. A lost terminal receipt can be re-observed from the exact
marked, digest-matching target without a new copy or rename. An admitted intent
whose target is absent/conflicting stays `outcome_unknown`; retries cannot
automatically commit it. Files are created private/read-only and never replaced
by updates; current bytes are checked every time they are composed. Same-user
manual file modification is detected, not represented as OS immutability.

An update retains the same selected source lineage and creates a new version.
It neither overwrites old referenced bytes nor changes any task attachment.
Attaching an exact version is a further explicit action bound to the current
owned task and generation; it may explicitly replace that lineage's attachment.
A later task generation starts without those grants. Imported text keeps the
same selected-instructions precedence below system/developer/user instructions,
and grants no filesystem, tool, network or execution authority. Combined
read-only and managed selections remain bounded to 16 items/128 KiB.

Revoke and forget deny subsequent composition/attachment of that exact version.
Existing reference records, version bytes and receipts remain retained; an
attached revoked version causes a clear refusal until explicitly detached or
resolved. Already offered model input cannot be withdrawn. Forget additionally
hides the version from the ordinary catalog; retained receipt inspection is
still available. No automatic garbage collection, overwrite, purge or physical
deletion is performed.

New actions are `reviewSkillImport`, `commitSkillImport`, `managedSkillAction`,
`attachManagedSkill`, `detachManagedSkill`, `revokeManagedSkill`. The composition
needs no new options or provider hook: `selectedSkillContent(scope)` supplies
the combined exact selections through the existing integration. Its managed
store is opened lazily. The UI shows source/name/bytes/digests and exact text
before commit, keeps full receipt JSON and recovery identity in a disclosure,
and exposes import/update, separate attach/detach, revoke and forget through the
same guarded generic IPC transport.

Capacity is reserved atomically before each new review intent: at most 512
actions, 256 retained versions and 64 MiB of conservatively reserved text
(review plus possible immutable-copy bytes). Existing exact review retries run
before quota checks. Capacity errors preserve existing reviews/versions/refs;
constructor-only smaller limits support focused fixtures and cannot be raised
by model/admin payload. Metadata and source paths/content have independent
bounds. The UI never infers disposal or source/plugin-update permission from a
capacity error.

`tests/agent-managed-skills.test.ts` exercises actual temporary filesystem and
authenticated admin review/commit/attachment: source mutation, explicit update,
unchanged old attachment, generation isolation, source-grant revocation,
version revoke/forget with retained bytes/references, and lost terminal receipt
after observed published bytes. It also checks missing-target unknown/no replay,
canonical symlinked plugin-cache refusal and small action/text capacity limits
without a large import loop. It reads/imports no actual personal skill text and
performs no provider request or MCP installation.

Native execution requires a trusted exact workspace/call grant, per-operation
approval and a platform-matching OS facility enforcing filesystem, network and
child-process restrictions. The module reports that facility unavailable on
every platform until a real executor is integrated. A boolean supplied by a
renderer/model cannot register an executor. No native command is run by this
policy module. QuickJS/WASM composition remains conditional: no measured
round-trip gap or supported consumer currently justifies another interpreter;
an interpreter would never confer native isolation or callback authority.

For MCP child processes specifically, `trustedSandbox` can capture a reviewed
macOS Seatbelt profile through `reviewTrustedSandboxConfig`. Captured path/device/
inode identities are persisted; stale roots stay visible in configuration and
are rejected at launch. The host builds the generated profile, rechecks identities
immediately before SDK connect, rejects credential environment references and
overrides the SDK's inherited baseline with private HOME/TMP/minimal environment.
Caller data/code grants cannot overlap the host's journal/config authority tree
in either direction, including protected descendants. The only internal
exceptions are the exact owned managed runtime read root and its pinned
node_modules code root; selected write roots receive no such exception.
Managed filesystem review on a supported Mac captures package code/runtime as
read-only roots and the explicit selected directory as its write root. Requested
isolation never falls back to a privileged launch on another platform or error.

Per-server runtime snapshots expose the actual connected boundary. The profile
denies new network sockets and ungranted data access/process execution. Its
reported limits include global path metadata, declared system library reads,
literal ancestor-directory opens for module resolution, narrowly listed runtime
sysctls, Apple's deprecated sandbox-exec interface, and unverified detached
descendant lifecycle after the parent exits. This is actual MCP-process isolation
on the tested macOS host, not a general native command executor or Windows/Linux
sandbox claim. Kernel restriction and direct SDK wrapper tests belong to the
separate sandbox fixture; host integration also initializes, discovers and calls
the SDK fixture through its requested profile and verifies parent PID reaping.

## Focused evidence

`tests/agent-tools-offline-admission.test.ts` uses an isolated actual Full-mode
server with launcher browser hosting, a ready private broker, and tunnel
readiness false at revision zero. With MCP disabled, a ready Agent task can
inspect inventory and discover unsupported browser/desktop descriptors without
starting the desktop helper or a model request. A model step is refused. After
drain, discovery and new desktop inspect/list/enable/select actions are refused,
while status, disable and revoke still succeed. The fixture verifies zero model
requests, zero dispatches and no native resource creation, and closes the server
and disposable private home. A second focused case uses an actual held MCP SDK
operation in an isolated background runtime with an explicit DIRECT declaration.
With Web still unavailable, the approved tool writes its private counter once;
the real active tool owner alone refuses detach. Explicit release produces a
terminal receipt, then idle detach succeeds. New discovery stays closed until
attach, an inert Native HTTP request remains available, and duplicate approval
returns the retained receipt without another counter effect. The exact SDK child
is reaped before cleanup. The synthetic prepared model call is not a real Web
provider proof; no counter or owner was injected into the server's activity view.

`bun test tests/agent-tools.test.ts tests/agent-tools-ipc.test.ts tests/agent-tools-installer.test.ts --timeout 10000` runs an actual owned local
stdio server implemented with the official SDK. It verifies file pins/private
configuration; discovery and unsupported schema reporting; an approved real
fixture effect; argument/grant drift and durable duplicate rejection; and
cancellation after the counter effect was observed, followed by restart without
replay. The skill fixture checks selected content/digest drift and root/symlink
escape; native policy denies absent OS isolation. No external network,
installation, live credentials or client registry is used. The admin fixture
also verifies authentication, reviewed config/save/enable, a real exact pending
call, selected skill persistence and explicit root/server revocation. The IPC
fixture verifies owned-runtime admission and native-picker grant forwarding.
Managed-install transaction fixtures exercise graph approval, lost owner/no
replay, disabled configuration, whole-tree drift detection and archive/data
preservation through an injected inert package-manager port. A separate actual
Bun zero-dependency fixture proves the fixed prepare/frozen commands do not run
its lifecycle script and both child PIDs exit. It does not install or launch the
real catalog package, contact live MCP services or modify actual user config.

A subsequent authorized actual catalog check used the production installer API
against the official registry in a disposable private home. The first real
graph exposed Bun 1.4's text lock version 2; after supporting that verified
format, preparation and frozen installation succeeded with 104 graph packages
and 4,691 installed-tree entries. Final recipe review and save retained both
global and per-server enablement as false, with no MCP process or connection.
Both actual installer PIDs were reaped and all owned temporary package/data
trees removed. Exact graph/lock/tree/entry hashes and outcome scope are in
[the JSON receipt](../reviews/2026-10-18-agent-tools-official-install.json).
This proves actual package preparation/installation/review, not that this
official server was launched or a user installation changed.
Tests close all
owned hosts and remove their temporary fixtures. These checks do not establish
Electron UI integration or live provider results.
