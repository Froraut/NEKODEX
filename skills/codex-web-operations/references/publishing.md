# Signed macOS publication

Use the fork's current `docs/release-signing.md`, `scripts/prepare-release-signing-macos.cjs`,
`launcher/scripts/release-signing.cjs` and `.github/workflows/release.yml` as the executable
contract. Read only the part needed for the requested local or GitHub release. This reference
does not authorize publishing, issuing keys or changing repository permissions by itself;
carry forward specific authorization already given in the task.

## Local application

- Confirm the installed version and preserve the previous application for rollback. Preserve
  the existing private profile and Codex route; do not bundle them into the release artifact.
- A usable Developer ID Application identity needs both certificate and private key. Xcode
  login, Apple Development signing and an issued certificate alone are insufficient.
- ASC CLI and notarytool can use a dedicated App Store Connect API key. Reuse an existing
  authorized credential. A logged-in Chrome account is not itself CLI authentication. Prefer
  Keychain storage and file arguments; keep credential values out of command output.
- Sign embedded Bun with the repository's Bun entitlements before recording its runtime
  manifest. Preserve that signature during the Electron packaging step. If an existing
  bundle is repaired, update the changed manifest entry and aggregate bundle ID, then sign
  the containing app. All nested executable code still needs valid signatures.
- Submit the final archive once and retain the submission ID. Resume its status instead of
  creating duplicate submissions because observation timed out. After Apple returns Accepted,
  staple the ticket and check Gatekeeper. This establishes distribution trust, not model or
  large-context behavior.
- Replace the installed application through a staged copy and graceful shutdown. Distinguish
  the main launcher from child processes that reuse the same executable. Check the new running
  version and visible saved account. A command that only opens the app is not runtime proof.

## GitHub builds

The macOS prerelease dispatch builds ARM64 and Intel on matching runners. Stable releases
retain the full platform contract. Do not publish unsigned Windows files to complete a macOS
request. Use a new version tag when release source changes; preserve existing published refs.

The signing and publishing environments hold separate encrypted secrets. Restrict their
eligible refs to intended version tags. Git author credits remain FroRaut; Apple's legal
certificate subject is a separate publisher identity and must not be rewritten.

OpenSSL's default PKCS#12 export was rejected by macOS `security import` in the recorded release.
The documented compatible export uses a strong random password, the public Developer ID
intermediate chain and the exact PKCS#12 options in `docs/release-signing.md`. Keep the password
in a private file for export and provide secrets through stdin when configuring GitHub.
Preparation must add the temporary keychain to the runner's user search list without dropping
existing entries and find the exact valid signing identity before invoking codesign.

Reuse focused source checks already obtained. The release performs native signature,
notarization and artifact integrity gates; do not add full suites, repeated behavior tests or
large context runs under the label of release verification. Record the actual failed step
before a targeted correction and retry.

Publish clear version-specific notes before making the draft public. Distinguish the fixed
multipart logic from an unexecuted original large Pro scenario. Keep Bigger Context experimental
until real evidence supports stronger claims. Signed metadata, GitHub provenance and uploaded
asset digests authenticate different aspects; none proves every ChatGPT tool or model works.

Finish with the release URL and version, installed version, actual Apple/Gatekeeper result,
relevant behavior evidence, backup location and unresolved limits. Dated incident reports are
evidence pointers and should not be presented as fresh acceptance results.
