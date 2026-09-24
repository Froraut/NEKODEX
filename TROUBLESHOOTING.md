# Troubleshooting

This guide covers the failures reported most often in GitHub issues. Start here before reinstalling,
editing Codex configuration, or opening a new issue.

## The first five minutes

1. Use **Updates** in NEKODEX or the [fork's releases](https://github.com/Froraut/NEKODEX/releases).
   Updates preserve the private ChatGPT profile and launcher configuration.
2. In **Connections**, check sign-in, the model connection and any configured tools separately.
   A successful catalog request and models visible in the Codex picker are separate observations.
3. Open Codex's model picker or try a new task. If the intended models/settings are still missing
   after checking the route, finish active work and fully quit/reopen the app hosting Codex.
   Keep NEKODEX running. Restarting is a recovery step, not proof that setup succeeded.
4. Select a **ChatGPT Web — …** model from Codex's model picker.
5. Run **Settings → Run doctor**. If the problem remains, reproduce it once and immediately use
   **Activity → Export safe log**.

Do not repeatedly press setup actions after they report success. The exact error and a fresh safe
log are more useful than another reinstall.

## Models do not appear, or setup remains on step 3

**Install models** saves the Codex route. Follow the actual connection status:

- **Waiting for Codex to load the models:** a successful request has not been observed. Open the
  model picker and inspect **Check Codex routing**. If the client still has the old settings,
  finish current work and fully quit/reopen that Codex client.
- **Confirm your models in Codex:** the catalog has already been received. Confirm the picker only
  after seeing the NEKODEX model rows. An unconfirmed picker does not establish a restart requirement.
- **Model catalog unavailable:** inspect the reported catalog/route error; reinstalling or restarting
  repeatedly is not a substitute for correcting it.

The legacy `codexRestartRequired` field is a client-refresh hint. Older builds recreated it solely
because picker confirmation was missing; it is not an observation of the Codex process or proof
that a running task has loaded a new context limit.

If the models still do not appear:

- check **Settings → Check Codex routing** and **Run doctor**;
- make sure another Codex wrapper is not replacing the route;
- use **Connections → Install into Codex → Reinstall** once only if the saved integration needs repair; and
- export a safe log after the failed catalog check.

A green step 3 followed by a browser-turn error means installation succeeded. Repeating step 3 will
not repair an unrelated ChatGPT browser or model-turn failure.

## `openai_base_url changed after setup` or a model is "not supported"

The launcher deliberately refuses to overwrite a route changed by another tool. Only one program
can own Codex's `openai_base_url` at a time. Wrappers and routers such as OpenCodex, Headroom,
OmniRoute, Codex++, CC Switch, or a manually configured provider may replace the Codex Web GPT route
for the whole installation or only for the process they launch.

Choose one route owner:

- To use Codex Web GPT, disable the other wrapper's provider/proxy mode, run **Repair Codex setup**,
  fully restart Codex, and start Codex directly rather than through the wrapper command.
- If `model_provider` selects a custom provider, select the built-in `openai` provider or remove
  that setting before setup or reconnect. `--replace-codex-route` changes the route URL only; it
  does not change the provider. Keep the previous provider settings for a deliberate switch back.
- A tool may remain enabled only as an MCP integration if it does not replace `openai_base_url`.
- To switch away cleanly, use **Settings → Remove Codex integration** first. This restores the exact
  route that existed before Codex Web GPT was installed.

Do not hand-edit the launcher's route journal. It exists so setup and removal can fail closed instead
of silently destroying another provider's configuration. First-class external-router composition is
tracked in [#205](https://github.com/miuuyy/codex-chatgpt-web/issues/205), but is not supported today.

## Native Codex models stop working after NEKODEX is quit

An installed `openai_base_url` sends Responses through the local bridge, including requests for
native models. Quitting NEKODEX stops that bridge while leaving the Codex route installed.

- To continue using the integration, reopen NEKODEX, wait for its runtime to be ready, then fully
  quit and reopen Codex so it reloads the route.
- To stop using it, use **Settings → Remove Codex integration** and wait for restoration of the
  previous route. Fully restart Codex before quitting or uninstalling NEKODEX.
- For a temporary CLI route change, finish active tasks, run `codex-chatgpt-web route disconnect`,
  and fully restart Codex. Reconnecting likewise requires a full restart. A successful change
  keeps JSON on stdout and prints the reminder on stderr.

If restoration fails, keep the config and route journal for recovery. The previous route may belong
to another provider; do not replace it with a guessed URL. An already running Codex process can
retain its old route until restarted.

## Windows Full harness tunnel does not start when psmux supplies `tmux`

If tunnel diagnostics show `tmux list-panes failed` and `psmux: no server running`, the bundled
tunnel client may have selected psmux supervision because `tmux` is on the launcher's `PATH`.
Launch NEKODEX from an environment without that psmux directory on `PATH`, then retry MCP setup.
Keep the existing tunnel and runtime key; this failure does not establish that either is invalid.

## Encrypted history cannot be verified after switching models

A switch from ChatGPT Web to native Codex in the same task can report that encrypted content
cannot be verified or decrypted if bridge-owned history reaches the native backend unchanged.
The error alone does not identify which program forwarded the request.

NEKODEX stores its own `ocx1:` continuation summaries and `ocxr1:` reasoning envelopes in the
Responses `encrypted_content` field. They are not OpenAI-issued ciphertext. The native
passthrough converts our summaries to readable context and removes our reasoning envelopes;
genuine native encrypted payloads remain intact. This applies to ordinary responses and both
compaction protocols.

With the NEKODEX-owned route, include the source/destination model and whether compaction preceded
the failure in an Activity safe-log report. An external router may send native requests directly
to OpenAI, bypassing this normalization even though its Web requests go through NEKODEX. That
router needs compatible conversion on `/responses`, `/responses/compact`, and requests ending
in `compaction_trigger`. Updating NEKODEX cannot change a bypassed route.

Do not reinstall models to fix another router's history conversion: setup changes route ownership.
Do not strip all encrypted fields or delete compaction records, which can destroy valid context.
An available workaround is to return to the Web model, request a readable summary, and start a
new native task with that summary. Include versions, route owner and the redacted error when
reporting; never attach raw history, decoded envelopes or credentials.

## ChatGPT sign-in does not complete

The launcher must own the ChatGPT session used for model turns. Signing in to an unrelated browser
window does not automatically transfer that session.

- Complete ordinary sign-in inside the launcher-owned flow and wait until a Temporary Chat composer
  is visible.
- Do not navigate or close the launcher browser while authentication or session verification is
  running.
- If the account offers **Try another way**, an alternate authentication method can avoid a
  platform-passkey limitation.
- For macOS passkeys, use **Use passkey** in the launcher's browser toolbar. The embedded
  browser may not show the system passkey chooser. The launcher opens a separate Chrome profile:
  finish sign-in there, wait for the ChatGPT composer, then return and choose **Import Chrome
  sign-in**. The launcher verifies the imported session and removes the temporary transfer.
- In this fork, choosing **Use passkey** during an embedded login cancels and awaits the previous
  attempt before starting Chrome. You should not have to wait for the three-minute login timeout.
  Only this explicit passkey flow transfers allowlisted ChatGPT/OpenAI state; it does not import
  your ordinary Chrome profile. See [upstream issue #209](https://github.com/miuuyy/codex-chatgpt-web/issues/209).
- Use **Show sign-in Chrome window** to bring the exact dedicated Chrome process to the front,
  including when it is on another macOS Space. If macOS cannot reveal it, use Mission Control.
  The button cannot target your ordinary Chrome session.
- The main process retains the login phase and deadline across renderer reloads. **Import Chrome
  sign-in** is enabled only while that Chrome attempt is waiting. Once import begins, Chrome closes
  and its disposable profile is captured offline before the launcher verifies the imported session.
- **Cancel sign-in** stops the active attempt and removes its temporary state. On timeout or failure,
  **Retry** opens a fresh dedicated profile; repeat sign-in there. Never copy your everyday browser
  profile into the launcher.
- Back, Forward, and Reload are intentionally disabled during an active login or browser
  operation. A sign-in failure and a blocked navigation action are different conditions.

If an ordinary login still fails, export a safe log immediately after one attempt. Include the OS,
launcher version, account tier, sign-in provider, and whether the Temporary Chat composer ever
appeared. Never upload cookies, browser storage, authentication headers, or raw profile files.

## The browser smoke test fails

The smoke test and real turns use the same current ChatGPT controls. Errors mentioning the effort
control, composer, send button, Temporary Chat, personalization, or an operational viewport usually
mean that the ChatGPT UI did not expose a structure the bridge can safely prove.

1. Update to the latest release.
2. Confirm that a normal Temporary Chat can be opened in the launcher and that the account is not
   showing a login, onboarding, capacity, or rate-limit dialog.
3. Run the smoke test one more time with the launcher visible.
4. If the same structural error remains, do not keep retrying. Export a safe log and open a focused
   bug report; ChatGPT UI drift must be fixed against the observed DOM, not guessed around.

Free and Go accounts normally expose Luna and Think without the paid-account effort selector. A
missing paid selector on those accounts is not itself a sign-in failure.

## Full harness or MCP verification fails

Video walkthroughs:

- [Create an OpenAI tunnel and API key](launcher/src/assets/mcp-create-tunnel.mp4)
- [Connect the local harness and attach the ChatGPT connector](launcher/src/assets/mcp-connect-connector.mp4)

Browser-only mode does not use an MCP connector. The following checks apply to Full harness with
**With Automation** selected. For **Manual mode**, use the [manual workflow checks](#zero-risk-manual-workflow-stops)
below; its connector and Tunnel are separate.

Check the runtime version first. The published `5.2.0-nekodex.1` binary uses **Codex Native3**
(**Codex Native3 DEV** in DEV) and **Codex Zero Risk2** in Manual. A runtime built from the `.2`
source contract uses **Codex Native4**, **Codex Native4 DEV**, and **Codex Zero Risk4** respectively.
The `.2` source contract is not yet a published binary release.

- a newly created connector named exactly **Codex Native4** for the `.2` Automatic Full runtime;
- **Developer Mode** enabled in ChatGPT;
- the exact Tunnel selected with **Authentication: None**;
- the connector and Tunnel on the same OpenAI account as the ChatGPT workspace;
- **Allow all actions** under the connector's permissions; and
- **Connect harness** completed before **Verify runtime**.

For the `.2` runtime, start **MCP → Connect harness** for the mode in use, then create a new
ChatGPT connector with that mode's exact name and the Tunnel shown by setup. Select
**Authentication: None**; use **Allow all actions** for Full harness if those tools are intended,
while outer Codex sandbox and approvals still apply. Run **Verify runtime** for Automatic Full;
select the Manual connector yourself before sending. DEV Full uses its isolated Tunnel and
**Codex Native4 DEV**. Keep older connectors unchanged: ChatGPT caches the public MCP contract by
identity, and renaming or refreshing one does not load the new schema. Local setup or connector
visibility is not proof of an actual tool call.

### Windows: `unable to verify the first certificate`

If connecting the harness and checking for updates both fail with this certificate error,
first check the same connection through the Windows trust store:

```powershell
curl.exe -Iv https://api.openai.com/
```

If curl identifies its TLS backend as `schannel`, completes TLS and receives an HTTP response,
Windows accepted that certificate chain. After active tasks finish, quit NEKODEX and try launching
it from PowerShell with the system CA option:

```powershell
$env:NODE_USE_SYSTEM_CA = "1"
$install = (Get-ItemProperty "HKCU:\Software\d1a6026a-6210-588e-9a2b-da3936f94e02").InstallLocation
Start-Process (Join-Path $install "NEKODEX.exe")
```

This adds operating-system trust roots for Node versions supporting the option; it does not
disable certificate verification or guarantee that a separate runtime uses the same trust store.
Retry once and export a safe log if it still fails, noting the curl result. Do not set
`NODE_TLS_REJECT_UNAUTHORIZED=0`. A proxy or runtime-specific CA configuration may still be needed.

### ChatGPT shows `Error creating connector`

1. Confirm that the Tunnel ID and the regular API key used by the launcher were created under the
   same OpenAI account.
2. Confirm that the launcher has connected the local harness and the Tunnel is running before you
   create the connector in ChatGPT.
3. ChatGPT can reject the first **Create** attempt once even when the Tunnel is healthy, usually
   after 5–10 seconds. Press **Create** one more time. If the second attempt also fails, stop
   retrying and recheck the account, Tunnel ID, and running Tunnel first.

If tool calls work until native Codex quota is exhausted and then edits are denied by **Automatic
approval review**, disable that optional Codex review setting and restart Codex. The outer Codex
sandbox and explicit approvals still apply; this only prevents an unavailable native model from
being inserted as an extra reviewer after the Web tool call already completed.

<a id="zero-risk-manual-workflow-stops"></a>

## Manual workflow stops

**Manual mode** is the name of the manual browser interaction mode. It still exposes the local Codex
harness through MCP, so manual submission does not remove account limits or local-tool risks.

First check the mode-specific setup: `.2` Manual turns use **Codex Zero Risk4** and their own OpenAI
Tunnel; `.2` Automatic Full turns use **Codex Native4**. The published `.1` binary uses
**Codex Zero Risk2** and **Codex Native3** instead. Use the names for the runtime actually running.
The launcher does not inspect the ChatGPT page to verify the model, effort, or connector you choose.

For a manual turn, wait for the launcher to prepare the prompt, then use **Copy prompt** if needed.
In ChatGPT, select the intended model, effort, and **Codex Zero Risk4** connector for the `.2`
runtime (**Codex Zero Risk2** for the published `.1`) before pasting and sending the prompt.
Return to the launcher and confirm **Sent** only after sending it in ChatGPT.

To locate a failure, record the last step that worked and the next step that failed:

- prompt preparation or **Copy prompt**;
- selecting the ChatGPT model, effort, or connector;
- pasting and sending in ChatGPT;
- confirming **Sent**;
- waiting for the mode's version-specific Manual connector to connect; or
- MCP tool execution and delivery of the completed answer to Codex.

In the bug-report form, choose **Manual mode (manual browser interaction / MCP)** and the matching
workflow step. Include the Codex picker entry separately from the actual ChatGPT model and effort;
the picker entry alone does not establish what was selected in ChatGPT. If a selector was absent,
say so. Attach the safe log exported immediately after the failed turn, and describe the steps
without publishing the prepared prompt, raw browser state, credentials, or Tunnel IDs.

## `Reconnecting`, `stream disconnected`, or `ChatGPT failed`

These are result boundaries, not one diagnosis. The bridge uses them when it cannot prove a complete
ChatGPT turn. Common causes include an account-side rate limit, ChatGPT's own "Something went wrong"
state, a changed UI control, a closed browser surface, a conflicting route, or a tool that exceeded
its bounded MCP deadline.

- Read the final detailed error after the reconnect attempts; do not report only the word
  `Reconnecting`.
- Retry once in a fresh Codex task. State whether the fresh task works and whether the failure is
  consistent.
- Run **Settings → Run doctor** and export a safe log immediately after the failure.
- State whether the turn used Browser-only, automatic Full harness, or Manual mode. Include the Codex
  picker entry, whether tools ran, and whether ChatGPT displayed a final answer. For Manual mode,
  also give the actual ChatGPT model and effort and the failed manual workflow step.

Do not assume that a generic 502 means the Tunnel is broken. Since v4.0.7, a native tool that
outlives its turn binding is reported explicitly as `codex_tool_timeout` and retired rather than
being presented as an ambiguous proxy success.

## Native compaction returns `404 Not Found`

For an ordinary Codex model, `/v1/responses/compact` forwards to the native legacy compact
endpoint. That endpoint can return an upstream 404 even when the model and authorization work.
Check whether a config layer sets `[features].remote_compaction_v2 = false`. Current Codex enables
V2 by default; remove that override or set the existing key to `true`, then restart Codex and retry
compaction on the same native model. V2 uses `/responses` with a compaction trigger.

If it still fails, include the effective feature setting, selected model, exact failure time and
safe log. `native_compaction_upstream_failed` records the route, model, HTTP status and available
request identifiers without prompt contents or credentials. A separate Web context-length error
still requires its own diagnosis; changing the native protocol does not increase Web input limits.

## ChatGPT says the account is temporarily limited

The bridge permits at most five simultaneous browser tabs as an account-safety ceiling. Five is not
a recommended concurrency setting, and ChatGPT does not expose a stable numeric quota or cooldown.
Some accounts have reached a limit with only two turns started close together.

After the first account-side limit response, stop retrying and let the cooldown clear. For a
conservative starting point, set one spawned agent thread at a time in the existing `[agents]`
section of `~/.codex/config.toml`:

```toml
[agents]
max_concurrent_threads_per_session = 1
```

If the table already contains the older `max_threads` name, replace that assignment rather than
adding the new name beside it. Codex treats `max_threads` and `max_concurrent_threads_per_session`
as aliases, so defining both can make `codex exec` fail with a duplicate-field error. Otherwise,
add or change only `max_concurrent_threads_per_session`; do not create a second `[agents]` table.
Bigger Context can make one turn larger and longer, but does not increase safe account concurrency.

## Images from earlier turns are attached again

Codex includes prior task images in the canonical conversation context. The bridge follows that
context and keeps only the newest ten complete images, so seeing an earlier image again in the same
task is expected. Start a new Codex task when the new request must not carry earlier image context.

Open an issue if the launcher reports that ChatGPT did not accept all attachments, or if images from
a different Codex task appear. Include a fresh safe log with the failing trace and attachment stage.
Do not replace inline images with arbitrary local paths: browser-only and compaction turns
intentionally do not receive unrestricted filesystem access.

## Image generation stops before an image appears

Image generation inside the ChatGPT browser conversation is not currently a supported turn type.
ChatGPT uses a separate generation lifecycle that the text-response bridge cannot reliably prove
complete or retrieve through its current contract.

Codex's native Image Gen tool uses a different path: it sends `/v1/images/generations` or
`/v1/images/edits` through the configured Codex base URL. The bridge forwards those requests to the
native Codex backend using the incoming Codex authorization. A local `404 Not found` on these paths
in 5.0.4 or earlier is a missing bridge route, not proof of an OpenAI plugin or backend failure.
Upstream authentication and image-allowance errors remain unchanged; the ChatGPT browser connector
does not provide credentials or additional allowance for native Image Gen.

## Update, repair, and remove

To update through the standalone installer, quit **NEKODEX** and run the same installer command from the README. The installer
replaces the application and runtime while preserving the launcher configuration and private
ChatGPT profile.

On Linux, an older direct AppImage installation can report that automatic update requires the
stable `install-launcher.sh` wrapper. Install once with NEKODEX's authenticated Linux installer
to create that wrapper and desktop entry; subsequent launches through it retain the update path.
Keep the current app and profile until the installer reports completion.

Use **Repair Codex setup** only when diagnostics identify an integration problem. After repair,
check the catalog and model picker; reopen Codex if it still uses the old settings. Avoid deleting
configuration until **Run doctor** and a safe log identify which layer failed.

To remove the integration safely:

1. Open **Settings → Remove Codex integration** and wait for it to restore the previous Codex route.
2. Fully restart Codex.
3. Quit the launcher and uninstall the application normally for the platform.
4. If Full harness was configured and is no longer wanted, separately delete the connector used
   by that runtime (**Codex Native4** for `.2`, **Codex Native3** for the published `.1`), its
   Tunnel, and the API key created for that Tunnel from the corresponding account settings.

Deleting the application before step 1 can leave Codex pointed at a local route that no longer
exists.

## Open a useful bug report

Use the repository's bug-report form and attach the privacy-safe export from **Activity → Export
safe log**. A useful report contains:

- launcher version and installation method;
- Codex Desktop and/or CLI version;
- OS and architecture;
- ChatGPT account tier;
- integration mode: Browser-only, Full harness with automatic browser interaction, or Manual mode
  with manual browser interaction;
- exact Codex picker entry; for Manual mode, also the actual ChatGPT model and effort and the failed
  manual workflow step;
- exact reproduction steps and complete final error;
- whether it reproduces in a fresh Codex task; and
- a safe log captured immediately after that reproduction.

Screenshots are welcome, but a screenshot without the exact error and fresh log is usually not
enough to distinguish setup, routing, browser DOM, account, and MCP failures.

Before uploading anything, read [SECURITY.md](SECURITY.md). Never publish raw launcher logs, cookies,
browser storage, API keys, Tunnel IDs, full Codex prompts, tool output containing private data, or
absolute private paths.
