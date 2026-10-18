# Explicit selected skill resources

The resource owner also supports explicitly selected inert JS/MJS scripts (v3)
and Python scripts (v4). Their source is reviewed and retained with the package,
while model packets contain script metadata only. Execution uses the separate
[restricted script contract](restricted-skill-scripts.md), admitted runtime,
workspace grant and per-call approval. Existing v1/v2 text/image behavior below
keeps its original digest domain and authority.

Standalone Agent skills can carry explicitly selected bounded text and PNG/JPEG
resources in addition to legacy instructions. Text-only v1 manifests/digests/version
identity remain unchanged; packages containing images use v2
`selected-local-mixed-package`. This is source delivery: it does
not execute scripts, install packages, enable MCP, open a
network connection or grant filesystem/desktop/browser authority. Legacy
read-only selection and managed text versions keep their existing behavior.

The supported package contains the selected `SKILL.md` and zero to sixteen
explicit relative paths under that skill directory's `references/` or `assets/`.
Supported text extensions are `.md`, `.txt`, `.json` and `.csv`; PNG/JPG/JPEG
images are additionally supported. Text resources remain at most32 KiB each,
128 KiB including SKILL.md. Images are at most160 KiB each,8 per package,8192
per dimension/16 Mi pixels per image/32 Mi package pixels. There are at most16
resources total and512 KiB mixed bytes. Text-only packages retain128 KiB total. Paths have at most six components,
bounded safe names and no absolute paths, backslashes, traversal, hidden files,
secret-store names or symlinks. Text UTF-8 decoding is strict and NUL-containing text files
are refused. Image bytes use bounded PNG/JPEG structural validation. Extension lookup uses own keys, so inherited object property names
are not accepted as media types.

Links and instructions never expand the selection. The host does not infer
resources from Markdown, scan unrelated files or copy a whole plugin. Local
managed imports continue to require an explicit user/workspace root; official
and vendor plugin distributions remain excluded through canonical ancestry
checks. The text itself is untrusted source material below system, developer
and user instructions. JSON text has no executable or permission semantics.

## Leaf and store contracts

`src/agent-tools/skill-resources.ts` exports:

| Contract | Meaning |
| --- | --- |
| `SkillPackageSelection` | `{identity: SkillIdentity, resources: string[]}`. Resource paths are relative to the selected `SKILL.md` directory. |
| `classifySkillResourcePath(path)` | Returns `{supported, mediaType?, reason?}` without reading the filesystem. Unsupported paths do not become an alternate executor or network fetch. |
| `snapshotSkillPackageSource(grant, selection)` | Returns `{manifest, content, resources}` after bounded reads and exact source-pin rechecks. |
| `SkillResourceText` | `{relativePath, mediaType, digest, bytes, content, role: 'selected-skill-source-material'}`. Contains no host source path or credential references. |
| `SKILL_PACKAGE_LIMITS` | Sixteen resources; text32 KiB each/128 KiB incl instructions; image160 KiB each,8 images/32 Mi package pixels; mixed512 KiB. |
| `UNSUPPORTED_SKILL_RESOURCES` | Declares unselected scripts/other executables, binary assets other than selected PNG/JPEG, network resources and automatic linked-resource discovery unsupported. |
| `readRetainedSkillResources(versionRoot, manifest)` | Internal verification of the complete selected private resource tree. It rejects changed, extra or symlinked entries before returning content. |

`LocalSkillSourceManifest` has an optional `package` field with version/kind,
`packageDigest`, `totalBytes`, package-directory device/inode identity and
resource identities plus source device/inode/size/mtime/ctime pins. This is
private review metadata, not a model packet. Package digest binds the instruction
digest/bytes and sorted relative resource path, media type, digest and bytes.
Manifest digest additionally binds the source identities. Both version identity
and review digest explicitly include the package digest. Two different selected
resource sets or contents cannot alias a version merely because `SKILL.md` is
unchanged. Conditional identity inputs preserve old text-only version IDs.

`ManagedSkillStore.reviewPackage(actionId, grant, selection, label,
updateLineageId?)` returns `{action, content, resources}`. The existing
`commit(actionId, reviewDigest, currentGrant)`, `inspect`, `attach`, `selected`,
`detach` and `revoke` methods share the same durable metadata owner. There is no
second import journal. `ManagedSkillVersion` optionally exposes `packageDigest`
and `resourceCount`; its `bytes` is the complete retained aggregate for package versions, while
`contentDigest` remains the `SKILL.md` digest.

`SelectedSkill` optionally carries `packageDigest`, `resources`, `promptBytes` and
`unsupportedResources`. Selected image resources contain metadata only, never
pixels. `bytes` counts the complete retained package; `promptBytes` counts
instruction/text plus image metadata. Its model-facing metadata contains only managed opaque
identities and relative resource paths; the private source root, source inode
pins and review paths are not included. Resource text can itself contain private
user-selected material; this feature is not a secret scanner and does not load
environment variables, credential stores or unselected files.

The internal `readResource(scope, versionId, packageDigest, relativePath,
resourceDigest)` method returns full resource bytes only for an already attached retained resource and
checks exact package/resource digests and revocation. The composition must still
validate that the task generation is active, as it does for selected instruction
delivery. The static four-field `skill-resource/read` builtin exposes only
`versionId`, `packageDigest`, `relativePath`, `resourceDigest`, under the existing
ToolJournal exact human approval and active task-generation checks. Root validates
current attachment and reads the exact immutable retained resource, rechecking
digest/tree; no arbitrary file path, execution or network API is added. Attaching
never injects image pixels automatically. Approved read returns canonical MCP
image content through the existing Web or Native image projection, with provenance
and no generic outcome-verification authority. Native still permits only two
cumulative attachments/160 KiB per binding, regardless of the larger stored package.
Existing user MCP namespaces have priority; builtin installation never replaces
`skill-resource` or other configured namespaces. MCP-off discovery works when
attached resources are valid.

## Retained lifecycle

Review reads and rechecks all selected source files through bounded descriptors,
captures canonical identities and writes the complete private review copy. It
rechecks the source after retaining that copy. Commit rechecks the exact selected
source manifest and the review tree before admitting publication. Instructions
and resources use fsynced private0400 files (images retained as raw bytes); directories remain private. Every
selected delivery rehashes the immutable resources and verifies that no extra
files, directories or links appeared in their tree.

The existing intent is durable before filesystem publication. Recovery can
recognize a fully present, valid target and register its terminal receipt without
copying again. Missing or invalid targets remain `outcome_unknown`; another
commit does not replay an uncertain import. Imported review/receipt data is
retained, and capacity errors do not purge earlier versions or references.

The action count and retained-byte reservation include package aggregate bytes,
reserving both review and possible published copies. Existing limits remain
512 actions, 256 retained versions, 64 task attachments and 64 MiB historical retained-byte reservation, including all image raw bytes;
each selected task packet is bounded separately. A resource-only update creates
a new immutable version in the same source lineage. Importing it does not change
an attachment. Explicit attachment chooses the replacement for that task and
generation; another generation starts with no attachment. Revocation/forget
prevents delivery while retaining referenced data and receipts. Removing the
source root does not remove a previously imported immutable version.

## Focused evidence and remaining scope

`bun test tests/agent-skill-resources.test.ts tests/agent-managed-skills.test.ts
--timeout 10000` passed four tests with 97 assertions. The actual temporary
filesystem case selects a reference and CSV template, imports and attaches them,
changes the reference while retaining the instruction digest, explicitly imports
an update and verifies the old generation keeps its original bytes. It covers
source drift before commit, bounded aggregate reservation, traversal, symlink,
unsupported executable/binary/secret-store paths, inherited media-type names,
retained digest drift, immutable-target recovery and revoke/forget continuity.
After review identified missing fsync of intermediate nested directories, the
writer was corrected to fsync every resource directory ancestor bottom-up. The
resource-only follow-up passed one test with 54 assertions, including retained
`references/nested/deeper/example.txt` after reopening and receipt recovery;
unchanged passing text-only cases were reused.
Existing text-only tests cover missing-target uncertainty/no replay, plugin
source exclusion and retained quota/retry behavior. No broad user skill corpus,
real user skills, external installation, account or production configuration is
used.

Composition, authenticated HTTP, UI review and counted provider delivery are
integrated. Root's connected actual HTTP/import/attach/composer fixture passed
one test with 19 assertions: exact package reached one counted fake Responses
offer; source drift retained imported bytes and revoke blocked future composition.
Root project and renderer TypeScript passed, followed by the 192-module renderer
build. The actual Russian DEV UI used a native picker and explicitly selected
`references/format.md`, showed full text and SHA-256 for both files plus package
digest, imported 264 bytes without automatic attachment, then explicitly attached
the version to task generation 1, revoked it with retained bytes and detached it.
That synthetic task had zero model offers/dispatches and zero tool calls. GUI and
core both closed with exit 0, exact PIDs/port were checked absent and the private
temporary profile was removed. No OS permission inspection/grant was requested.
Leaf success alone does not
prove model use or a completed task outcome. Broader executables, unsupported Python distributions/dependencies and shell,
other binary/multimedia assets such as PDF, remote resources and automatic dependency discovery
remain unsupported and require separate authority and executor design.

## Mixed image package batch

Structural PNG/JPEG byte validation is not complete codec decoding. Renderer review
first validates every descriptor, size, canonical base64 and SHA-256 via SubtleCrypto,
then renders local previews. Import remains disabled until every image reports a
successful natural-dimension-matching onLoad. Decode errors are sticky for the
review; callbacks from replaced reviews cannot unlock it. No auto-attach follows
import. Official/vendor plugin copies, unselected scripts/other executables, PDFs/other binaries,
network resources and automatic linked discovery remain unsupported. Existing
selected UTF-8 templates remain supported; broader template/binary execution work
is not completed by image support.

The new store/reader/public-composition evidence and actual component DOM
decode gate1/31 are recorded in [image resource evidence](../reviews/2026-10-18-skill-image-resources.md).
This source batch has no actual Electron/real model/installed delivery claim.

Final image-resource gates passed: bothTS/renderer196 at19:39, plainCLI644/exact
`.9` at19:41 and map731/finalcheck/paths. Headless Chrome component proof imported
a real chart once/unattached and rejected an unknown-critical-FAIL-chunk PNG
with valid header/CRC/SHA/zlib, retaining disabled Import/no second commit. This
is not a claim that every malformed codec payload is rejected: Chrome accepted
the earlier bad-zlib fixture. Source commit/CI and actual Electron/realmodel remain
separate.

## Restricted executable package v3

Explicit `scripts/*.js`/`.mjs` entries now use v3
`selected-local-executable-package`, preserving v1/v2 identity/digest semantics.
Code is32 KiB each within16 resources/512 KiB. SelectedSkill contains only script
metadata; exact code remains human-reviewed/retained and is consumed only by the
separate approved `skill-script/run` executor. Import/attachment grants no root
access: explicit ephemeral task-generation workspace grants and each run's same
ToolJournal approval are separate. This is bounded macOS JS/MJS only; Python,
shell, network, PDF/other binaries and vendor copies remain unsupported. See
[restricted execution](restricted-skill-scripts.md) and
[evidence](../reviews/2026-10-18-restricted-skill-scripts-and-ssh-aliases.md).
