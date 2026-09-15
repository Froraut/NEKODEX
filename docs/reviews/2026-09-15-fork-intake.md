# Focused fork intake: editor compatibility and bridge reliability

Scope: selected foreign-fork commits and the complete local adaptation diff,
not a security certification of either entire fork. No fork install script,
binary or dependency tree was executed or installed. The existing dependency
manifests and lockfiles remain unchanged.

## Implemented in this branch

1. **Composer discovery independent of an English label.** Inspired by
   [minhquangrio eff2e61d10](https://github.com/minhquangrio/codex-chatgpt-web/commit/eff2e61d10656052a0a3387adfe3daa092f1985c).
   Both login inspection paths use the shared visible composer selector. Its
   new ProseMirror fallback is restricted to a form with ChatGPT's send button.
   The fork's generic match for every contenteditable textbox was not adopted.
   Existing URL/authentication checks and the worker's unique-visible-composer
   requirement remain in force.
2. **Escaped fragments for large multiline prompts.** Inspired by
   [Enhanced e51d7252d5](https://github.com/Evanlau1798/codex-chatgpt-web/commit/e51d7252d530b9fd15d97208cedbe1a7f1c31383).
   The fork's block-div implementation added an unwanted final newline with
   our connector paragraph/readback. The adaptation uses one inline pre-wrapped
   span containing only escaped text. Ampersands and angle brackets are escaped
   before insertion; source HTML is never interpolated as markup. The caret
   must remain inside the resolved composer. Inputs below 16,384 characters,
   single-line inputs, CR/NUL and trailing-newline inputs keep the existing path.
   Full prompt readback remains required before submission; no permissive
   comparison or send fallback was introduced.

## Security review and exclusions

The changed production files are chatgpt-session.ts, browser-login.ts and
browser-worker.ts. Their direct callers and prompt readback were reviewed.
No new remote endpoint, credential/profile read, command execution, package,
install hook or privilege change is introduced by these adaptations. The HTML
fragment's sole markup and style are constant; user text is escaped. A synthetic
script tag stays text in the browser check.

The reviewed Windows config-repair code from minhquangrio also switches
browserHost from launcher to managed-chrome. That is a material routing change,
so the repair script was not transferred. The commit includes an unrelated
novel-site implementation plan; this is unrelated repository content, not
evidence of malware, and was not imported.

[Enhanced 8407aacb2e](https://github.com/Evanlau1798/codex-chatgpt-web/commit/8407aacb2e128061794030ed42e7a048c407011f)
changes current-turn anchors and classification of trusted environment/context.
Its supporting module layout differs substantially from this fork. It was
reviewed as a candidate but not transferred without a demonstrated local failure
and a separately scoped authority-boundary review.

[Council's registry](https://github.com/Nolane-x/codexweb/commit/02061a5e0bb6d77439095a942e972885b6ed8005)
and its [execution-control release notes](https://github.com/Nolane-x/codexweb/commit/987703eecc47091a763a5149590a33731c856dcd)
describe a different persistent-agent/control-plane architecture. Stable IDs,
ownership, lifecycle state and receipts are useful concepts, but importing that
subsystem would duplicate existing turn/session authorities. No Council code was
copied. Review of selected fragments does not establish the absence of malicious
code elsewhere in any fork.

## Focused development evidence

Tests ran against an isolated headless Chrome contenteditable fixture with
network requests blocked and no account/profile loaded:

- A localized ProseMirror message field is found; a decoy editor outside the
  send form is excluded.
- Exact multiline text, literal script-like markup and a connector pill are
  preserved. No script node is created.
- CR/NUL keeps the existing text insertion command.

The first large fixture exceeded the five-second case deadline on the old
insertion path. A smaller representative fixture revealed the block-div newline
incompatibility. Only affected cases were repeated after corrections; already
passed selector and control-character checks were not rerun. The final inline
fragment case passed with 18,984 input characters: old insertion 287.3 ms,
adaptation 3.2 ms, one before/after sample. Total automated checks stayed well
within the standing fast-only budget. These are fixture timings, not an
end-to-end ChatGPT speedup or a live ProseMirror/Lexical application certification.

The working installed app and published v5.1.0-froraut.18 are unchanged. This
branch is the next development change; it has not been packaged, signed or
installed. Live-account integration remains a separate pre-release boundary.


## Additional reliability adaptations

- [hpete28 b07bd626](https://github.com/hpete28/codex-chatgpt-web/commit/b07bd626149a026b01f7c1b7e718654b8fbf6458):
  a nonzero tunnel-connect exit may proceed only with structured JSON describing
  a running process and a consistent starting/not-ready or healthy/ready state.
  Conflicting state aliases, malformed output and explicit error values fail
  closed. Existing configured-tunnel readiness, managed process identity, MCP
  transport checks, deadlines and cleanup still decide startup success.
- [marcmy 1ba31283](https://github.com/marcmy/codex-chatgpt-web/commit/1ba31283bf187fd24db14c51fa70df43dc8b1e19):
  current-turn V1 follow-ups are authenticated using our existing native journal
  verifier, extended to validate the child's open spawn edge and session metadata.
  The sender must be its direct parent; call_id is now part of journal equality.
  Verified delivery becomes an agent_message with parent/child identities and
  decoded XML text. An in-process WeakSet plus current metadata binding lets
  environment revision tracking recognize it without trusting a serialized flag.
  Ordinary later instructions supersede the delivery. Historical/compaction
  normalization is intentionally outside this change; root-task behavior remains.
- [aygerix 01dfa61e](https://github.com/aygerix/codex-chatgpt-web-2/commit/01dfa61e2c30c88d821bcc36f7e54213796012ce):
  an independently written slider loop follows observed jumps, checks ARIA range,
  requires 300 ms stability, and stops after 8 seconds or 12 key presses. Operations
  have at most one second and receive cancellation; direction keys still target
  our ancestor menuitem. Rate-limit detection and pre-send model checks remain.
  No external helper, browser-launch changes or response-text changes were copied.

Manual review covered the changed branches, native parser/raw-object handoff,
SQLite/session identity validation, browser callers, cancellation and cleanup.
No new network destination, credential access, dependency, installer or executable
was introduced. Existing native journal reads are reused. Rate-limit dialog hiding
and lowered MCP destructive/open-world hints from aygerix were explicitly excluded.
This does not certify the unexamined code in those forks.

Three additional focused tests passed in 1.18 seconds (no full suite):

1. V1 child fixture with a real temporary SQLite index and native JSONL journal:
   agent role and instruction text preserved; substituted call_id rejected.
2. Nonzero connect response with valid ready JSON reaches the independent probes;
   MCP failure still rejects startup and cleans up without enabling monitoring.
3. Isolated headless Chrome DOM fixture jumps from 0 to 4, then converges to 2
   through menuitem keyboard input and waits for the stability interval.

Final metadata-binding/type/read-timeout refinements were reviewed manually;
passed tests were not repeated. Live ChatGPT UI, account-backed follow-up delivery,
actual ambiguous tunnel-command behavior and packaging of this branch remain
unverified. These changes address reliability; no overall throughput claim is made.


## Final targeted fork pass and configurable capacity

The final read-only pass checked the eight latest commit headers on marcmy/main
and hpete28/main and the production patches for these three remaining candidates:

- [marcmy 8af13dfd](https://github.com/marcmy/codex-chatgpt-web/commit/8af13dfd95f9b1683d81ee1cf2dccb9129b1aa22)
  replaces instruction-ID hashing with a chain of instruction content. This can
  address reconnect ID churn, but changes replay/steering identity and depends
  on retained history shape. Not imported without a locally demonstrated case.
- [hpete28 fd758b8c](https://github.com/hpete28/codex-chatgpt-web/commit/fd758b8c84122b9b1f94e2e074fb9d3f79d7151a)
  permits one further same-page rebind after viewport failure when native work
  remains live. It is bounded and preserves transport close ordering, but adds
  retries inside a caller that already has its own retry accounting. Not imported
  as an automatic improvement to our recovery behavior.
- [hpete28 2573116a](https://github.com/hpete28/codex-chatgpt-web/commit/2573116a2932af9db075d8f3385baff8d38b7990)
  adds compaction detail and copies native tool failure text into diagnostics.
  Useful context, but copying raw tool output into logs needs separate redaction
  treatment. No extra logging or structured-result synthesis was imported.

No external code or new package was executed. This bounded final pass is not an
exhaustive review of every fork or branch. The previously selected five adaptations
remain the implementation set; the three candidates above remain unimplemented.

The user's separate gateway setting is now implemented as Settings → Parallel
agents, accepting integers 1–1000, default 16. The canonical profile-local file is
`browser-capacity.json` with `maxParallelTurns`; writes use a private temporary
file and atomic rename. IPC validates values independently of the renderer.
The launcher captures the limit at boot and passes it to the Electron allocator
and child runtime environment. Backend worker and session registry share the
same startup constant. A standalone backend reads the same profile-local file.
The runtime health response exposes `browser_capacity` for diagnosis.

Saving does not change active limits or interrupt tasks. The UI displays saved
and active values and requests a full quit/reopen when they differ. A daemon
restart within the same launcher lifetime keeps the pinned active capacity.
This implementation does not change account/model usage limits.

Development evidence: launched this source through Electron/Vite on port 4182
with disposable profile `/tmp/codex-web-capacity-settings-20260915`. The occupied
4178 development instance was left alone. In the actual renderer, saved 32 from
the initial 16: UI showed Active 16 / Saved 32 and a restart notice. Fully quit
and reopened the same profile: UI showed Active 32 / Saved 32 with no restart
notice. A direct load of the backend concurrency module under that profile
returned 32. No account login, model request or 32-agent load run was performed.
The private DEV instance and Vite process were stopped afterward.

Manual review covered IPC sender guarding, range validation, shared startup
configuration, both tab allocation modes, subprocess environment inheritance,
renderer state after saving, and package module inclusion. The historical
capacity-16 fixture was adjusted for the new configurable default without
rerunning the earlier suites. No release archive, signing or installation was
performed for this feature; production settings were not changed.


The user subsequently requested a configurable ceiling of 1000. The shared
maximum and all three settings translations now identify this as an unverified
concurrency ceiling. The default remains 16; no saved or active production setting
was raised. The renderer receives the maximum from the same shared setting used
by IPC validation and runtime loading. This small adjustment received manual diff
review; no 1000-session test or new release build was performed.
