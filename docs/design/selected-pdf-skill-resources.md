# Selected PDF skill resources

`skill-resources.ts` admits only explicitly selected `assets/*.pdf` and
`references/*.pdf`. PDF packages use version5, `selected-local-document-package`;
versions1–4 retain their digest domains. The immutable store owns hashed `0400`
raw files. Model `selectedSkills` contains path/type/size/digest metadata only,
without raw PDF bytes or extracted text.

Limits are2 MiB/PDF, four documents,4 MiB for the complete document package,
and the unchanged512 KiB limit for its non-PDF portion. Existing text/image/script
bounds still apply. Header validation is not parsing. Extraction is bounded at
32 pages and32 KiB UTF-8 text/document, with text-layer-only coverage. Scanned
pages, images, layout and annotations are not fully represented; there is no OCR.
Locked, malformed, scanned-only and over-limit files return honest unavailable
results, never empty successful previews.

## Parser ownership and build identity

`skill-pdf-helper-path.ts` resolves only an installed sibling helper or the
canonical source CLI's own development helper. Branded admission binds reviewed
source, manifest and executable hashes. Status uses cached admission and metadata
without a child; dispatch rechecks full pins. Missing support is unavailable.
The builder compiles a private snapshot of the exact reviewed source bytes.
Development's fixed boundary probe is inaccessible to model/HTTP input.
Distribution requires its dedicated signing owner, excludes the probe and hashes
after signing. The runtime builder copies helper/manifest beside `cli.js`;
Electron excludes development PDF helpers from ASAR and preserves the runtime
helper's signed hash. Development evidence does not prove distribution signing.

`skill-pdf-extractor.ts` and its trusted Bun supervisor own durable PID/start
identities, a child permit and bounded input/outcomes. The Objective-C helper
seals Seatbelt and publishes/closes its control FD before reading any PDF or
dynamically loading fixed OS PDFKit. Network, fork and further exec are denied.
Input/scratch plus disclosed system-library, filesystem-metadata and selected
sysctl grants remain explicit. Seatbelt uses a deprecated interface; this is not
a generic cross-platform sandbox.

Timeout15s, bounded output/observed RSS, cancellation, owner EOF and close must
physically settle the exact child. Retained operations are bounded at256. Status,
admission and close reconcile retained ownership even with a missing helper;
unsettled recovery contributes to composition activity. Unknown never replays.
Staged input is removed only after reap, durable receipt and exact file identity;
immutable source bytes remain.

## Preview, approval and read

HTTP review/inspect uses `presentSkillReview`: strip raw PDF data, request isolated
extraction, whitelist provenance/coverage/text and validate source/extractor
identities. The complete projection is limited to768 KiB. Failed/unknown state is
preserved. UI renders escaped text without iframe/embed/browser PDF parsing.
Every new PDF review requires fresh limitations acknowledgement, including when
no confirmed text is available. That acknowledges import only.

`skill-resource/read` retains four exact arguments and the existing ToolJournal
approval. Only a current attached version/package/path/digest may be read. The
shared extractor then returns bounded untrusted source text and provenance, with
no instruction authority or task-result verification. Task invalidation, detach,
revoke and close cancel/drain reads and suppress late text. Passive reconciliation
reads an existing receipt and revalidates attachment without parsing or sending
again. No second tool scheduler is introduced.

## Focused development evidence

The macOS native target passed6 cases/40 assertions: real PDFKit text/coverage,
refusal classes/limits, actual kernel boundary probes, cancellation/reap,
missing-helper retained live-owner recovery and host-loss/EOF physical reap.
Affected HTTP/store/resource/Python paths passed4 cases/124 assertions. Actual
Chrome review passed1 case/29 assertions, including fresh acknowledgement and
unavailable-text import. Both TypeScript checks, staged renderer and plain CLI
development bundles passed. A real GPT-6.1-Sol Goal then completed two offers and
one approved PDF read, with source marker and independently checked59.70 total.
The task remains review_required without a generic business observer; installed
delivery remains separate. See [acceptance](../reviews/2026-10-19-pdf-skill-resources.md).
