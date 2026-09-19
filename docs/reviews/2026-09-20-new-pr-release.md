# New upstream proposals and release decision — 2026-09-20

Starting source: `a4e22c1` on `codex/upstream-september19-fixes`. The user requested a fresh PR
assessment, implementation of recommended additions, rebuild and publication to Froraut/NEKODEX.
Existing updater working-tree edits are unrelated and remain outside this release.

## Current evidence

Upstream main remains `eaf4f09`; latest published upstream release remains v5.0.8. The open-PR
snapshot contains #589. Recently closed proposals add #584 and #590. Earlier reviewed proposals
#439, #462, #470, #474, #553, #555, #560, #577–583 were closed without merge. Their closure does not
remove the already-adapted NEKODEX work.

- **Recommend #584, adapt:** Russian UI is directly useful here. Upstream supplies its own smaller
  catalog; NEKODEX needs all local account, usage, update, diagnostics and native-dialog strings too.
  The maintainer closed it for roadmap priority, not a demonstrated functional fault.
  https://github.com/miuuyy/codex-chatgpt-web/pull/584
- **Do not recommend #589 as a default production change yet:** the demonstrated tokenizer hot
  path is plausible, but this implementation injects replacement module code through a debugger
  breakpoint. Setup after newCDPSession lacks try/finally cleanup if enable/setBreakpoint fails;
  paused-handler operations have no independent deadline; already initialized documents cannot
  acquire the intended pre-initialization effect. None of its live evidence reproduces NEKODEX's
  current account/multitab lifecycle. No dependency or runtime patch imported.
  https://github.com/miuuyy/codex-chatgpt-web/pull/589 (head `534fbefa`)
- **Do not recommend #590 for this release:** it introduces another CLI/model as a recipient of
  full task history, plus an optional raised compaction threshold whose cold-rebuild path still
  cannot fit the normal composer boundary. Existing explicit Pro-summary model selection remains.
  A future external-compaction feature should define data handling and cancellation policy first;
  the author's isolated success is not a compatibility guarantee for this fork.
  https://github.com/miuuyy/codex-chatgpt-web/pull/590 (head `913f8281`)

## Delivery

Prepare a new immutable `5.4.0-nekodex.1` prerelease with the earlier September 19 fixes and
Russian localization. Keep the existing signed updater channel and publisher identity. Reuse the
nine successful focused tests and Electron observation for unchanged runtime behavior. Verify the
new locale and minimum development build before dispatching native packaging/signing/notarization.
No full suite or old successful test is repeated; installed-app replacement is outside this goal.

The user added Windows and Linux builds. GitHub environment and repository metadata show Apple
signing inputs but no Windows PFX/password/thumbprint. The explicit prerelease preview path builds
Windows on a native Windows runner and uploads labelled unsigned installer/ZIP Actions artifacts;
it never contributes those files to the authenticated updater release. Default signed Windows
publication remains fail-closed. The authenticated build matrix includes both Macs and Linux.
The publish job downloads only release-* artifacts, excluding the separately named preview.
