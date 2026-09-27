# Enhanced fork follow-up and desktop recovery

Reviewed Evanlau1798/codex-chatgpt-web main
`fa514a4630e322c9dd50ac2345956b2b64918821`, changes since the previous
`108cd5f1` checkpoint, and PR #62 through
`0f54c8f2922f99d9d5b1da6ea3fc774c87930e5e` (updated during this review).
The local source base was NEKODEX `bd74f1c3`, draft PR #39, building on
`1d7d2abc` main. This extends the [upstream 6.1.1 review](2026-09-27-upstream-6.1.1.md).

The final paginated REST inventory contained 62 issue/PR records, 48 PR records,
63 issue comments and eight inline review comments. At that snapshot there were
12 open issues and one open PR. Enumeration covers the repository; the content
review covered open issues, new/changed records since the earlier checkpoint,
PRs #45–57 and #62, and relevant implementation deltas. Older unchanged closed
records were not relabeled as newly reviewed. Exact fingerprints and inherited
decisions are retained in `evan-review-state.json`.

## Implemented adaptations

| Source / issue | Result in NEKODEX |
| --- | --- |
| [PR #62](https://github.com/Evanlau1798/codex-chatgpt-web/pull/62), [#61](https://github.com/Evanlau1798/codex-chatgpt-web/issues/61) | Family-specific available efforts persist through config, login, helper, setup, catalog and account admission. A limited Latest Pro option does not hide GPT-5.6 Pro. GPT-6 Astra/Instant require observed availability. The picker restores the selected family/effort/draft and handles family rows that unmount when the effort view is shown; the latter was reproduced in the local live browser. |
| PR #62 follow-up `a6333434` | French Stop, Temporary Chat onboarding, personalization, Think, trace controls, relevant alerts and exact one-time tool confirmation were adapted to the fork's split browser modules. Persistent approval remains excluded. This is French ChatGPT-page compatibility; Evan's different launcher/Pro-Limits dictionaries were not copied over this fork's screens. |
| [#59](https://github.com/Evanlau1798/codex-chatgpt-web/issues/59), `a6f9656f` | Optional Web-only Codex provider, with a static Web catalog and no Native authentication requirement. The default mixed mode remains. Reconnect, repair and uninstall use the existing v11 transaction/ownership journal, including restoration of the prior Native selection and preservation of user edits. Actual ChatGPT limits remain. |
| [PR #53](https://github.com/Evanlau1798/codex-chatgpt-web/pull/53), [#54](https://github.com/Evanlau1798/codex-chatgpt-web/pull/54), #55; `836dfc96`, `56d89bad` | Local Chat Completions and Messages routes, private revocable API access, bounded streaming and validated function transcripts. Requests use the existing browser/account pool. The independent key is hot-read and cannot access Native or admin routes. Tool results retain the originating transcript and call identity. |
| Enhanced Claude gateway and setup | Claude Code Messages/model discovery/token estimation, image/tool history and reversible client settings. Shared external-client context provides an inert read-only environment; Claude executes its own tools under its own permissions. No forged Native environment, admin token, or Anthropic thinking signature. |
| `f38ffa37` embedded controls | ChatGPT content explicitly uses `-webkit-app-region: no-drag`, keeping embedded buttons interactive. |
| User screenshots: timed-out sign-in and stuck import UI | Preserve actionable Chrome error codes and phase/deadline feedback, show the owned verification page, remove a redundant blocking error modal, and return/publish the final snapshot after releasing the login lease. Captures attach to the exact app-owned profile-claim target instead of guessing the default browser context. The observed Chrome user agent is validated, transferred, restored on rollback and optionally stored with the verified binding. It is compatibility metadata, not identity proof. |
| User screenshots: renderer exit and restart refusal | Recreate the trusted Electron shell and reparent existing browser views without restarting their processes or sessions. A failed attempt rolls back; recovery is bounded. Explicit restart drains idle runtime ownership instead of requiring a healthy background Native network route. Renderer exit reason/code are logged. |

## Decisions that preserve the fork's existing owners

- **Composer series #45–52 and #33/#42/#43:** Evan's guarded/chunked writer and
  candidate promotion stack differ from NEKODEX's atomic native text insertion,
  exact full readback, stage budgets and physical settlement. No LF swallowing,
  relaxed comparison, larger timeout or wholesale writer replacement was added.
  The newer `fa465628` multiline text direction is consistent with the local
  native text path. The reporter's original Linux Lexical failure was not replayed.
- **#44 / #50 recovery:** NEKODEX already rebinds the owned surface with bounded
  attempts and retains accepted submission/tool ownership. The screenshot's
  launcher-shell failure is a separate native window lifecycle and was fixed
  there. A request timeout is not evidence that its renderer crashed.
- **#58 / `869305f9`, `0928f29e`, `1e6b42eb`, `f38ffa37`:** Enhanced has a separate
  retained Native2 output tunnel. NEKODEX reads the bound current answer, all
  answer roots and the full HTML/text signature, and uses completion fences.
  Its pre-dispatch tool boundary already operates during submission recovery.
  The Enhanced tunnel's old-action conflict and missing-final fast path were
  not imported into an absent transport. The live smoke confirms one complete
  ordinary reply, not the reporter's long retained-tool scenario.
- **#38 / `4203aad2`:** do not import No Context Window or advertise unlimited
  context. NEKODEX has its own bounded compaction/checkpoint/Bigger Context
  owners. The new peer checkpoint repairs an Enhanced-specific recovery gap;
  it cannot retroactively make oversized or uncertain tool history safe.
- **PR #62 `b019e9a6` and `0f54c8f2`:** NEKODEX already normalizes exact canonical
  `codex_app.send_message_to_thread` deliveries via `native-delegation.ts` and
  records both source and retained-user compaction representations in
  `server.ts`. Its rollout/environment resolver differs from the peer's
  `CurrentTurnAnchor` path. No second authority mechanism was imported.
  `37a95b35` concerns the absent Enhanced output tunnel; ordinary local progress
  tracking remains bounded.
- **#60:** the attached diagnostic file was inspected. It contains Native HTTP
  401 responses, Web attachment failures and a Luna empty-answer failure, rather
  than one demonstrated model-installation defect. Independent Claude setup
  avoids requiring Codex configuration, but these provider/account failures
  are not claimed resolved by installing the new mode.
- **#36:** Claude setup is an explicit separate command/UI action. Ordinary
  Codex setup does not install it. **#40** profile isolation, sticky ownership
  and per-account routing already exist. **#41** public plugin ABI remains an
  architectural proposal without a compatible implementation to port.
- **#56/#57:** upstream v6 runtime behavior was already assessed in the local
  6.0/6.1/6.1.1 reviews. Enhanced packaging/version/updater policy was not
  substituted for NEKODEX's signed update ownership. Historical inline comments
  on installer cleanup, startup ordering and candidate-helper identity are
  review context, not new platform certification. Windows/Linux packaging and
  incident reproductions were not run in this macOS change.

All imported/adapted source is from the MIT-licensed contributor tree, whose
copyright and permission notice is retained in the root `LICENSE`.

## Verification

- Root/launcher typechecking and the renderer build passed. The build emitted
  its existing-size advisory for a main chunk slightly over 500 kB; it completed.
- Six model/capability checks passed (42 assertions), including an isolated real
  headless Chrome fixture with lazy menu unmounting and draft restoration.
- Seven API/Claude checks passed (59 assertions): route/key/origin isolation,
  Messages token/model routes, cancellation settlement, reversible settings,
  image/tool-error translation, invalid tool output and exact call receipts.
- Four login settlement/binding/access checks passed (25 assertions). The exact
  Chrome claim-target capture check separately passed (five assertions).
- Installed macOS validation exposed a separate `EPERM` while reading Chrome's
  profile-list metadata, despite DEV access succeeding. The chooser now uses
  the native open-file panel for the exact `Local State` file. A focused check
  verifies selection identity, cancellation and rejection of a different file.
  The installed app then reached the correct profile picker, exposing the next
  protected read at `DevToolsActivePort`. Profile-first import now uses the
  existing exact-file native chooser on that specific denial, retries once with
  the same profile claim through the private helper channel, and honors account
  cancellation. Cookie access still requires the Chrome session's own consent.
- The Chrome profile picker uses the display's available height (up to 900 px),
  shorter guidance, two-line rows and fixed footer actions. Manual source Electron
  checks showed all seven fixture profiles without scrolling on the large display;
  at the minimum 440 x 430 window the list scrolls while search and actions remain
  visible. Filtering, selection and Continue were exercised in Russian.
  Recoverable helper failures no longer create a stale global error banner;
  the sign-in guide still reports final import errors.
- An isolated real Electron shell crash preserved the existing browser PID,
  session, view and draft when attached to a replacement shell.
- Official Claude Code 2.1.283 completed a streaming reply and actual Read tool
  cycle through the production gateway with an inert adapter: three requests.
  Codex CLI 0.157.1 loaded the Web-only catalog and completed one request through
  the production handler without a Native credential. Both used disposable homes.
- The built Russian client-settings UI was manually exercised with synthetic
  IPC: API enable/copy/rotate, Claude connection/stale-key guidance and Web-only
  selection/save/restart guidance. No real client settings were changed by it.
- A separate real RuntimeHost-to-CLI check passed seven assertions for private
  client status/activation/key receipts. It caught and fixed an IPC reader that
  incorrectly expected retained stdout even though private output is discarded;
  the key is now consumed in one bounded main-process receipt and stays out of logs.
- On the actual signed-in DEV profile, browser smoke returned exactly
  `CODEX WEB GPT READY` at 2026-09-27T11:04:37Z. The saved session survived a
  controlled restart; an initial Cloudflare interstitial resolved without a
  CAPTCHA action. Successful import preceded some diagnostic refinements, so
  the Chrome user agent is not claimed to be the sole cause of recovery.
- The later French-control fixture passed with eight assertions: active
  generation, exact app names, one-time versus persistent permission, onboarding,
  rate limit, expired session and suspicious-activity stop behavior.

Full repository/lifecycle suites were not run. Peer test counts and peer CI
claims are not local evidence. No exhausted Native desktop account was available
for a quota-gated GUI reproduction. No public release/tag/installer publication
is part of this change. Local signed-app replacement is a separate handoff from
source/PR publication; its actual outcome is reported after installation.
