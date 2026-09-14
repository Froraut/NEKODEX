# Signed macOS release receipt — 2026-09-14

[Release v5.1.0-froraut.14](https://github.com/Froraut/codex-chatgpt-web/releases/tag/v5.1.0-froraut.14)
is public and marked as a prerelease. Its source is
`a015fe8d698650fd6a710ceeedc93400dd4665df`; [GitHub Actions run 34872918318](https://github.com/Froraut/codex-chatgpt-web/actions/runs/34872918318)
completed successfully, including ARM64, Intel and publication jobs.

## Distribution evidence

- Both macOS architectures passed the mandatory Developer ID identity, secure timestamp,
  Apple notarization, stapled ticket, Gatekeeper and packaged-runtime integrity gates.
- Publication signed the final asset metadata with the fork's Ed25519 key and attached GitHub
  build attestations. The draft became public only after its uploaded asset digests matched.
- The release has 15 assets, including ARM64 and Intel DMG/ZIP packages, both runtime archives,
  signed metadata, checksums, installers and license notices. Windows/Linux packages are absent.
- The public ARM64 ZIP is 169,482,872 bytes and has SHA-256
  `61b324d33b1eb03d41e93d41e998870a527f8eb515fcce98197f086cf65f64a6`.
  The downloaded file matched the authenticated metadata, expected source commit and run ID.
  `gh attestation verify` for this asset and this repository's release workflow exited 0.
- Gatekeeper accepted the extracted public package with `source=Notarized Developer ID`.

Before the hosted release, local pre11 was also signed and notarized. Apple submission
`e34514ee-ced8-4441-b0cf-798ce8d1ee62` returned Accepted, and stapling/Gatekeeper passed. That
local archive was an intermediate delivery; it is not mislabeled as a GitHub-built pre14 asset.

## Installed application

The published ARM64 ZIP replaced `/Applications/Codex Web GPT.app` through a staged copy and
graceful launcher shutdown. Info.plist reports **5.1.0-froraut.14**, bundle identifier
`dev.codexwebgpt.launcher`. The restarted service reports the same version, Full mode,
`status=ok` and `accepting_turns=true`. The saved ChatGPT account is still visibly signed in and
Bigger Context remains enabled.

The actual Codex model picker showed Web Instant, Medium, High, Extra High and Pro alongside
native models after the first signed upgrade. The current native Astra selection was preserved.
Pre13 initially left the picker-confirmation button disabled after a successful capability
inspection: the browser state remained loading with a stale connector-catalog refresh message,
even though no login or navigation lock remained. Pre14 restores readiness after the validated
inspection. The targeted regression passed, and the installed pre14 button was visibly enabled
and worked. The normal Verify runtime action completed in the observed 10.5-second interval,
showing Healthy and the existing Codex Native3 connector available. Done returned to the normal
browser workspace. Saved state now has core setup, catalog, picker and MCP setup complete,
with no Codex restart required. This connector-selection check submits no model turn and is
not presented as a new native tool execution or large-context response.

The previous pre13 application is retained under
`~/Library/Application Support/Codex Web GPT Backups/20260914-pre14-release/`. Earlier pre11 and
pre10 backups remain under `20260914-pre13-release/` and `20260914-pre11-notarized/`. Private
account/profile data stayed in its existing location and is absent from release assets.

## Release corrections

1. An OpenSSL-default PKCS#12 export failed at `security import` on the runners. A compatible
   encrypted export with the same identity and a strong random password imported successfully.
2. Clean-runner signing needed the Developer ID intermediate chain and the temporary keychain
   in the user search list. Preparation now preserves existing entries, adds the temporary
   keychain, and checks for the exact valid identity before signing. Pre13 passed both runners.
3. Prerelease publication now uses explicit platform dispatch and version-specific release notes.
   Existing pre11/pre12 tags were preserved; failed runs produced no public releases for them.
4. The local intermediate signing operation re-signed Bun after its manifest had been recorded.
   The mismatch was detected, the Bun signature/manifest/outer-app order was corrected, and the
   corrected artifact passed integrity and signature checks before the Apple submission.

## Verification limits and skill

The six focused behavior regressions from the previous task were reused, and one new readiness
regression passed. No full test suite, large-context replay, exhaustive tool sweep or new image
generation was launched. The original
large Pro task completing after compaction remains unverified; Bigger Context is experimental.
The release notes name this limitation and its normal-context recovery path.

The existing `codex-web-operations` skill was updated with publisher operations, managed-download
recovery, multipart diagnostics and reuse of prior focused evidence. Its four changed files were
copied to the installed skill after backing up the previous files outside skill discovery.
Source and installed bytes match. Instructions and links were reviewed manually; the bundled
Python validator could not run because PyYAML was unavailable. No claim of independent skill
behavior testing is made.
