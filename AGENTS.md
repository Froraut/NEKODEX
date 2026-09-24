# NEKODEX architecture maintenance

For feature work, refactoring, file moves, protocol or persistence changes, read
[ARCHITECTURE.md](ARCHITECTURE.md) and the relevant rows in
[the extension guide](docs/development/extending-nekodex.md). Apply the
`nekodex-architecture` skill when installed. This repository instruction remains
the fallback on hosts without that skill.

Before finishing an architectural change:

1. Keep one owner for each live resource and durable transaction. Give leaf
   modules explicit dependencies; preserve needed public facades.
2. Update the affected architecture sections and extension-guide rows in the
   same source change. Include changed entry points, dependency direction,
   state ownership, persistence/IPC contracts and the relevant verification path.
3. Run `bun run architecture:update` after adding/removing/moving modules or
   changing runtime imports. Review the generated map and run
   `bun run architecture:check`. Ordinary implementation edits with unchanged
   architecture do not require invented documentation changes.
4. If these maintenance rules change, update the installed skill when available
   and preserve it through the user's skill-preservation workflow. Do not copy a
   full architecture snapshot into the skill: this checkout is authoritative.

Use focused behavioral verification under the user's proportionate-testing
policy. `bun run verify` is a broad release-oriented command, not a default
refactoring check. Source commits and PRs do not authorize or prove an installed
application or release. Preserve unrelated work and use exact task paths for Git.
