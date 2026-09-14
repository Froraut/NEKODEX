# Live execution and block investigation — 2026-09-14

Initial evidence: **5.1.0-froraut.9**, macOS arm64. The later native-runtime resolution is installed in **5.1.0-froraut.10**. This continues the [issue/PR investigation](2026-09-14-investigation.md).

## Latest desktop verification: resolved after the approved restart

After the user paused Hermes work and selected the main Codex/Web route, a new ephemeral
Codex CLI request using `chatgpt-web/high` completed in **23.26 seconds**, exit 0. Its final
answer displayed the requested fixed marker, with Markdown escapes in the raw string. This
was a real request through the installed pre10 bridge, not a mocked browser response.

The running desktop model picker still showed only the native models. The shared Codex cache
also held only eight native entries, and the fresh CLI request warned about missing Web model
metadata. After backing up that cache and asking Codex's normal resolver to fetch again, the
resolver returned all thirteen entries: the eight native entries plus Web Instant, Medium,
High, Extra High and Pro. The shared cache subsequently reverted to the native-only catalog.
This is consistent with an already-running client retaining its earlier model route; the
individual cache writer was not instrumented. The user first deferred the full desktop restart,
then explicitly approved it despite the active tasks. The old desktop process exited and the
application reopened successfully. Its catalog then contained all thirteen entries, and the
actual desktop UI displayed the selected **ChatGPT Web — Instant** model. This resolves the
observed missing-picker problem for the installed client without changing its binary or using
a static replacement catalog.

The launcher's catalog-request indicator proves the bridge served a catalog to a client. It
does **not** prove the current desktop picker consumed it; a CLI or another process can satisfy
that indicator. The earlier setup-complete state below must not be read as proof that the
desktop's Web model selection was already working before the restart. Core model responses,
the earlier native file/tool/final-answer cycle and the subsequent desktop Web selection are
now separate observed passes. Image generation, every model tier and every native tool were
not re-exercised as part of this narrow restart check.

## Follow-up: image generation, file edits and context settings

The user's subsequent desktop request on **ChatGPT Web — Instant** completed an actual native
image-generation item and final answer. The saved PNG was opened and inspected: **1536 × 1024**,
2,359,266 bytes. The complete user turn took 58.04 seconds. This reuses the user's real result;
no duplicate image request or public upload of the artifact was made.

A separate bounded Web Instant check invoked the native file-change tool and created a
disposable text file whose bytes matched the requested content. The 30-second check deadline
ended the client before its planned shell read and final answer, so those later phases are
not claimed as passed in this run. The earlier native High read/command/final-answer proof
remains the completed evidence for that path. No background browser turn remained at the
cleanup observation. No full suite or exhaustive plugin/tool sweep was run.

For GPT-6 Astra, [the API model specification](https://developers.openai.com/api/docs/models/gpt-6-astra)
advertises a **1,050,000-token** total context window. The installed Codex client's matching
[0.154.0 model catalog](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/models-manager/models.json)
sets Astra's default to 272,000 and its maximum configuration override to **872,000**. Codex
[clamps an override to that maximum](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/models-manager/src/model_info.rs).
An API limit alone is not proof of a larger usable Codex or browser window.

The existing native context setting was already 872,000 and was preserved. The global
`model_auto_compact_token_limit = 820000` was removed with a private backup so model-specific
compaction metadata is no longer replaced. With Codex's normal 95% headroom, Astra's nominal
usable window is 828,400; its default automatic-compaction threshold is 90% of the raw window,
or 784,800. The current Web catalog retains its separate explicit 95,000-token compaction
budget. The configured model, account, model route and permissions were preserved. This
configuration was parsed and inspected; a million-token workload was not sent.

## Outcomes

### Later Bigger Context incident and pre11 recovery work

The user subsequently enabled Bigger Context. The running pre10 bridge then used its larger
profile (285,000-token automatic compaction budget). This supersedes the earlier 95,000-token
configuration observation above; it does not establish that a 285,000-token round trip passed.

An actual desktop Web Pro task first completed native task reads and commands. A later turn
made no native tool calls and answered that tools were unavailable. That sentence alone does
not identify a transport failure or a cloud-side policy decision. The next compaction failed
after about 813 seconds. The server continued answering health requests throughout.

The compaction trace showed a multipart send waiting for its three-minute stage deadline,
followed by another attempt that received both staging acknowledgements and switched to Pro.
The final observation failed with `ChatGPT exposed 3 new conversation turns for one submitted
message`. Sanitized snapshots showed two retained acknowledgements and one new response.
Rekeying of the retained acknowledgements during the model switch is a plausible explanation;
the diagnostic did not record their logical IDs, so it is not claimed as a directly captured fact.

Pre11 now recognizes a remounted staging acknowledgement only by the exact transaction-bound
text that was already verified for this request. Unrecognized or duplicated turns still fail
closed. It also reports a visible blocking submission dialog immediately instead of silently
waiting through the send deadline; accepted requests and subsequent tool approvals retain
their existing handling. Native app-tool lookup accepts either canonical flat names or the
equivalent namespace/name pair, while still rejecting ambiguous and freeform exports. This
compatibility change does not prove the reason for the separate no-tools model answer.

The same release preparation queues context changes until the runtime is idle, exposes the
active context profile separately from a queued choice, and requires an explicit confirmation
that Web models appeared in the desktop picker. Serving a model catalog cannot satisfy that
confirmation. Local developer packaging can reuse the exact installed Electron version;
publisher builds retain their normal signed release acquisition path.

Three focused multipart/dialog/tool-name regressions passed, in addition to the three focused
queue/readiness cases already run for these changes. No full suite, new image generation,
exhaustive tool sweep or large-context workload was run. **The original large Pro task has not
yet been shown completing on pre11.** These are source-level fixes and bounded evidence, not
a claim that every bridge path is now reliable.

Apple confirmed the existing individual developer account is Account Holder; no new team was
needed. A new Developer ID Application certificate was issued. The initial download was
blocked by the operator's Browser Use download interception: a download event must be awaited
before clicking its link. Using that supported flow saved the certificate in the same Chrome
profile without changing browser policies or security settings. The certificate's public key
matched the newly generated local private key, and importing both made Developer ID Application
a valid local code-signing identity. CLI authentication and notarization remain pending. No
publisher-signed GitHub release is claimed by this report.

| Path | Observed result | Boundary |
| --- | --- | --- |
| Native Codex → ChatGPT Web High → MCP → native file read → final answer | **Passed** in 51.25 seconds, CLI exit 0. The file contained a random marker withheld from the prompt; the received answer matched it exactly. | One real read-only task, not all models, tools or operating systems. |
| Hermes Codex runtime → Web High → exec_command → final response | **Passed** in 72.84 seconds. Actual tool callbacks and file contents were returned. | User-selected alternative; does not repair the direct Hermes loop. |
| Direct Hermes → ChatGPT Web → Hermes final response | **Transport completed.** A real Hermes AIAgent received the model's final response. | The response was a refusal, not the requested file contents. |
| Hermes Instant → MCP inventory | Receipt observed; a successful reply was written after SDK processing. | No subsequent read_file invocation reached Hermes. Full cycle ended in 17.34 seconds. |
| Hermes High → MCP inventory | Receipt observed; a successful reply was written in 3 ms. | No subsequent read_file invocation reached Hermes. Full cycle ended in 36.19 seconds. |
| Publisher signing | Only Apple Development identity is usable in the local keychain. | Developer ID/notarization and Windows publisher signing remain unavailable. |

The native task executed an actual `sed` read in a disposable directory and returned its contents. The MCP observer recorded successful replies for inventory, a generic tool call and native command execution. The CLI also printed nonfatal warnings from other installed MCP resources/hooks; it exited successfully with the exact answer. Those unrelated integrations were not modified.

Both complete Hermes attempts received a final response saying the file operation was blocked by safety checks. No Hermes tool-start or tool-complete callback fired, and its returned messages contained only the user prompt and assistant response. The local MCP transport recorded a successful inventory reply, with no following execution call. This places the observed stop **after inventory and before local execution**, rather than at Hermes' filesystem handler or local SDK argument validation.

The text describing safety checks came from the model. A structured cloud-side rejection payload was not recovered. It therefore does **not** establish which cloud review component rejected the operation, that annotations caused it, or that a different annotation would repair it. No tools were renamed, relabeled as read-only, or rerouted to bypass a safeguard. Connector-specific Allow all actions was explicitly approved and selected; global plugin policy and native/Hermes permissions were preserved.

The earlier 20-second attempt could not establish end-to-end completion. This follow-up let the specific native and Hermes acceptance scenarios finish under a 180-second outer limit. The first complete Hermes result was saved successfully, but its diagnostic script initially tried to chmod an outdated output filename; that script-only mistake was corrected and the saved result inspected. It was not an application exception.

## Confirmed fixes and remaining blocks

- Account/organization mismatch: corrected. Platform, ChatGPT and the embedded profile were aligned, and the correct account's tunnel was attached.
- Hermes context initialization: corrected in pre8. The initial 32k value was below Hermes' 64k minimum; the provider now uses canonical per-mode budgets without inflating smaller modes.
- Missing MCP boundary evidence: corrected in pre9 with a bounded, payload-free transport observer.
- Native Codex real tool operation and final response: now directly verified.
- Direct Hermes tool operation: **blocked/unverified in the observed direct-mode runs**. The later selected Codex-runtime path passed its scoped acceptance below.
- Public publisher-signed distribution: still requires the missing signing identities/credentials and successful notarization.

The upstream [issue #446](https://github.com/miuuyy/codex-chatgpt-web/issues/446) reports intermittent read-only safety-status failures. Its comments also describe successful local execution followed by a missing web final answer, and similar reports on other connectors. These reports support investigating multiple layers; they do not prove the cause of this particular Hermes stop or authorize removing safeguards.

## Diagnostic contract

The new observer sits between the MCP SDK and its stdio transport:

- `received`: a tools/call request reached the local transport before SDK argument validation.
- `reply_sent` + `success`: the transport write completed without an MCP tool error. This proves local send completion, not receipt by ChatGPT.
- `reply_sent` + `protocol_error`: the SDK/protocol returned an error, such as invalid arguments (`-32602`).
- `reply_sent` + `tool_error`: the tool returned `isError`.
- `send_failed`: writing the local reply failed.

Events contain only an in-process sequence number, an allowlisted public tool name, status, optional numeric protocol code and elapsed milliseconds. They contain no request IDs, arguments, file contents, credentials, user-supplied tool names or recursive payload inspection. At most 512 pending diagnostic correlations are retained. Logging failure cannot fail a tool call; protocol messages and metadata pass through unchanged.

The focused observer regression passed and the core typecheck and macOS package build passed. No full test suite or broad CI pipeline was run for this follow-up.

For the current native tunnel installation, obtain the log location from `tunnel-client runtimes status codex-chatgpt-web --json`. Share only the `[chatgpt-web-mcp] transport` records needed for the incident; other lines in a full runtime log may contain private data.

## Later resolution: user-selected Hermes Codex runtime

The user subsequently chose Hermes' built-in Codex runtime instead of the experimental direct
loop. Inspection found that Hermes did not forward `agent.model` to Codex's `turn/start`; a small
checked compatibility patch corrects that. A real Hermes native-runtime task then executed
`exec_command`, received the private fixture's marker and completed its final response in 72.84
seconds. Markdown escaping changed raw underscores but preserved the displayed marker. The
new provider `codex-web-native` selects Web High; other providers and unrelated settings were
verified against the backup and remained unchanged. See the [current runbook](../hermes-integration.md).
This does not retroactively repair or certify the direct-mode path described above.

## Installed state after the Hermes update

Hermes' own updater completed successfully on `1782bf79c8` (v0.21.2) and parked the local
model-forwarding change in its update stash. The pre10 setup button reapplied the checked patch
to the new source. The root provider remains `custom:codex-web-native`, model
`chatgpt-web/high`, transport `codex_app_server`, with a 95k context budget. After rebuilding and
restarting Hermes, its new-session picker displayed that provider/model and Gateway ready.
The installed bridge's core setup, Codex catalog, tunnel runtime and connector verification all
reported complete. The earlier actual read/tool/final-answer result is retained; no claim is
made that every desktop feature was exercised again after the update.

The user then reported **Couldn't check for updates / GitHub API rate limit reached (HTTP 403)**.
This was a separate discovery failure in the unmodified upstream API-first checker, not an
installation failure or a change to the model route. The old Git executable repair did not
cover this API path. The new checked-in [Hermes patch](../../integrations/hermes/manual-update-rate-limit.patch)
keeps passive checks API-only and permits one bounded ref query for an explicit check when the
API returns 403/429. The targeted behavior regression passed. The rebuilt installed desktop's
original version-button check then displayed **New update available** and cached a real target
SHA, with no error and an unknown commit count. No further update was installed for this check.

Hermes Desktop updates deliberately use `--keep-stash`. These local compatibility and updater
patches are retained in this repository with upstream attribution; future upstream installations
can park them again. See [reapplication and maintenance](../../integrations/hermes/README.md).
