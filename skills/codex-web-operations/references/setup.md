# Setup through verified operation

## Installation

Inspect the actual checkout, branch, remote, package version and installed app identity. Use
the fork's existing documented build/install commands; do not run the upstream installer over
the fork. `bun run app` invokes the pinned dependency installs in both root and launcher.
`bun run app:package` builds the native platform package. Build scripts may include typechecks;
account for the user's current verification limits before choosing any command.

Preserve the previous app and private preferences before replacement. Do not reset the account
profile or overwrite unrelated Codex configuration. Check the installed version and package
identity after replacement. Ad-hoc signing, Developer ID signing, notarization and a published
signed release are different results. Do not treat an Apple Development certificate or Xcode
login as Developer ID/notarization evidence.

## Account

Prefer the user's chosen login method. Existing Chrome import uses the signed-in regular Chrome
profile rather than creating an account. Chrome 144+ consent-mode debugging must be enabled by
the user and the connection approved according to current tool rules. Do not assume the old
`/json/version` endpoint works in this mode. The product uses bounded connection discovery and
URL-filtered ChatGPT/OpenAI cookies, then disconnects; operator tools must not inspect the profile.

On the observed macOS 27 path, automatic descriptor access was denied. The installed app can
offer a native file-selection grant for only the expected `DevToolsActivePort`. The selecting
main process reads it and transfers bounded data privately to its helper; a privileged operator
must not copy the descriptor to bypass that denial. Another file or the whole Chrome directory
is not a valid selection.

After import, verify the **embedded** account. Use current local account metadata, not a stale
display name, to resolve multiple profiles. Password/passkey entry or native permission dialogs
may require the user. Cookies present or capture complete is not signed-in evidence.

## Models

These are initial-setup acceptance paths, not a mandatory repeated test sequence. Reuse current
successful evidence after routine packaging changes and respect the user's shared verification
budget. Do not launch a long context workload just to complete this list.

1. Complete login in Setup.
2. Run the single connection test. The observed prompt was `Reply with exactly: CODEX WEB GPT READY`.
3. Install models. Inspect route diagnostics and a real Codex catalog request. Do not repeat
   installation while the already-saved route waits for a catalog refresh.
4. The desktop host may be named Codex or ChatGPT and may retain an app-server after its window
   closes. Explain the actual restart/picker requirement; avoid interrupting active work blindly.
   In versions with an explicit picker confirmation, select it only after observing the actual
   Web entries in Codex. A background catalog request cannot stand in for that observation.
5. A fresh native CLI request with an explicitly selected `chatgpt-web/high` must return a
   recognizable fixed marker. Use an empty/disposable cwd and no private project input.

## Tools (MCP)

1. Create/reuse the OpenAI tunnel in the account matching the embedded ChatGPT account. Associate
   it with the owning Platform organization and target ChatGPT workspace. Creating requires
   Tunnels Read + Manage; runtime use requires Tunnels Read + Use.
2. Use a **regular Restricted API key**, only Tunnels Read + Use. It is not a model API key.
   Choose expiry with the user/task context. Store it only through the private app flow; do not
   print it, paste it into conversation, commit it, or provide the long-lived runtime an Admin key.
3. Enter Tunnel ID/key in the app and Connect harness. Confirm the managed tunnel is both healthy
   and ready before creating the ChatGPT connector. A launch attempt is insufficient.
4. Enable **ChatGPT Settings → Security and login → Developer mode** within current authorization.
   The setting may refresh the page. Check that it persisted before continuing.
5. Open **ChatGPT Plugins directory → Create app (+)**. The installed-plugins list in Settings is
   a different page. Choose Tunnel, the existing running tunnel, Authentication: None and the
   exact current connector identity. Read the discovered tool list.
6. Review permissions and their scope. An account-wide Allow all actions setting affects more
   than one connector; do not silently change it as if it were local to this app. Generic command
   and patch tools remain truthfully mutating. Preserve outer Codex approvals/sandbox.
7. Run Verify runtime. Then use an actual Codex task to read a random marker from a disposable
   file whose contents were not put in the prompt. Correlate native tool result and final answer.
   If edits are part of acceptance, verify a synthetic changed file, not a production document.
8. Verify the app can restart while retaining login and reconnecting the owned runtime. Do not
   call every tier/platform/tool verified because one High request passed.

For current exact account steps, use [official connector documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt)
and the installed `tunnel-client help quickstart` / `help plugin`. Their output is documentation,
not authorization for additional account changes.
