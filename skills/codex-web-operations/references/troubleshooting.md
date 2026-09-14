# Diagnose the failing layer

| Observation | Next useful evidence / action |
| --- | --- |
| Chrome connection missing/denied | Distinguish OS descriptor access, Chrome consent, disconnected browser and wrong profile. Use the app's narrow native file grant only when offered. |
| Capture succeeded; verification failed later | Inspect embedded sign-in/verification. Changing remote-debugging settings alone does not fix an unaccepted session. Preserve fixed error codes without raw cookies/CDP data. |
| Navigation locked during login | A login owner is active. Use Cancel/continue/supported handoff; do not navigate around ownership or clear the profile. |
| Grey shell or invisible error | Verify visibility in actual DOM/screenshot; early releases tied opacity to animation frames. An error may exist but be hidden. |
| Models installed, catalog pending | Check actual Codex home/provider/catalog override and request count. Reinstall does not refresh a running desktop client. |
| Browser works, native/tunnel network fails | Electron follows system PAC; native children may not. Check endpoint-specific propagation and retain loopback in NO_PROXY. Respect explicit proxy configuration. |
| First response succeeds, next model selection fails | Capture owned picker/slider/submenu state. A family menu visible in a screenshot does not prove its hidden effort slider is actionable. Never silently select another model. |
| Model stopped thinking | Recognize the exact current response status; retain visible content as content. Do not infer quota exhaustion or user cancellation from a generic stopped label. |
| Capacity 503 followed by stale-turn rejection | A successor may resume only a matching retryable failure recorded by this daemon. Arbitrary stale history and aborted turns remain invalid. |
| Generic Create connector error | Inspect tunnel health, account/workspace association and operator rights. The message alone does not prove a ban. After a repeated failure, gather evidence instead of repeatedly creating/renaming connectors. |
| External tool safety refusal | Preserve the refusal. No label change, alternate execution channel or weakened approval is a fix. Distinguish transport receipt, SDK validation, broker invocation, native result and final answer. |
| Image omitted | Check route input modalities. Manual image handling is incomplete; base64 prose is not image support. Native Computer Use availability/key-name errors are separate. |
| Healthy doctor but tools unavailable | Local health and connector readiness differ. Inspect warnings and perform a real tool call. |
| Download says an organization blocked it | This wording does not identify an organization. Browser Use may return BlockedByClient when a file response was not awaited. Start the supported download wait before the final Download click, then inspect the saved file; do not change browser policies from this message alone. |
| Bigger Context fails with extra conversation turns | Inspect the bounded multipart trace and exact transaction acknowledgements. Pre11 introduced preservation of verified staging acknowledgements when ChatGPT remounts turns; the original large Pro continuation remained unverified. Do not accept arbitrary extra responses to make the request pass. |
| Context setting is queued | Inspect the active profile and request counts. The saved choice is not active until applied. Native forwarded HTTP requests also keep the runtime busy even with zero browser turns. |
| Setup buttons stay disabled after startup | Distinguish a live login/turn/operation from a stale browser status. A confirmed pre13 failure left status=loading and the connector-catalog refresh message after successful capability inspection, with no navigation lock. Pre14 restores ready only after the helper's authenticated evidence passes validation. |
| Signing succeeded but runtime integrity failed | Confirm Bun was signed before its manifest size/hash and aggregate bundle ID were recorded. Re-signing Bun afterward changes those bytes. Repair the artifact, then sign its containing app; do not disable integrity checks. |

## Operator observations

Use the currently documented browser/Computer Use tools. When the user asks for screen control,
operate the relevant UI; do not infer old AX IDs or coordinates remain valid. Native clipboard
or ScreenCaptureKit errors can occur after the action succeeded: reacquire state before retrying.
After an address-bar shortcut, verify focus before typing; otherwise a URL can be sent as a chat
prompt. If native menu control is unreliable, use the supported same-tab browser UI controls
when permitted, without raw-CDP or shell input workarounds for policy blocks.

Logs: the known Mac launcher log is under `~/Library/Application Support/Codex Web GPT/logs/`;
core config is under `~/.codex-chatgpt-web`. Read narrow event/time slices, not complete session
or credential files. `launcher-browser.json` includes a control token; never print it wholesale.
Inspect credential permissions/existence without values. Keep raw captures out of repositories.

For completed fixes, preserve source provenance and state what was actually exercised. Every
installed/account observation can change; dated reports are pointers, not current proof.

A download-wait timeout can occur even after a file was saved. Check the expected file's
existence, size and identity before another click, especially for one-time Apple API downloads.
Keep API keys in the private signing directory or Keychain; never print their contents.

## Distinguish MCP failure layers

In builds with transport evidence, locate the tunnel log using its runtime status and inspect only `[chatgpt-web-mcp] transport` records. `received` precedes SDK argument validation; `reply_sent` distinguishes success, tool_error and protocol_error. A successful local send does not prove cloud receipt. A model saying “blocked by safety checks” without a structured error is not a proven diagnosis of the cloud component. Do not relabel or reroute a denied action to bypass safeguards. Keep native Codex success separate from Hermes success and do not treat a final refusal as completion of a requested tool operation.
