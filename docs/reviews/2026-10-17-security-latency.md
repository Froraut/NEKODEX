# Web security failures and retained Instant selection

The installed 6.1.32-nekodex.2 showed a ChatGPT `cloudflare_challenge` even for a short manually submitted prompt in its ordinary browser window. A healthy tunnel and a rendered signed-in page did not establish usable ChatGPT submission. Account recovery must complete through the supported browser/Chrome flow; no challenge bypass or account-data copying was attempted.

The original short native request spent about 12 seconds acquiring/navigating its page, verifying the session, choosing the model and connector, and submitting. The response became visible immediately after send acceptance and completed about three seconds later. A subsequent request failed with the security check before send acceptance. These are observed timings for those requests, not a general speed guarantee.

## Code changes and focused evidence

- Preserve the browser security denial on the next matching native replay, before adapter dispatch. The transport uses HTTP 400 because the tested bundled Codex retried HTTP 403 as well as an unknown streamed error code; `permission_error`, `chatgpt_security_check`, and the upstream 403 remain explicit in the body.
- Reuse an already-selected model on a retained page only after matching its URL, family, effort, closed control and visible label. Preserve the independent live pre-send check. This removes repeated selection work without changing models or dropping context/tools.
- Two HTTP regression cases passed. The actual bundled Codex client against a local fixture made two HTTP requests and only one adapter attempt, then stopped in 287 ms. Before correcting the HTTP boundary, the same fixture made six requests and three adapter attempts. No real ChatGPT request was issued by that fixture.
- A real headless-browser fixture confirmed that the retained selection does not reopen the menu, that pre-send verification still opens and inspects it, and that a changed visible selection fails verification. Final core typechecking and the development renderer/helper builds passed.

The recovery attempt exposed a second defect: the importer expired its 120-second deadline while Chrome's native Allow prompt was still awaiting the user. The helper now excludes that wait from its machine-work budget, remains explicitly cancellable, and has no parent wall-clock timeout over consent. The UI hides the countdown during the human wait. Focused checks cover delayed approval beyond the configured machine timeout and cancellation of a pending handshake.

## Browser and import investigation

The authorized Chrome import connected successfully on October 17 at 08:10 UTC, then failed before replacing the session. The embedded page's developer console identified the exact error: `Rollback local storage is too large`. A counts-only measurement found eight local-storage entries totaling 5,773,058 UTF-8 bytes. The old 4 MiB limit prevented safe session replacement even though this was legitimate ChatGPT state. The rollback limit is now 64 MiB at the user's request. It remains bounded, retains the whole before-image, and fails before mutation if exceeded. Focused regression checks verify lossless restoration above the old limit and rejection above the new one.

Ordinary Chrome completed a matched GPT-5.6 Sol Instant request in under nine seconds. After a graceful launcher restart onto the source build, the same account in NEKODEX produced its matched Instant reply within the first two-second observation, with completion subsequently confirmed. No cookies or account data were manually copied, and no user-agent or security override was applied. The running engine remained Chromium 146. The fresh process recovered this session; this does not prove which Cloudflare scoring signal caused the original block. Prior network checks reported one stable egress address shared with the challenge host.

Installed activation and the full Codex-to-Web request check remain separate from this successful development browser check. No public release assets are required for this local update.
