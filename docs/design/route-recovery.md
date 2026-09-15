# NEKODEX route recovery and interaction options

The user explicitly requested replacing the disabled former route with NEKODEX,
then invited investigation of better Codex-to-ChatGPT-Web interaction.

## Changes

- Fixed missing stage cancellation arguments in initial model selection,
  multipart final model selection and connector-catalog recovery.
- Removed rich HTML insertion for large prompts. ChatGPT's editor normalized the
  fragment while preserving character count; complete prompt comparison detected
  the corruption. Literal text insertion retains the exact-readback requirement.
- Installed the verified runtime in `/Applications/NEKODEX.app`.
- Used the supported `setup --full --replace-codex-route --restart-service`
  workflow with the existing account and connector. Fresh private configuration,
  integration-journal and launcher-state backups were made before the change.
- The active shared route is `http://127.0.0.1:17841/v1`. Native model requests
  retain their native API forwarding path; only Web model slugs use the browser.

## Concrete evidence

An ephemeral, read-only native Codex CLI task sent “Reply with exactly NEKODEX
READY. Do not use tools.” through the local route. After the two targeted fixes,
its completed response was **NEKODEX READY**, in **13.39 seconds**. This is one
small request, not a capacity or general speed claim. Earlier failed checks were
not treated as successful responses.

After supported route replacement, the installed app owned the runtime process,
`/healthz` reported `ok`, version `5.1.0-froraut.18`, full mode and accepting
turns. A fresh Codex `model/list` returned 10 entries including Web Light, Medium,
High, Extra High and Pro. Other Web modes and live MCP tool execution were not
part of this bounded response check.

## Interaction options

The unified route retains the mixed native/Web model catalog in Codex. Its
tradeoff is that the local app must remain running even for native requests
passing through that route.

A separate opt-in profile gives explicit Web-model selection and matching
metadata without changing the default selected model. The current official
[Codex advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)
uses separate `<name>.config.toml` profile files and supports per-run overrides.

Installed locally:

- `~/.codex/nekodex.config.toml`
- `~/.codex/nekodex-models.json`

Start with `codex --profile nekodex`. Regenerate after changing available modes
or context settings using `bun run scripts/install-nekodex-profile.ts`.
The profile installer backs up its previous generated files and never changes
`config.toml` or the default selected model. This profile is optional; it does
not remove the shared-route dependency while the unified route remains active.
A fully profile-only default would trade away the mixed desktop catalog and is
not silently substituted for the user's requested unified setup.

## Operational boundaries

The already-open Codex UI may need reopening to refresh its model picker. The
current task's Codex process was preserved. ChatGPT account data was retained.
This remains a locally signed NEKODEX build, not a notarized public release.
