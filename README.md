<div align="center">
  <img src="launcher/assets/icon.png" alt="NEKODEX cat icon" width="112" />
  <h1>NEKODEX</h1>
  <p><strong>Your ChatGPT accounts. Your coding workspace.</strong></p>
  <p>A standalone NEKODEX workspace for accounts, coding tasks and local tools.</p>
  <p>
    <a href="https://github.com/Froraut/NEKODEX/releases/tag/v5.2.0-nekodex.1">Download for macOS</a> ·
    <a href="docs/architecture.md">Architecture</a> ·
    <a href="TROUBLESHOOTING.md">Troubleshooting</a> ·
    <a href="SECURITY.md">Security</a>
  </p>
</div>

NEKODEX brings account management, browser sessions, model setup, MCP tools and runtime activity
into one desktop app. Its graphite-and-lavender interface and animated coding cat are part of its
own identity. NEKODEX preserves compatible account/profile storage and the original MIT attribution
from its upstream open-source base.

Maintained by **FroRaut**, based on [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web).
The repository is now **Froraut/NEKODEX**; the previous GitHub URL redirects here.

## Download and install

**Current NEKODEX release: 5.2.0-nekodex.1 — macOS prerelease.**

| Mac | Installer |
| --- | --- |
| Apple Silicon — M1 and later | [NEKODEX DMG · arm64](https://github.com/Froraut/NEKODEX/releases/download/v5.2.0-nekodex.1/NEKODEX-5.2.0-nekodex.1-mac-arm64.dmg) |
| Intel | [NEKODEX DMG · x64](https://github.com/Froraut/NEKODEX/releases/download/v5.2.0-nekodex.1/NEKODEX-5.2.0-nekodex.1-mac-x64.dmg) |

Requires macOS 13 or later. Windows and Linux source support remains in the repository; this release
publishes macOS packages only. See the [release notes](docs/releases/5.2.0-nekodex.1.md) for scope and
verification limits.

1. Download the DMG for your Mac.
2. Quit any older installation before opening NEKODEX.
3. Open the DMG and drag **NEKODEX** into **Applications**.
4. Launch NEKODEX and follow **Continue setup**.

The release pipeline requires Developer ID signing and Apple notarization for the app and the final
DMG, plus a stapled ticket. Release assets include checksums, signed metadata and GitHub build
attestations. The Apple certificate identifies its legal holder; FroRaut is the public maintainer.
See [release authenticity](docs/release-signing.md) for the exact trust boundaries.

### Migrating to NEKODEX

Install this NEKODEX version manually from its DMG. Older updaters can reject the
renamed executable. The bundle identifier and existing storage locations remain compatible so an
existing account session and settings can be reused. Keep the old app closed during the transition;
remove the obsolete app bundle after confirming NEKODEX opens correctly. Do not delete its
Application Support/profile folders as part of removing the old app.

Some ZIP, runtime archive, package, environment-variable, service and profile names remain legacy
compatibility identifiers. They are not the product name; the installed application is **NEKODEX**.

## What is inside

- **Overview:** setup guidance, connection status, configured parallel-task limit and eight recent events.
- **Accounts:** manage ChatGPT profiles and select an account or balance eligible new work across accounts.
  Existing conversations stay attached to their owning account.
- **Browser:** task-bound ChatGPT surfaces inside the app, with retained conversations and explicit lifecycle handling.
- **Setup:** state-aware next steps for connecting models to Codex, with separate repair actions.
- **Codex tools (MCP):** connect the tools of the active Codex task through a turn-bound capability.
- **Activity and settings:** runtime events, model preferences, interaction mode and resource settings.
- **Responsive interface:** larger consistent type, adaptable layouts and scroll areas with room for controls.
- **Coding cat:** varied head, ear, eye, mouth, paw and tail reactions; reduced-motion preferences are respected.

## How the connection works

```text
Codex task
   │ Responses API / streamed events
   ▼
NEKODEX local bridge
   ├── Native model requests ───────────► native Codex backend
   └── Web model requests ──────────────► task-bound ChatGPT browser session
                                                │
                                      MCP connector in Full mode
                                                │
                                                ▼
                                     tools of the same Codex task
```

Codex owns the task, tool execution and its approval policies. NEKODEX routes selected Web-model
requests into ChatGPT and brings visible output and tool activity back to that task. Sequential
turns can reuse the exact retained browser conversation; context compaction establishes a new epoch.
Native requests preserve their upstream route, while known local Web continuation IDs are expanded
before a switch back to a native model.

NEKODEX is an unofficial integration. It does not add subscription allowance, unlock unavailable
models or remove account and workspace policies. ChatGPT processes Web-model prompts remotely.
Temporary Chat is not local-only inference or anonymity.

## Choose an interaction mode

| Mode | Sending to ChatGPT | Local tools |
| --- | --- | --- |
| Automatic, browser-only | NEKODEX prepares and sends through the browser | No MCP harness |
| Automatic, Full | NEKODEX prepares and sends through the browser | Turn-bound Codex tools through the configured connector |
| Manual | You paste, choose the model/effort/connector and send | Turn-bound Codex tools through the Manual connector |

Available model entries depend on the authenticated account and inspected ChatGPT capabilities.
NEKODEX fails explicitly when the requested model or required connector is unavailable.

Manual mode does not read or manipulate the ChatGPT page or press Send. Its routed input is text-only;
images must be attached manually in ChatGPT. The historical `zero-risk` model IDs remain for
compatibility; the UI calls this mode **Manual**.

For Full mode, follow the app's MCP setup guide. The current `.2` source contract uses
**Codex Native4** for Automatic Full, **Codex Native4 DEV** for isolated DEV Full, and
**Codex Zero Risk4** for Manual. The published `.1` binary still uses **Codex Native3**,
**Codex Native3 DEV**, and **Codex Zero Risk2**; use those older names only with that binary.
The outbound tunnel uses [OpenAI tunnel-client](https://github.com/openai/tunnel-client).

When moving to a runtime built from the `.2` source contract:

1. Start that runtime and use **MCP → Connect harness** for each mode you use. Keep Automatic,
   Manual, and DEV tunnels and credentials associated with their own profiles.
2. In ChatGPT settings on the same OpenAI account, enable Developer Mode and create a **new**
   connector for the relevant mode with its exact `.2` name above. Choose the tunnel shown by that
   mode's setup and **Authentication: None**. For Full harness tools, choose **Allow all actions**;
   outer Codex sandbox and approvals still apply.
3. Run **Verify runtime** for Automatic Full. For Manual, select **Codex Zero Risk4** in ChatGPT
   before pasting and sending the prepared prompt. DEV Full uses **Codex Native4 DEV** and its
   isolated tunnel.

ChatGPT caches the public tool schema under the connector name. Leave older connectors unchanged;
renaming or refreshing one does not load the new contract. Local setup and connector visibility
alone do not prove a live tool call. See [troubleshooting](TROUBLESHOOTING.md#full-harness-or-mcp-verification-fails)
for account and runtime checks.

Tool access remains tied to the originating Codex turn. A cancelled or timed-out MCP invocation
retires that turn's binding, including sibling calls, so abandoned responses cannot keep invoking
local tools. Changing this contract requires safe handling of late native results.

## Reliability and resource use

The NEKODEX backend review led to fixes for helper startup/shutdown, account affinity, local/native
continuation, checkpoint loading, interrupted integration removal and setup rollback. It also added
bounds for non-streaming event accumulation, admin request bodies, completed MCP activity records
and emergency logs.

- The default parallel-task ceiling is **16**, configurable in Settings. This is an admission limit,
  not a measured promise of sixteen sustained browser/model sessions or increased account quota.
- Retained surfaces remain owned until physical helper cleanup completes. Expired logical state
  cannot silently release a still-owned browser.
- Unsupported inline file payloads fail explicitly instead of becoming empty placeholders.
- A failed final route commit attempts to restore the prior setup-owned configuration and services,
  preserving detected concurrent edits and reporting incomplete compensation.
- Managed Chrome login attempts use separate temporary profiles and filter persisted browser state.
- Experimental larger-context operation remains experimental; long-running compaction and model
  availability depend on the external service.

The [backend fix report](docs/reviews/2026-09-15-sol-backend-fixes.md) records each finding,
its disposition and the focused verification performed. It does not claim exhaustive testing,
all-model acceptance or a full Windows runtime validation.

## Repository-name transition for updates

Source development is now **5.2.0-nekodex.2**. This is not yet a published binary release;
the download links above continue to point to the immutable signed `.1` release.
Future `.2` builds bind their updater and signed metadata to **Froraut/NEKODEX**. The published
`.1` build still pins the old repository identity, so its transition requires manually installing
a new signed DMG when that release is available. Renaming a GitHub repository does not rewrite
an existing binary's trust policy. Do not replace `.1` assets or disable signature checks.

Installer scripts in the current source select the newest published release, including prereleases.
Set `CODEX_WEB_GPT_VERSION` to choose an exact version. Only install assets actually provided for
your platform; the currently published release is macOS-only.

## Build from source

Development requires Bun 1.4.0. Use a native build host for the platform you are packaging.

```bash
git clone https://github.com/Froraut/NEKODEX.git nekodex
cd nekodex
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd launcher
bun run dev:launcher
```

The DEV launcher uses isolated configuration, browser storage and runtime paths. It does not
replace the installed app or reuse its authenticated profile. See [DEV isolation](docs/dev-chat.md).

Select the smallest relevant regression checks for a change. The CI workflow runs mapped named
cases once on Linux and identifies paths requiring manual review. Full verification and packaging
are available through an explicit manual CI run. The release pipeline reuses recorded development
evidence and enforces native signatures, notarization and artifact integrity before publication.

For an optional separate Codex profile, inspect and run `scripts/install-nekodex-profile.ts` after
setting up the local bridge. It writes the NEKODEX profile and model catalog under your Codex home;
launch it with `codex --profile nekodex`.

## Documentation

- [Architecture and lifecycle](docs/architecture.md)
- [NEKODEX design and compatibility](docs/design/nekodex.md)
- [Troubleshooting and setup walkthroughs](TROUBLESHOOTING.md)
- [MCP connector migration](docs/mcp-task-access-migration.md)
- [Transactional updates](docs/transactional-updates.md)
- [Release signing and provenance](docs/release-signing.md)
- [Security model](docs/security-model.md) and [reporting a vulnerability](SECURITY.md)
- [Development chat harness](docs/dev-chat.md)
- [Latest release notes](docs/releases/5.2.0-nekodex.1.md)

The older [Chinese](README.zh-CN.md) and [Japanese](README.ja.md) guides retain upstream context;
they have not yet been fully rewritten for the NEKODEX interface. Use this README for current
branding, macOS installation and release status.

## License and credits

NEKODEX is maintained by **FroRaut** and preserves upstream attribution for the open-source base.
Original authorship and the [MIT license](LICENSE) are preserved. Bundled components retain their
own licenses; each release includes third-party notices and the applicable runtime licenses.
NEKODEX is not affiliated with or endorsed by OpenAI.
