# Fork release authenticity, provenance and native signing

This fork replaces the upstream installation by the owner's explicit choice. It retains
`dev.codexwebgpt.launcher`, the `Codex Web GPT` application name, the NSIS GUID and existing
profile locations. It does not create a second profile or copy/delete browser credentials.
`launcher/package.json` identifies FroRaut as the maintainer, records upstream attribution,
and declares `installationMode: replace-upstream`. Asset/update ownership stays pinned to
`Froraut/codex-chatgpt-web`. Changing the bundle identity later requires a separate migration.

## Three independent proofs

1. `release-metadata.json` authenticates exact release bytes with this fork's Ed25519 key.
   The updater verifies it against the public key packaged inside the already trusted app,
   before downloading/extracting the candidate. API digests and `checksums.txt` alone do not
   satisfy this gate. This establishes possession of the fork-controlled signing key; it is
   not a CA-issued publisher certificate or independent verification of a person's identity.
2. GitHub's OIDC-backed artifact attestation records the source repository, commit and workflow
   that produced the final release assets. A signed metadata assertion about its source is not
   a substitute for independently verifying the GitHub attestation.
3. macOS releases require timestamped **Developer ID Application** signatures, successful Apple
   notarization, a stapled ticket and Gatekeeper acceptance. Windows releases require valid,
   timestamped Authenticode signatures matching the configured certificate thumbprint.
   Ad-hoc and Apple Development signatures do not pass the macOS distribution gate.

The public trust root in [release-trust.json](../launcher/release-trust.json) was generated for
this fork on 2026-09-11. Its private key is stored outside the repository in the owner's private
release-signing directory, with directory mode `0700` and key mode `0600`. It was not uploaded to
GitHub. The public key fingerprint (SHA-256 of DER-encoded Ed25519 SPKI) is:

```
2175d07bb3fdb619aba59b9739d346ca4354a4fa6b81b1f76edaaa3256c4f048
```

A local signature/verification exercise with this key succeeded, including rejection after
same-size asset tampering. This is evidence about the metadata implementation, not evidence of
an Apple notarization, Windows signature, published GitHub attestation, or installed-app upgrade.

## Signed metadata contract and rotation

The envelope contains `schemaVersion: 1`, base64-encoded JSON `payload`, and unique
`{ keyId, signature }` entries. Ed25519 signs the exact payload bytes prefixed with the UTF-8
domain separator `codex-web-gpt.release.v1` followed by one NUL byte. No JSON canonicalization
is needed because the encoded bytes are carried in the envelope.

The authenticated payload binds repository, tag, version, issue/expiry timestamps, source commit,
workflow/run, and every final asset's safe basename, byte length and SHA-256 digest. It also
includes `checksums.txt`; the metadata itself is excluded to avoid a digest cycle. Metadata is
limited to 512 KiB, at most 256 assets and 1 GiB per asset. The signing script grants 90-day
metadata validity; the verifier permits at most 180 days, checks active key validity at both
issuance and verification, and allows five minutes of clock skew for issuance. Future, expired,
wrong-repository, wrong-version, duplicate-asset and untrusted-key manifests fail closed.

`source.buildType` explicitly distinguishes `github-actions` from `local`. Local signing uses
run ID `0`; the publication script refuses local metadata. This prevents local verification
exercises from being presented as a completed CI release.

Rotation is a two-release operation, not trust-on-first-use:

1. Generate the next key in protected storage and independently check its public fingerprint.
   Commit its public key, unique fingerprint and validity interval into `release-trust.json`
   alongside the current key. Keep the current threshold until installed clients have received
   this transition build. Sign transition metadata with the current key (and optionally both).
2. Sign subsequent release metadata with both old and new keys during the compatibility window.
   Clients that know only the old key can still verify; transition clients know both.
3. Ship a later build that removes/revokes the old key or raises the threshold. Only then stop
   signing for the old clients. Clients that missed the transition need an independently verified
   manual installation. Never accept a new root supplied by a downloaded release manifest.

The initial threshold is one. Multiple independent keys can be required by increasing the
packaged `threshold`; repeated copies of a signature never count as additional keys. Revocation
of a compromised old signing key cannot be safely delivered only through that same compromised
key, so use an independent distribution channel for emergency trust replacement. Back up the
private key in owner-controlled encrypted storage; losing it blocks updates for clients that
trust only that key. Do not commit private keys, put them in a public release, or paste them into
logs or issue comments.

## GitHub configuration required before publication

Create the `release-signing` and `release-publishing` GitHub environments, restrict eligible tags,
and configure required reviewers who verify the exact source commit and artifacts. Protect tag
creation and reviewed release source with repository rules. A workflow environment name alone
cannot enforce an approval rule; those repository settings must be configured by the owner.
No repository secrets or variables were configured by this change.

The `release-signing` environment uses:

| Type | Name | Required content |
| --- | --- | --- |
| Secret | `MACOS_DEVELOPER_ID_P12_BASE64` | Base64 PKCS#12 export of a valid Developer ID Application certificate and private key |
| Secret | `MACOS_DEVELOPER_ID_PASSWORD` | Password protecting that PKCS#12 export |
| Variable | `MACOS_DEVELOPER_ID_NAME` | Full `Developer ID Application: … (TEAMID)` identity |
| Variable | `APPLE_TEAM_ID` | Expected ten-character Apple team identifier |
| Secret | `APPLE_NOTARY_API_KEY_BASE64` | Base64 App Store Connect API private key (`.p8`) authorized for notarization |
| Variable | `APPLE_NOTARY_API_KEY_ID` | API key ID |
| Variable | `APPLE_NOTARY_API_ISSUER` | API issuer UUID |
| Secret | `WINDOWS_SIGNING_PFX_BASE64` | Base64 PKCS#12 export of a valid Windows publisher certificate and private key |
| Secret | `WINDOWS_SIGNING_PFX_PASSWORD` | Password protecting that export |
| Variable | `WINDOWS_SIGNING_CERT_SHA1` | Expected 40-hex certificate thumbprint; this identifies the certificate, while signatures use SHA-256 |

The Windows workflow currently supports an existing exportable certificate imported into the
runner's CurrentUser certificate store. If the chosen certificate is restricted to a hardware
token/HSM or a cloud signing service, provide that signing resource and integrate its authenticated
signing adapter before releasing; do not export a non-exportable key or substitute an unsigned
artifact. A pre-provisioned Windows machine can use the same local package path with its accessible
certificate and SDK SignTool. The implementation does not claim Azure/HSM service support.

The `release-publishing` environment needs secret `RELEASE_METADATA_SIGNING_KEYS`, a JSON array:

```json
[{"keyId":"public SPKI fingerprint","privateKey":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"}]
```

Provision this through the owner's secret-management interface. The file-based offline signing
path below avoids putting a private key in a shell argument. The CI signing step receives the
secret only at signing time; it validates that the corresponding public key satisfies the
packaged trust policy. No dependencies are installed or dependency scripts run in the publication
job. Keep the environment key separate from ordinary build jobs and pull-request workflows.

## Executable paths

On a native machine, `CODEX_WEB_GPT_RELEASE=1 bun run app:package` enforces distribution signing.
Without that flag, local development packaging retains its previous ad-hoc/unsigned behavior.
This distinction is explicit: a successful local package command alone is not a publisher release.

For macOS, provide `CSC_NAME`, `CODEX_WEB_GPT_SIGNING_KEYCHAIN`, `APPLE_TEAM_ID`, `APPLE_API_KEY`
(path to the `.p8` file), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. Alternatively, set
`APPLE_KEYCHAIN_PROFILE` to an existing `notarytool` credential profile, with optional
`APPLE_KEYCHAIN` to identify its keychain. This local profile route requires no export or reading
of notary credentials. When a profile is explicitly selected, packaging clears inherited API-key
and Apple-ID options so Electron Builder uses that profile. `CODEX_WEB_GPT_SIGNING_KEYCHAIN`
can point to an existing signing keychain; no certificate export is needed for a local build.
The signing identity must still be Developer ID Application, not Apple Development.

For CI, use a PKCS#12 format accepted by macOS Keychain. An OpenSSL export using its current
default protection failed at `security import` on both macOS runners. Exporting with
`-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1`, a strong random password supplied
through a private password file, and the same certificate/key succeeded in a temporary local
keychain. Store only the encrypted container and password in the designated GitHub secrets;
never put either in command output or tracked files.
Include the public Developer ID intermediate certificate chain in that export, so a clean
runner does not depend on a previously cached issuer certificate. Preparation adds the
temporary keychain to the runner's user search list and checks for the exact valid identity
before packaging. The cleanup step deletes that temporary keychain.

CI prepares a temporary keychain,
imports the approved certificate, and deletes it and the temporary API key even when later steps
fail. The Bun executable is signed with hardened runtime/JIT entitlements **before** its runtime
manifest is hashed; the package signer excludes only that already signed binary to preserve its
recorded digest. The outer app and nested Electron code are signed with Developer ID, and
`electron-builder` performs notarization and stapling. The extracted final ZIP must pass strict
signature checks, expected-team checks, `stapler validate` and `spctl --assess` before publication.

For Windows, provide `CODEX_WEB_GPT_WINDOWS_CERT_SHA1` and `CODEX_WEB_GPT_SIGNTOOL` (absolute SDK
SignTool executable path), with the certificate/private key accessible in `Cert:\CurrentUser\My`.
Bun is timestamp-signed before runtime hashing, and excluded from later re-signing. Electron
Builder signs the app and NSIS installer with the same certificate. Every executable in the
packaging staging tree must have a valid timestamped Authenticode signature from the expected
publisher. The pipeline publishes both the NSIS installer and
`codex-web-gpt-${version}-win-x64.zip`; the updater uses the ZIP to stage and validate a complete
replacement before switching installations.

To sign already built **local** assets without uploading anything, put the final files in a fresh
flat directory, create `checksums.txt` first if desired, then run from the repository:

```bash
RELEASE_METADATA_PRIVATE_KEY_FILE=/absolute/private/path/to/fork-key.pem \
  node scripts/sign-release-metadata.cjs /absolute/path/to/final-assets --offline
```

The script refuses an existing metadata file, validates every asset, signs with the actual private
key, and verifies its own output against the packaged public root. Offline metadata explicitly
records `buildType: local` and run ID `0`. It does not imply native signing or CI attestation.

The tag workflow builds on matching operating systems, signs final metadata, uses GitHub OIDC
to attest final assets, creates a **draft** release, verifies the remotely reported digest of
every uploaded file against local bytes, and only then publishes. Existing tags/releases are not
overwritten; inspect and explicitly clean up a failed draft before retrying. SHA-256 checksums
are not rebuilt from remote values or changed after metadata signing. Pre-release versions stay
pre-releases. The workflow never silently substitutes upstream assets.

All action revisions are full commit SHAs, verified against their repositories on 2026-09-11.
Checkout does not persist its token. Build jobs retain `contents: read`; only publication receives
`contents: write`, `id-token: write`, and `attestations: write`.

After a real release, independently verify an asset's provenance with:

```bash
gh attestation verify /absolute/path/to/downloaded-asset \
  --repo Froraut/codex-chatgpt-web \
  --signer-workflow Froraut/codex-chatgpt-web/.github/workflows/release.yml
```

First-install scripts remain a bootstrap trust boundary: use a reviewed checkout or independently
verify its signature/provenance before executing a downloaded installer script. An in-app update
signature cannot authenticate the first app installation retroactively.

## Validation boundaries

Focused tests cover metadata tampering, asset replacement, wrong fork/version, unknown and
expired keys, threshold/rotation behavior, duplicate/path-traversal assets, byte limits,
local-versus-CI source labeling, missing signing inputs, and rejection of Apple Development,
ad-hoc, wrong-team and untimestamped identities. Required platform/account acceptance remains
listed in [release-validation.md](release-validation.md). Native signatures, notarization,
Windows SmartScreen behavior and GitHub provenance are only confirmed after the corresponding
service-backed workflow succeeds; their configuration is not evidence of that success.

Primary references: [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations),
[Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing),
[electron-builder v26 macOS options](https://www.electron.build/v26/docs/mac/),
[Electron notarization](https://github.com/electron/notarize).

## Explicit macOS-only prerelease

The owner can dispatch `release.yml` against an **existing matching prerelease tag** and select
`platform_scope: macos`. This builds and signs both macOS architectures, publishes only those
native assets and their matching runtime archives, and generates notices on the macOS runner.
No Windows certificate is requested and no unsigned Windows/Linux artifact is substituted.
All normal metadata, notarization, attestation and draft-verification gates still apply.
A stable tag cannot use this reduced scope. Stable tag pushes retain the full-platform matrix;
prerelease tags wait for an explicit workflow dispatch with the intended platform scope. It does not bypass
protection of the signing or publishing environments and does not create a tag.

Release packaging reuses the focused behavior evidence recorded for the reviewed source commit.
It builds the renderer and runtime directly instead of repeating the typecheck, behavior tests
and launcher smoke run on every release architecture. The package step still verifies the final
macOS ZIP's Developer ID signature, expected team, notarization ticket, Gatekeeper assessment
and runtime integrity. Metadata signatures, uploaded asset digests and GitHub attestations remain
required. Full source verification is not launched by a prerelease dispatch.
