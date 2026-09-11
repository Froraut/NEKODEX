# Existing Codex JSON hooks compatibility

This fork incorporates the reviewed cumulative patch from
[upstream PR #435](https://github.com/miuuyy/codex-chatgpt-web/pull/435), authored by
**Aaron Olin ([@aolin480](https://github.com/aolin480))**. The original implementation and
regression tests are credited to that contributor; the fork's integration and independent
validation do not replace that attribution.

Source commits:

- [`7da106b20bb0dba9d85d06eae27984407778840b`](https://github.com/miuuyy/codex-chatgpt-web/commit/7da106b20bb0dba9d85d06eae27984407778840b)
  — prefer existing Codex `hooks.json` for Interrupt hooks.
- [`2ed03f60f4785e0624b907b726a6404a28cf061b`](https://github.com/miuuyy/codex-chatgpt-web/commit/2ed03f60f4785e0624b907b726a6404a28cf061b)
  — retain native JSON hook trust state. This was the reviewed PR head on 2026-09-11.

## Behavior and ownership

When the selected Codex home already contains `hooks.json`, setup installs the bridge's Interrupt
hook there and records its exact entry plus the corresponding TOML trust state in a version 11
integration journal. Without a JSON file, setup retains the existing TOML storage path.

The change preserves existing user hooks and symlinks, migrates bridge-owned version 10 TOML hooks
when appropriate, and restores only owned entries on disconnect or uninstall. Recovery covers
interruption between journal intent, TOML writes, JSON writes, and the committed journal.
Modified hook entries or ambiguous trust state cause an explicit refusal rather than being
overwritten. Launcher rollback checkpoints now include the JSON hook file and its symlink target.

This resolves Codex's mixed hook-source warning when JSON hooks are already configured. The
independent reproduction confirmed that the warning itself did not stop hook discovery: Codex
still discovered both the JSON and TOML definitions. This is a compatibility improvement, not
evidence that every reported installation failure had the same cause.

## Independent validation

The exact 13-file cumulative patch applied cleanly to the fork after review. The same source was
first exercised in an isolated copy, then verified again in the fork working tree. Validation
used Bun 1.4.0 and Codex CLI 0.153.4 on macOS arm64.

- `bun test tests/codex-interrupt-hook-json.test.ts tests/codex-interrupt-hook.test.ts tests/codex-integration.test.ts`
  — 72 passed, 0 failed, 464 assertions.
- `node --test --test-name-pattern='failed first-time setup removes' launcher/tests/runtime-host.test.cjs`
  — 1 passed, 0 failed; verifies JSON/symlink restoration on setup rollback.
- `bun run typecheck` — passed.
- `bun run scripts/smoke-codex-hooks-json.ts <codex-executable>`
  — `NATIVE_CODEX_HOOKS_JSON_DISCOVERY_SMOKE_OK`; verifies discovery, trust, symlinks, native TOML
  writer edits, changed-command trust invalidation, malformed JSON, and mixed-source warnings.
- `bun run scripts/smoke-codex-interrupt.ts <codex-executable>`
  — `NATIVE_CODEX_INTERRUPT_LIFECYCLE_SMOKE_OK`; verifies the JSON-backed hook through real Codex
  interruption against a local fixture server.
- Scoped `git diff --check` — passed.

The native smoke tests used disposable Codex homes. They did not change the user's live Codex
settings or authenticate to ChatGPT. Native Windows/Linux packaging, real account login, and
installed Full harness acceptance remain separate release checks.
