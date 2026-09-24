# v6 saved-chat preference lane

Added an opt-in `useSavedChats` preference, default `false`, independent of `experimentalFreshConversationPerTurn`. Missing legacy runtime values resolve to Temporary Chat; non-boolean values are rejected. Launcher state persists the preference and Settings exposes “Save chats in ChatGPT”. Its notice says that chats are stored in ChatGPT history and that ChatGPT may apply saved memory and custom instructions. The switch stays off by default and is available in Manual mode.

## Changed files

- `src/config.ts` — typed, defaulted, validated, and serialized `useSavedChats`; included it in provider config.
- `src/dev-chat/cli.ts`, `src/dev-chat/session.ts`, `src/dev-chat/driver.ts` — DEV setup accepts `--saved-chats` / `--temporary-chats` and persists the selected preference; the DEV adapter passes `config.useSavedChats` to its provider. The session list preserves all prior entries and adds only the five named model routes: `chatgpt-web/gpt-5.6-luna`, `chatgpt-web/gpt-5.6-sol-instant`, `chatgpt-web/gpt-5.6-sol`, `chatgpt-web/gpt-5.6-pro`, and `chatgpt-web/gpt-6-pro`. Named Luna also follows the existing Luna-specific DEV context behavior. Saved-chat policy does not change model identity or per-chat model selection.
- `launcher/electron/state.cjs`, `runtime-config-contract.cjs`, `preload.cjs` — boolean state default/persistence, compatible missing-value handling, and `setUseSavedChats` IPC surface.
- `launcher/src/types.ts`, `SettingsSurface.tsx`, and all six `i18n-*.json` dictionaries — renderer state/API types, the switch, and localized labels/notices. Dictionaries remain loaded through the existing locale catalog.
- Focused fixture/test updates: `tests/dev-chat.test.ts`, `tests/setup-policy-focused.test.ts`, `tests/backend-review-regressions.test.ts`, `tests/browser-helper-protocol-cleanup.test.ts`, `tests/launcher-helper-client.test.ts`, and new `launcher/tests/saved-chats-preference.test.cjs`.
- `ARCHITECTURE.md` and `docs/development/extending-nekodex.md` — documented preference ownership, defaults, and DEV route boundary as required by repo `AGENTS.md`.

## Integration contract for parent and adjacent lanes

- Parent-owned `src/types.ts` currently defines `CodexProviderConfig.chatgptWeb.useSavedChats?: boolean`. Preserve it as optional for older callers; the browser resolver should interpret only `true` as enabled.
- Browser lane keeps `ResolvedBrowserConfig.useSavedChats` optional and resolves only explicit `true` as enabled, preserving older callers. I also updated the directly affected helper-client fixture literals in the three reported files with `useSavedChats: false`, including each affected constructor/config literal in `tests/launcher-helper-client.test.ts`.
- The renderer exposes `setUseSavedChats(enabled)` through preload channel `launcher:use-saved-chats`. Parent integration registers that channel, validates the boolean, persists `config.useSavedChats`, and returns the matching launcher-state receipt. One lifecycle owner closes turn admission during the change; an owned recovery blocker survives unrelated reopen calls after a committed-policy projection failure. The state field is `useSavedChats`.
- The DEV setup flags reuse the real setup spellings `--saved-chats` and `--temporary-chats`; they set `SetupOptions.useSavedChats` and do not alter model selection. The five explicit model slugs are only route identities in `DEV_CHAT_MODELS` and resolve through `requireChatGptWebModelRoute` under matching account/mode capabilities.

## Focused evidence and limits

- `node --test launcher/tests/saved-chats-preference.test.cjs`: 2 passed. Covers default-off state, persisted boolean round-trip, invalid-state fallback, legacy runtime omission, and runtime rejection of non-booleans.
- `bun test tests/dev-chat.test.ts --test-name-pattern 'every advertised DEV model resolves|browser-only DEV driver runs real turns|Bigger Context triples the DEV compaction window'`: 3 passed. The route regression resolves every advertised `DEV_CHAT_MODELS` entry through `requireChatGptWebModelRoute`, using Manual for Zero Risk, Luna-only capabilities for Luna routes, Sol capabilities for standard routes, and Pro plus Extra High for Pro routes. The browser-only DEV turn check confirms `useSavedChats` reaches the adapter provider; the existing Luna-specific context regression now covers the named Luna route too.
- `bun test tests/setup-policy-focused.test.ts --test-name-pattern 'saved chats opt in explicitly'`: 1 passed. Confirms the saved/temporary setup candidate and resulting provider configuration.
- One-off static locale check confirmed non-empty saved-chat labels and notices in all six dictionaries. Manual copy review confirmed the history and memory/custom-instructions notice; no exact English-copy assertion remains in the suite.
- `bun test tests/dev-chat.test.ts --test-name-pattern 'new DEV chats default to the cheapest account-supported browser model'`: 1 passed, 12 filtered. Confirms default model behavior remains and the new session slugs are listed.
- No renderer suite or root typecheck was run; parent owns final typecheck and UI verification. No source commit/push, release, app restart, or live-account test was performed.
