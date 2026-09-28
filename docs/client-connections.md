# Claude Code, local API and Web-only Codex

These optional connections are available in the **6.1.1 source candidate** under
**Connections → Other clients**. Published installers remain at the version
shown on the Releases page until a separate release is produced.

Sign in and connect models first. Keep NEKODEX running for Web requests. The
default Codex configuration still offers Native and Web models together.
Additional connections share the existing browser/account admission and ChatGPT
allowances. They do not create extra provider capacity or change tool permissions.
The DEV profile keeps its settings separate and does not modify installed clients.

## Claude Code

Choose **Connect Claude Code**, then restart Claude Code. ChatGPT supplies model
responses; Claude Code executes its own tools under its existing permissions.
Full mode and the displayed ChatGPT tools connector are required for function
tool rounds. Text-only requests can use Browser-only mode.

The connection writes the provider URL, private local API key and available model
list to Claude's settings. Other settings, including permissions, are preserved.
An existing custom provider must be removed deliberately before connecting.
**Disconnect** restores the previous owned fields. Conflicting edits made after
connection are preserved and reported instead of overwritten.

The CLI equivalents are:

```sh
codex-chatgpt-web claude status
codex-chatgpt-web claude connect
codex-chatgpt-web claude disconnect
```

`CLAUDE_CONFIG_DIR` selects an alternate Claude settings directory. Use the same
NEKODEX home for all commands. The installer supports Anthropic Messages, model
discovery, token estimation, text/image history and client function results.
Web reasoning progress is not an Anthropic signed thinking block. Token counts
are estimates and the local browser context budget still applies. This gateway
does not claim the complete Anthropic API feature set.

## Local API

Choose **Enable API** and **Copy API key**. Set your client's OpenAI-compatible
base URL to the address shown by NEKODEX (normally
`http://127.0.0.1:8765/v1`), and use that key. Query `GET /v1/models` for the
models currently allowed by the saved account observations.

- `POST /v1/chat/completions` supports text messages, complete function schemas
  and standard JSON/SSE completion responses. Unsupported semantic parameters
  are rejected explicitly. Use the Messages endpoint for image input.
- `POST /v1/messages` and `/claude/v1/messages` provide the Messages protocol.
  Their `count_tokens` endpoints return estimates; `/claude/v1/models` provides
  the Claude model catalog.
- Authenticate with `Authorization: Bearer <key>` or `x-api-key: <key>`.
  Conflicting credentials are rejected. Requests must originate on loopback;
  cross-origin browser requests are rejected.
- The key cannot authorize Native Responses, launcher controls or admin routes.
  Prompt execution uses the same account pool. External clients keep ownership
  of their tool execution; a tool result must match the issued turn and call.

Access is disabled by default. **Disable API** rejects subsequent requests;
**Replace API key** invalidates the previous key. Refresh Claude settings after
a rotation and update other clients. Already running requests retain their
normal cancellation/settlement contract. Disconnecting Claude does not revoke
other clients' API access.

```sh
codex-chatgpt-web api enable
codex-chatgpt-web api status
codex-chatgpt-web api key     # prints the private key; do not put it in logs
codex-chatgpt-web api rotate
codex-chatgpt-web api disable
```

Requests and queued output have bounded byte limits (4 MiB at the HTTP boundary).
An interrupted stream is an error, not a successful partial answer. Cancelling
a request waits for owned work to settle; it cannot undo tools already executed
by the client. Model prompts are still processed remotely by ChatGPT.

## Web models in the Codex app picker

The Codex desktop app now lists only models that OpenAI allows for the signed-in
account, so routed Web models returned by `/v1/models` never reached its picker.
In the default **Native and Web models** mode NEKODEX gives Codex its own
`model_catalog_json`: `codex-picker-models.json` in the NEKODEX home. The file
holds every native row from the account's live catalog, the named Web rows, and
hidden fixed-mode rows for saved tasks. Codex then lists all non-hidden rows.

The Web rows follow the account's ChatGPT model picker. NEKODEX reads the picker
at each browser check (startup, **Check account**, Repair) and again every six
hours while the account is idle and the NEKODEX browser is out of view. When
ChatGPT adds, renames or retires a model, the saved evidence and the picker
catalog are updated without a Repair. Confirming the models in Codex records which Web rows
were confirmed; whenever the catalog Codex would load differs from that, the
launcher asks you to fully quit and reopen Codex and confirm the picker again.
A served catalog request alone never clears that request.

Codex reads this file once per start and stops requesting `/v1/models` while
it is set. The runtime refreshes the file from authenticated Codex traffic at
most every ten minutes, and on any `/v1/models` request. Fully quit and reopen
Codex to see a changed list. A `model_catalog_json` you set yourself takes
precedence and is never replaced. Web-only mode owns the key, so the picker
catalog is removed while it is active. Disconnect, uninstall and the opt-out
restore the previous Codex configuration exactly.

Turn it off under **Connections → Other clients → Codex provider**, or:

```sh
codex-chatgpt-web provider picker-off
codex-chatgpt-web provider picker-on
```

The choice is kept across later setup runs. If you change or remove the managed
`model_catalog_json` line yourself, NEKODEX keeps your value and no longer
manages it. Turn the list off before installing an older NEKODEX version, which
does not know this setting. If Codex has not loaded its models
since setup cleared its cache, turning the picker on asks you to open Codex once
first.

## Web-only Codex

Choose **Web models only** and apply, fully quit/reopen Codex, then start a new
task. This uses a separate `nekodex-web` provider with no Native authentication
requirement and a local Web-only model catalog. It can separate Web requests
from a desktop Native quota gate; actual ChatGPT limits still apply. Native
models and account features are unavailable while this mode is selected.

Choose **Native and Web models** to restore the prior Native selection. Restart
Codex again. Model/effort changes within the managed Web catalog are preserved;
foreign edits to the provider or catalog are reported instead of overwritten.

```sh
codex-chatgpt-web provider status
codex-chatgpt-web provider web-only
codex-chatgpt-web provider mixed
```

If Codex has no native model cache yet, export its bundled catalog and pass it
explicitly:

```sh
codex debug models --bundled > /tmp/nekodex-native-models.json
codex-chatgpt-web provider web-only --catalog /tmp/nekodex-native-models.json
```

The saved catalog is a snapshot. After account or model availability changes,
run Repair and restart Codex. Family-specific observations keep unavailable
GPT-6 Pro from hiding GPT-5.6 Sol Pro. GPT-6 is offered only at ChatGPT's Pro level;
below Pro ChatGPT always runs GPT-5.6 Sol. Older fixed-mode IDs and the retired
GPT-6 Astra IDs remain hidden but resolvable for saved tasks. Availability is not
a quota balance or reset-time prediction.

## Verification boundaries

The source change was checked with actual Codex and Claude CLIs against an
isolated local HTTP server and inert model adapters. Claude performed an actual
Read tool cycle in a disposable directory. A separate authenticated DEV browser
request returned `CODEX WEB GPT READY`, and its saved sign-in survived restart.
These checks do not reproduce an exhausted Native desktop account or establish
every external client's full tool workflow against a live ChatGPT connector.
