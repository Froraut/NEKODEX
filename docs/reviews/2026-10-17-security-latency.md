# Web security failures and retained Instant selection

The installed 6.1.32-nekodex.2 showed a ChatGPT `cloudflare_challenge` even for a short manually submitted prompt in its ordinary browser window. A healthy tunnel and a rendered signed-in page did not establish usable ChatGPT submission. Account recovery must complete through the supported browser/Chrome flow; no challenge bypass or account-data copying was attempted.

The original short native request spent about 12 seconds acquiring/navigating its page, verifying the session, choosing the model and connector, and submitting. The response became visible immediately after send acceptance and completed about three seconds later. A subsequent request failed with the security check before send acceptance. These are observed timings for those requests, not a general speed guarantee.

## Code changes and focused evidence

- Preserve the browser security denial on the next matching native replay, before adapter dispatch. The transport uses HTTP 400 because the tested bundled Codex retried HTTP 403 as well as an unknown streamed error code; `permission_error`, `chatgpt_security_check`, and the upstream 403 remain explicit in the body.
- Reuse an already-selected model on a retained page only after matching its URL, family, effort, closed control and visible label. Preserve the independent live pre-send check. This removes repeated selection work without changing models or dropping context/tools.
- Two HTTP regression cases passed. The actual bundled Codex client against a local fixture made two HTTP requests and only one adapter attempt, then stopped in 287 ms. Before correcting the HTTP boundary, the same fixture made six requests and three adapter attempts. No real ChatGPT request was issued by that fixture.
- A real headless-browser fixture confirmed that the retained selection does not reopen the menu, that pre-send verification still opens and inspects it, and that a changed visible selection fails verification. Typechecking passed before the final naming/transport adjustment; repeat it for that final source.

The recovery attempt exposed a second defect: the importer expired its 120-second deadline while Chrome's native Allow prompt was still awaiting the user. The helper now excludes that wait from its machine-work budget, remains explicitly cancellable, and has no parent wall-clock timeout over consent. The UI hides the countdown during the human wait. Focused checks cover delayed approval beyond the configured machine timeout and cancellation of a pending handshake.

Live account recovery and installed activation are pending. Do not report this source change as a recovered ChatGPT session or an installed latency improvement until those observations are complete.
