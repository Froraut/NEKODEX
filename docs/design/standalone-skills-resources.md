# Explicit selected skill resources

Standalone Agent skills can carry an explicitly selected, bounded UTF-8 package
in addition to legacy text-only instructions. This is source delivery: it does
not execute scripts, render binary assets, install packages, enable MCP, open a
network connection or grant filesystem/desktop/browser authority. Legacy
read-only selection and managed text versions keep their existing behavior.

The supported package contains the selected `SKILL.md` and zero to sixteen
explicit relative paths under that skill directory's `references/` or `assets/`.
Supported extensions are `.md`, `.txt`, `.json` and `.csv`; assets support text
templates only. Every resource is at most 32 KiB and the complete package,
including instructions, is at most 128 KiB. Paths have at most six components,
bounded safe names and no absolute paths, backslashes, traversal, hidden files,
secret-store names or symlinks. UTF-8 decoding is strict and NUL-containing files
are refused. Extension lookup uses own keys, so inherited object property names
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
| `SKILL_PACKAGE_LIMITS` | Sixteen resources, 32 KiB per resource, 128 KiB aggregate. |
| `UNSUPPORTED_SKILL_RESOURCES` | Declares scripts/executables, binary assets, network resources and automatic linked-resource discovery unsupported. |
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
and `resourceCount`; its `bytes` is the aggregate for package versions, while
`contentDigest` remains the `SKILL.md` digest.

`SelectedSkill` optionally carries `packageDigest`, `resources` and
`unsupportedResources`. Its model-facing metadata contains only managed opaque
identities and relative resource paths; the private source root, source inode
pins and review paths are not included. Resource text can itself contain private
user-selected material; this feature is not a secret scanner and does not load
environment variables, credential stores or unselected files.

The internal `readResource(scope, versionId, packageDigest, relativePath,
resourceDigest)` method reads only an already attached retained resource and
checks exact package/resource digests and revocation. The composition must still
validate that the task generation is active, as it does for selected instruction
delivery. This method is not exposed as a generic HTTP filesystem API; the
complete selected packet already fits the bounded delivery contract.

## Retained lifecycle

Review reads and rechecks all selected source files through bounded descriptors,
captures canonical identities and writes the complete private review copy. It
rechecks the source after retaining that copy. Commit rechecks the exact selected
source manifest and the review tree before admitting publication. Instructions
and resources use private read-only files; directories remain private. Every
selected delivery rehashes the immutable resources and verifies that no extra
files, directories or links appeared in their tree.

The existing intent is durable before filesystem publication. Recovery can
recognize a fully present, valid target and register its terminal receipt without
copying again. Missing or invalid targets remain `outcome_unknown`; another
commit does not replay an uncertain import. Imported review/receipt data is
retained, and capacity errors do not purge earlier versions or references.

The action count and retained-byte reservation include package aggregate bytes,
reserving both review and possible published copies. Existing limits remain
512 actions, 256 retained versions, 64 task attachments and 64 MiB reserved text;
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
prove model use or a completed task outcome. Executable skills, script runners,
binary/multimedia assets, remote resources and automatic dependency discovery
remain unsupported and require separate authority and executor design.
