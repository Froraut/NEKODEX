# Runtime modes and operational contracts

For the maintained source/module map, ownership boundaries and update procedure, start with
[NEKODEX architecture](../ARCHITECTURE.md). This companion retains the detailed mode and protocol contracts.

```text
Codex app / CLI
      │ Responses API on loopback
      ▼
launcher-owned codex-chatgpt-web daemon
  ├─ official /models passthrough + fixed ChatGPT Web models
  ├─ native Responses passthrough or ChatGPT Responses/SSE bridge
  ├─ authenticated native Search and Image Gen request forwarding
  ├─ ChatGPT browser worker (configured task-bound Electron tab ceiling)
  ├─ capability broker (full mode only)
  └─ stdio MCP server
            ▲
            │ outbound OpenAI Tunnel
            ▼
      ChatGPT custom connector
```

## Modes

### `browser-only`

- Exposes Instant (`chatgpt-web/light`), Medium, High, and Extra High; each model advertises exactly one
  immutable Codex effort matching its ChatGPT browser mode. `chatgpt-web/pro` is appended only when
  the authenticated account exposes Pro.
- Sends the complete Codex context and image attachments to a fresh ChatGPT Temporary Chat.
- Never starts the broker, tunnel, or MCP server.
- Emits a nonfatal Codex commentary warning that local tools are unavailable for the selected model.

### `full`

- Exposes the same fixed models and attaches the turn-bound connector capability to every available
  effort, from Luna through Pro. There are no effort-specific MCP exclusions.
- ChatGPT uses a custom MCP connector backed by `openai/tunnel-client`.
- Every connector call presents one outer Codex turn capability; the MCP server keeps the derived
  binding private and dispatches the requested action immediately.
- When Codex exposes tools behind its code-mode `exec` gateway, the connector discovers their
  runtime registry and can invoke an exact listed name through bridge-owned code. Full mode also
  preserves Codex's native freeform `exec`; its tool registry enforces the same bounded
  `wait_agent` contract as direct and structured calls.
- Tool calls and results remain in the same ChatGPT response while Codex executes them locally.

### Repository DEV driver

The DEV chat is not another provider or browser implementation. It is a synthetic outer-Codex
driver around the same in-process Responses handlers. `dev launcher` starts the packaged launcher
with an explicit `development` profile. That profile has a different core home, sandboxed
`CODEX_HOME`, Electron `userData`, persistent browser partition, descriptor, cookie jar, login,
configuration, chat store, diagnostic store, broker path, tunnel profile, and alias. The normal and
DEV launchers can therefore run at the same time with different ChatGPT accounts.

The working-tree adapter attaches to a tab leased only from that DEV launcher. In Full mode the DEV
launcher owns one persistent, isolated tunnel runtime; a named CLI chat owns only the private turn
broker attached to that tunnel for the command's lifetime. The distinct `Codex Native6 DEV`
connector reaches the same MCP server and turn-token contract without requiring any Responses
daemon or colliding with the production `Codex Native6` connector.

Only the responsibilities normally owned by native Codex are synthetic: named history storage,
turn metadata, tool-result execution, context-threshold scheduling, and installation of compacted
replacement history. Every tool result is an explicit `simulated: true` receipt with
`side_effects_performed: false`; no semantic router guesses a command result.

The driver calls `responseRequest` and `compactRequest` directly. It starts no HTTP server, does not
read or write Codex's route journal or `config.toml`, and does not stop or replace the normal
launcher-owned daemon. A `dev-harness` discriminator prevents the Responses server and production
launcher from starting a Responses daemon for its config. DEV setup stores browser capabilities
and tunnel credentials but performs no Codex integration, system service installation, or port
probe. The DEV launcher supervisor owns only the isolated MCP tunnel. Browser diagnostics, broker
state, thread authority, checkpoints, and named chat state live
under `~/.codex-chatgpt-web-dev` by default.

The ChatGPT connector name is also the public MCP ABI identity. Automatic Full mode defaults to
`Codex Native6`, with asynchronous tool operations, explicit result delivery and acknowledgement.
The isolated repository driver uses `Codex Native6 DEV`. Synchronous mode retains the #487
command-field contract under `Codex Native4` / `Codex Native4 DEV`; Manual uses
`Codex Zero Risk4`. Supported saved identities, including Native5, remain valid during ordinary
updates. `Codex Native3`, `Codex Native3 DEV`,
and `Codex Zero Risk2` are legacy identities, alongside their older aliases. The unpublished
`Codex Zero Risk3` name is recognized defensively as a local legacy alias. The new
`codex_exec` contract specifies optional native sandbox-escalation fields; forwarding depends on the
exact command tool advertised by the current outer Codex turn. The outer Codex runtime still owns
the sandbox, approval or auto-review decision, and resulting command lifecycle. A connector name,
local setup state, or cached `tools/list` response does not grant approval.

Setup migrates known legacy local configuration to the mode's new target, clears prior connector
verification state, and requires the user to **create a distinct ChatGPT plugin App ID** with the
exact new name and that mode's tunnel. Renaming or refreshing a legacy connector does not replace
its cached public schema. Browser verification accepts the exact new identity, reports a migration
error when only a legacy identity is visible, and never falls back to it. The normal and DEV
identities remain separate even when both are installed in one ChatGPT account. Future public
schema changes require another deliberate connector identity. See [connector identity migration](connector-identity-migration.md)
and the earlier [MCP task access migration](mcp-task-access-migration.md).

## Browser lifecycle

The desktop launcher owns one persistent Electron partition and a configured ceiling for task-bound
browser tabs and simultaneous browser turns. The default ceiling is sixteen; the launcher pins the
saved limit at startup so its tab allocator, browser worker, and session registry agree. This is an
admission limit, not a measured claim that sixteen simultaneous ChatGPT sessions will remain stable
under live browser and model load. Each task/model/effort/compaction epoch owns one exact
`WebContentsView` lease; sequential native messages reuse that surface, while each message receives
a fresh turn-bound MCP token and keeps all of its MCP tool rounds inside one ChatGPT response.
Compaction asks the same retained Web agent for a one-shot structured checkpoint, waits for the
response and physical helper cleanup,
then closes the old surface. The next epoch gets a new Temporary Chat. Model messages never copy
state between tabs. Tabs share only the local login
partition and keep independent documents and lifecycles. Closing a running tab requests targeted
runtime cancellation before releasing its local observation; it does not undo provider-side work.
Automatic turns wait in a bounded, owner-bound admission queue when local capacity or pacing is
unavailable. The physical ceiling still bounds browser allocation and does not increase account
allowance. See [admission and cancellation](design/browser-admission-queue.md).

The Task Center projects durable submission receipts separately from browser documents. An
uncertain or post-acceptance failure retains its exact document for inspection while available.
After a process restart, unfinished receipts become interrupted incidents; they do not authorize
another Send. Completed-history dismissal does not destroy a still-usable retained conversation.

Browser submission and response binding use ChatGPT's logical `data-turn-id`, not the
`conversation-turn-N` display index, which can change during rendering. The submission baseline
includes the persistent `data-turn-id-container` wrappers of virtualized history. Remounting old
messages therefore cannot count as a new submission or another user's turn. Missing or duplicate
logical identities fail explicitly; accepted messages are never resent to repair their DOM.

Sign-in uses that same persistent Electron partition. ChatGPT login pages and allowed identity-
provider popups are adopted into a temporary `WebContentsView` inside the launcher instead of being
redirected to another browser. After the provider returns to ChatGPT, the launcher requires both a
server-authenticated session and the Temporary Chat composer in the primary owned view, then closes
the temporary auth view. Passkey sign-in can also use an explicitly selected existing Chrome
profile or an isolated browser. Existing-profile capture requires Chrome's native approval and
an exact one-use target claim opened in the selected profile; the profile directory is never
assumed to be a CDP context ID. The captured ChatGPT principal is checked independently of Google
profile metadata before replacing the account session. Private temporary transfers are cleaned
before the verified profile binding is committed.

The current compiled Codex task context is inserted as one inline JSON envelope. Image bytes stay
out of the JSON and are attached natively with stable references. The runtime does not create a
context JSONL file, upload a synthetic context document, include prompt hashes, or silently truncate
the envelope. Attachment acceptance and send readiness are verified before the turn begins.

Initial Launcher setup asks which interaction mode to install and defaults to With Automation. The
same choice remains available in Settings; changing it uses the transactional setup path, replaces
the installed catalog. Catalog delivery, visible picker confirmation, and the settings used by an
already-running Codex task are separate observations. Refresh or restart the client only when it
still uses the prior configuration; a saved restart hint is not proof that this is necessary.
Manual mode never reads or mutates the ChatGPT DOM.
For a new ChatGPT chat the adapter provides the complete compiled prompt; for an exactly retained
chat it also provides an incremental prompt containing only the Codex suffix after the last assistant
reply. The Launcher chooses between those two prompts from its own retained-tab ownership and writes
the selected text to the system clipboard. The user has thirty seconds to paste, select the visible
ChatGPT model, effort, and Manual mode connector, send, and confirm Sent; a manual compaction handoff
allows two minutes. Sent ends that confirmation deadline. Waiting for the first MCP bind is part of
the live turn, which remains subject to explicit cancellation and runtime-owner cleanup.
The pasted task carries one opaque `request_id` for routing concurrent requests. Start/completion
sequencing lives in the Manual mode MCP server metadata, not in user-authored imperative text; the
per-tab nonce used to validate the Launcher confirmation never leaves the local runtime.

The appended models advertise the authenticated account's context window and a ten-percent
auto-compaction reserve. Usage is counted with the GPT-5 tokenizer plus fixed platform/image
reserves, rather than inferred from character length. The ChatGPT composer also has an independent
inline-size boundary: usage accounting asks Codex to compact before that boundary, and a prompt
that still exceeds the proven hard ceiling fails explicitly before any browser turn opens.
Top-level `model_context_window` raises only the proxied native rows' advertised maximum, allowing
Codex to apply its own configured context override without clamping. Routed ChatGPT Web models
retain their measured adapter-owned limits.

Bigger Context partitions complete ordered records against each message's available token and
composer budgets. Inert stages carry text; the final message also carries all retained attachments,
the execution contract and any output schema. Their reserves are deducted before partitioning,
then preflight checks the actual compiled messages and total transaction. The selected execution
effort and attachment references remain unchanged. Transport uses two or six parts; the advertised
context and compaction multiplier remains three. More parts reduce individual message size without
expanding the model's context window, and an oversized indivisible record still fails explicitly.

In Full mode, routed compaction v1/v2 uses the exact retained source agent and a one-shot MCP control
capability that accepts only the bound checkpoint; it cannot claim or invoke the ordinary Codex tool
environment. Manual mode always advertises a fixed three-times compaction interval without enabling
Bigger Context multipart transport. At that boundary its active ChatGPT response receives the
checkpoint instruction as an MCP result, returns the compacted context through its bound completion
control, and ends. The old manual chat is retired; the next compacted Codex request owns a fresh
Temporary Chat and its locally compiled prompt is copied to the clipboard. A missing Automatic
retained source falls back to a dedicated read-only Temporary Chat built from canonical Codex
history; a missing Manual mode source uses the same explicit manual checkpoint contract. An invalid or
ambiguous handoff still fails explicitly. Browser-only mode
uses the same read-only summarization path, then returns the native replacement-history shape expected
by Codex. A prompt-level checkpoint marker is translated into a visible Codex trace item;
every later tool action in the same turn continues to present the current turn capability. Visible
ChatGPT status rows become reasoning summaries, while stable prose between rows becomes native
Codex commentary.

## Installation and service lifecycle

Each native desktop package contains Electron, a platform-matched pinned Bun executable, the
Responses bridge, Playwright client code, MCP server, setup, doctor, and the browser helper.
Browser-only mode downloads no browser and requires no installed Chrome/Chromium or system Node/Bun;
sign-in and model turns both remain in Electron. Full mode separately downloads the official pinned
`openai/tunnel-client` build for the current OS/architecture and verifies it against the release
SHA-256 manifest.

On first launch, the embedded runtime is checked against a deterministic manifest covering every
file path, size, and SHA-256 before any launcher port or window opens. The source, transactional
temporary copy, and final destination are all validated before the private versioned directory is
accepted under the application home. Daemon and MCP commands use that durable copy, which is
required because Linux AppImage mount paths are temporary and must never be persisted in Codex or
tunnel configuration.

The launcher is the sole process supervisor on macOS, Windows, and Linux. It starts the optional
tunnel first, waits for healthy/ready evidence, starts the Responses daemon, and then waits for its
versioned health payload. Native login items or an owner-local XDG autostart file launch the app
hidden after sign-in. A marker containing only launcher-owned PIDs lets doctor distinguish the
launcher runtime from a stale or external process. Legacy macOS launchd services are drained and
removed during an explicit launcher migration; launchd remains only for the advanced terminal-only
mode.

Setup keeps Codex's built-in `openai` provider. It routes Responses through the local daemon with
`openai_base_url`, while pinning `experimental_realtime_webrtc_call_base_url` to Codex's official
ChatGPT endpoint so Voice session creation never falls through to the Responses-only bridge. Both
assignments are journaled and restored exactly on disconnect or uninstall; a conflicting existing
Voice route requires explicit `--replace-codex-route` ownership. The daemon forwards the
authenticated official model catalog and appends only the routed models owned by the
`chatgpt-web/` namespace; no static catalog is installed. Subagent protocol selection is explicit,
and new installations default to Compatibility V1 because it is the only surface portable across
native and routed Web backends:

- **Compatibility V1** pins every delegation-capable native and routed row to V1 and atomically
  manages `multi_agent = true`, `multi_agent_v2 = false`, and `[agents].max_depth` of at least 2 so
  a routed child can spawn a routed grandchild. The integration journal preserves the user's prior
  scalar, structured-feature, and agent-depth lines and restores them byte-for-byte on disconnect,
  native-mode selection, or uninstall. The ChatGPT connector projects `wait_agent` as an explicit
  10-second polling contract: terminal semantics stay native, while every non-terminal poll releases
  the serialized MCP channel so Web children can run their own harness tools.
- **Native** preserves every official native row and gives routed rows the selected template's
  protocol surface. Under MultiAgent V2, Web-origin `spawn_agent`, `send_message`, and
  `followup_task` calls include Codex's explicit `encrypted_function_args: []` plaintext marker.
  A genuinely encrypted native-to-Web payload is rejected with one HTTP 400 before a browser is
  opened; it is never turned into an SSE disconnect/retry loop.

Catalog metadata alone never claims to change an existing task's protocol. Codex pins the protocol
when a task starts, and its global `multi_agent_v2` override wins over per-model metadata. Switching
protocol therefore requires restarting Codex and starting a new task. Model choice, effort,
context, and service tiers are otherwise unchanged.

The built-in provider attempts a Responses WebSocket prewarm. The local route explicitly returns
HTTP `426`, which is Codex's native capability-negotiation signal for an immediate, session-sticky
switch to its HTTP/SSE transport. No model or provider fallback occurs.

Setup never restarts an already loaded daemon implicitly. A requested stop, restart, replacement,
or uninstall first calls a private authenticated drain endpoint. The daemon rejects new turns and
reports two independent counters:

- active HTTP requests, including native compaction, Search, and Image Gen forwarding;
- active ChatGPT browser sessions, including time spent waiting for local Codex tool results.

The lifecycle operation proceeds only when both counters are zero. The launcher then stops the
tunnel through its runtime command and asks the daemon to flush state and exit through an
authenticated shutdown endpoint. If the contract is unavailable, malformed, non-idle, or cannot
be completed, the operation fails closed and restores the drained runtime when possible. An
unexpected child exit is recovered with a bounded restart budget; a crash loop becomes an explicit
launcher error.

## Launcher transition ownership

`main.cjs` composes runtime, browser, account and updater services. A small lifecycle-admission
module owns startup, update preparation and exit transitions. New mutating IPC commands cannot
race those transitions; read-only snapshots, layout updates and cancellation remain available.
The exact owner is handed from update preparation into quit, and queued startup quit intent is
retained. Account token reads have their own cancellable read leases, separate from leases that
block browser turns or mutate credentials/proxies.

The updater controller owns metadata/download/staging; `update-preparation.cjs` owns extractor
processes and cancellation exit proof. A cancelled preparation retains authenticated download
partials for retry and settles physical cleanup before releasing admission. Once the installer
worker takes ownership, the existing journal/readiness/rollback transaction controls replacement.

The frontend reads the same lifecycle transition from the shared snapshot contract. Busy controls
therefore follow backend admission while navigation, status display and relevant cancellation stay
usable. See the [integrated backend/frontend review](reviews/full-stack-20260921.md) for scoped
evidence and platform limits.

## Security invariants

- Bind the Responses proxy and health endpoint to loopback only.
- Store browser state and tunnel credentials under the application home with mode `0600`.
- Protect lifecycle control endpoints with a random application-owned bearer token.
- Never place secret values in command-line arguments, logs, generated profiles, or Git.
- Enforce the configured browser-turn and tab ceiling for independent task-bound sessions, and reject unsupported models explicitly.
  The selected routed model fixes the adapter effort; a conflicting request effort cannot change it.
- Do not retry or switch modes to evade product usage limits.

See the complete [security model](security-model.md).

## Repository checks

Pull requests and pushes to `main` keep the existing `verify` check names on macOS, Linux, and
Windows, plus `actionlint`. On those events only the Linux runner runs a check:
`bun run architecture:check` for the module map and documented paths. The repository has no
automated test suite, so no behavior tests run. Code, documentation and CI metadata changes require
manual diff review, with workflow linting in `actionlint`. A green check does not claim that a
reviewer has completed that review or that changed behavior works.

The three-platform `verify`, packaging, AppImage ABI, and package smoke sequence is an optional
manually dispatched CI run with explicit authorization for that broad run, after focused development
verification. A pull request does not require that broad run. The separate tag release
workflow packages reviewed source; it does not replace the development behavior check.
