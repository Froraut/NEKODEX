# Scoped account and UI acceptance

Run `bun scripts/acceptance.ts` from the repository with the pinned Bun runtime. Its default is
**offline fixtures only**. It does not read an account profile, open a browser, start the installed
launcher, send a prompt or access the network. It prints a versioned JSON report and never treats
an unexercised level as a pass.

The runner addresses the UI-drift and account-evidence requirements in the
[reliability review](reviews/2026-09-11-review.md) and preserves the separate outcomes described in
the [upstream issue review](reviews/2026-09-11-upstream-triage.md). Passing fixtures cannot resolve an
account-specific upstream report.

## Evidence levels

| JSON scope | Explicit option | What a directly verified pass establishes |
| --- | --- | --- |
| `offline-fixtures` | Default | Versioned sanitized model, slider and selector contracts match their pure production parsers. No browser DOM execution or current account state is inferred. |
| `local-startup` | `--local-startup` | A source daemon starts in temporary app/Codex homes, answers health and one synthetic Responses request through a fixture adapter, and shuts down. It does not exercise a packaged app or account. |
| `local-codex-catalog` | `--local-codex <executable>` | The existing isolated Codex catalog smoke accepts the augmented catalog. No live Codex task or MCP invocation runs. |
| `live-session` | `--live-session` | The owned automatic launcher surface authenticates and returns consistent model-capability evidence through the same inspection boundary used by doctor. It may navigate the owned inspection surface; it sends no prompt. |
| `live-chatgpt` | `--live-prompt --prompt-count 1` | One browser-only prompt returns exactly the expected marker with the selected effort. No local tools are advertised. |
| `live-codex` | Required gate / operator report only | This runner has no automatic installed-task executor. An actual Codex task must establish this separately. |
| `live-mcp` | Required gate / operator report only | This runner has no automatic live connector invocation. A real installed task must establish exact connector/tool invocation separately. |

`requiredChecksPassed` applies only to explicitly required scopes, including the default fixture
scope and every operation selected to run. It is not a claim of full product acceptance.
`skipped` and `reported` never satisfy a required gate. The report separately includes the source
version, fixture version, authorized prompt count and observed Send activations.

## Offline and local commands

```sh
# No account or network operations.
bun scripts/acceptance.ts > /tmp/chatgpt-ui-offline.json

# Explicitly start a disposable source daemon; still no account or external network.
bun scripts/acceptance.ts --local-startup > /tmp/chatgpt-local-startup.json

# Optional installed executable / catalog compatibility, with isolated temporary state.
bun scripts/acceptance.ts --local-codex /absolute/path/to/codex > /tmp/chatgpt-codex-catalog.json

# Declare release gates without authorizing them to run. Exit 1 is expected until verified.
bun scripts/acceptance.ts --require live-codex --require live-mcp > /tmp/chatgpt-required-gates.json
```

The local-startup check reuses `startServer()` with a synthetic adapter and temporary homes.
The optional catalog check reuses `scripts/smoke-codex-catalog.ts`. Both subprocesses have a
20-second deadline and a 64 KiB output cap. Their raw output is not copied into the report.
Temporary state is removed on completion or failure.

## Explicit account checks

These commands require an already authenticated, configured **automatic** launcher session.
They do not log in, switch interaction modes, save settings, install a connector or alter Codex
configuration. Account verification is deliberately absent from the default command.

```sh
# Inspect the current owned account surface, with zero prompts.
bun scripts/acceptance.ts --live-session > /tmp/chatgpt-session-acceptance.json

# Send exactly one fixed, tool-free prompt after capability inspection.
bun scripts/acceptance.ts --live-prompt --prompt-count 1 --model high \
  > /tmp/chatgpt-one-prompt-acceptance.json
```

The only prompt is `Reply with exactly: CODEX WEB GPT READY`. The exact response marker is checked
in memory; response text is not exported. `--model` accepts `high`, `extra-high` or `pro` and
defaults to `high`. An unavailable effort fails before send. An explicit configured Pro version
pin remains authoritative. There is no model fallback, prompt attachment, arbitrary input,
subagent creation or automatic prompt retry. A second Send activation is rejected by the runner's
one-prompt guard. `--timeout-ms` accepts 1000–300000, defaulting to 120000.

The report retains no credentials, session JSON, raw DOM, prompts, tool output, private paths or
provider error messages. The live prompt disables screenshots even if the process inherited the
browser-diagnostics screenshot flag. Structural turn diagnostics use a temporary directory that
is removed during cleanup. A failing check gives a fixed failure description; consult the
launcher's **Activity → Export safe log** and doctor separately for further scoped investigation.

The live prompt uses the configured launcher/helper. A source report version alone does not prove
that an installed app contains the same source changes; verify package/runtime identity separately
using the [release validation process](release-validation.md).

## Codex and MCP gates

A successful browser marker does not prove that Codex received a response, that a tool call reached
the exact configured MCP connector, or that a native task completed. Likewise, connector selection,
doctor readiness and a catalog pass are not invocation evidence. After login and connector setup,
run a separate authorized, narrowly scoped installed task and correlate its native result with the
owned connector invocation. Preserve cancellation and compaction as separate tests when required.

If a human has performed those checks, the report can carry that information without upgrading it
to direct evidence:

```sh
bun scripts/acceptance.ts --require live-codex --require live-mcp \
  --reported-codex passed --reported-mcp passed > /tmp/chatgpt-reported-acceptance.json
```

Both levels remain `reported`, `independentlyVerified: false`; the required gate still exits 1.
The existing broad live subagent smoke is intentionally not invoked by this runner. No full task
histories or raw rollout logs are imported as an acceptance shortcut.

## Fixture maintenance and validation

The fixture dataset and provenance live under `tests/fixtures/chatgpt-ui/`. New sanitized fixture
versions should use minimal structural metadata and synthetic text. Keep author-reported samples
distinct from synthetic cases; never paste raw issue attachments, account DOM or session exports.
Unknown fixture versions and unexpected fields are rejected. Selector contract checks identify
source drift; they do not prove that today's remote DOM still exposes those selectors.

Focused regression command:

```sh
bun test tests/acceptance.test.ts tests/acceptance-ui-fixtures.test.ts
```

Exit codes: `0` means every required scope was directly verified, `1` means a required scope failed
or remains skipped/reported, and `2` means invalid arguments. Invalid or incomplete prompt consent
performs no checks. Account flows in the test suite use injected operations; the suite does not
run live-account acceptance.
