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
