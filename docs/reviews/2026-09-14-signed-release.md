# Signed macOS release receipt — 2026-09-14

[Release v5.1.0-froraut.13](https://github.com/Froraut/codex-chatgpt-web/releases/tag/v5.1.0-froraut.13)
is public and marked as a prerelease. Its source is
`d323e7e53143c7a092972bc0b52d72171df83dc0`; [GitHub Actions run 34870870117](https://github.com/Froraut/codex-chatgpt-web/actions/runs/34870870117)
completed successfully, including ARM64, Intel and publication jobs.

## Distribution evidence

- Both macOS architectures passed the mandatory Developer ID identity, secure timestamp,
  Apple notarization, stapled ticket, Gatekeeper and packaged-runtime integrity gates.
- Publication signed the final asset metadata with the fork's Ed25519 key and attached GitHub
  build attestations. The draft became public only after its uploaded asset digests matched.
- The release has 15 assets, including ARM64 and Intel DMG/ZIP packages, both runtime archives,
  signed metadata, checksums, installers and license notices. Windows/Linux packages are absent.
- The public ARM64 ZIP is 169,482,840 bytes and has SHA-256
  `c6deb6a7fa1f924d6b29904129c162a1a64754215ea9391ae7d6268115ff8952`.
  The downloaded file matched the authenticated metadata, expected source commit and run ID.
  `gh attestation verify` for this asset and this repository's release workflow exited 0.
- Gatekeeper accepted the extracted public package with `source=Notarized Developer ID`.

Before the hosted release, local pre11 was also signed and notarized. Apple submission
`e34514ee-ced8-4441-b0cf-798ce8d1ee62` returned Accepted, and stapling/Gatekeeper passed. That
local archive was an intermediate delivery; it is not mislabeled as a GitHub-built pre13 asset.

## Installed application

The published ARM64 ZIP replaced `/Applications/Codex Web GPT.app` through a staged copy and
graceful launcher shutdown. Info.plist reports **5.1.0-froraut.13**, bundle identifier
`dev.codexwebgpt.launcher`. The restarted service reports the same version, Full mode,
`status=ok` and `accepting_turns=true`; the initial completion observation had no active HTTP,
browser or compaction requests. The saved ChatGPT account is still visibly signed in and
Bigger Context remains enabled.

The actual Codex model picker showed Web Instant, Medium, High, Extra High and Pro alongside
native models after the first signed upgrade. The current native Astra selection was preserved.
The launcher's version-specific reply/connector acceptance badges were not manually marked as
passed: they still request setup verification, and the picker-confirmation button was disabled
in the observed initial setup screen. A served catalog and a saved account are not substituted
for fresh Web-model or connector execution evidence.

The previous pre11 application is retained under
`~/Library/Application Support/Codex Web GPT Backups/20260914-pre13-release/`. The earlier pre10
backup is retained under `20260914-pre11-notarized/`. Private account/profile data stayed in its
existing location and is absent from release assets.

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

The six focused behavior regressions from the previous task were reused. No full test suite,
large-context replay, exhaustive tool sweep or new image generation was launched. The original
large Pro task completing after compaction remains unverified; Bigger Context is experimental.
The release notes name this limitation and its normal-context recovery path.

The existing `codex-web-operations` skill was updated with publisher operations, managed-download
recovery, multipart diagnostics and reuse of prior focused evidence. Its four changed files were
copied to the installed skill after backing up the previous files outside skill discovery.
Source and installed bytes match. Instructions and links were reviewed manually; the bundled
Python validator could not run because PyYAML was unavailable. No claim of independent skill
behavior testing is made.
