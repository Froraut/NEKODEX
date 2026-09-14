# Live execution and block investigation — 2026-09-14

Build: **5.1.0-froraut.9**, macOS arm64. This continues the [issue/PR investigation](2026-09-14-investigation.md).

## Outcomes

| Path | Observed result | Boundary |
| --- | --- | --- |
| Native Codex → ChatGPT Web High → MCP → native file read → final answer | **Passed** in 51.25 seconds, CLI exit 0. The file contained a random marker withheld from the prompt; the received answer matched it exactly. | One real read-only task, not all models, tools or operating systems. |
| Hermes → ChatGPT Web → Hermes final response | **Transport completed.** A real Hermes AIAgent received the model's final response. | The response was a refusal, not the requested file contents. |
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
- Hermes local tool operation: **blocked/unverified in the observed live runs**. No blanket claim that Hermes tools work is made.
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
