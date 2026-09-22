# Lane 07 — files, artifacts and prompt construction

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc` (HEAD checked). Read-only source review; **no tests/builds run**, no apps/providers/accounts used, no agents spawned. Only this report was written. Findings below distinguish confirmed code behavior from proposed architecture; none claim runtime reproduction.

Read relevant completed-work sections in `app-improvements-20260922.md` (54–85, 151–153), `app-improvements-wave3-20260922.md` (56), and `app-improvements-waves4-5-20260922.md` (102, 116–118). Preserve completed filename collision mapping, common image preflight, terminal cancellation ordering, and host cleanup of completed/unpromoted partials. These are not new findings. Read and applied `right-size-test-runs` to the future verification proposals.

## 07-files-prompts-F1 — one prepared-attachment contract for both transports

**Priority: medium; bounded architecture improvement.** `src/adapters/chatgpt-web/prompt.ts:28–39` repeats the fields of `src/responses/file-content.ts:18–26`. `manual-attachments.ts:23–47` separately converts images/documents/skills and implements count/total-byte policy. Its browser counterpart lives in the oversized `browser-worker.ts:2238–2321`, including document manifest/hash checks and skill validation. Manual recomputes the hash of supplied document bytes but does not compare the supplied manifest size/hash; browser does. This is evidenced policy duplication, not a demonstrated remote bypass: current Manual caller `index.ts:619–622` passes locally compiled prompts, whose document parts originate in the parser’s resolver (`src/responses/parser.ts:72–77`).

Adding an attachment kind or changing acceptance rules currently requires changing prompt projection, browser payload conversion, and Manual materialization independently. The IPC helper additionally imports browser-worker payload validation (`browser-helper-main.ts:450–454`). Neither byte preparation nor document validation needs browser automation.

**Concrete change:** create `src/adapters/chatgpt-web/attachment-payloads.ts` containing pure preparation/validation with a returned descriptor `{name, mimeType, buffer, size, sha256}` and explicit mixed-set count/byte checks. Reuse `ResolvedCodexFile` in the prompt file type, adding only transport ref/original-name metadata. Manual should consume the prepared payloads and retain only owned-path creation/reuse plus instructions. Keep image encoding-only validation, document signature rules, selected-skill provenance, and authorized-file resolution distinct; a shared descriptor must not make these authorities interchangeable. Keep compiler collision allocation and original names unchanged. Do not attach skill files in Manual through this refactor; the existing compiler prohibition remains.

**Owned write set:** new `attachment-payloads.ts`, `manual-attachments.ts`, `prompt.ts` type declaration, with coordinated use of lane-owned `file-content.ts`, `input-image-validation.ts`, and `skill-attachments.ts` only where needed. **Cross-lane wiring:** browser-worker owner replaces existing pure helper bodies with imports/re-exports and changes the helper-main import if that file belongs to them. Parent must assign these tiny caller edits to the existing owner; lane 07 must not independently edit browser lifecycle code. Retain current exports for callers/tests. This is not a proposal to duplicate that lane’s worker refactor.

**Smallest verification:** selected existing attachment-alias and file-transfer cases through both consumers, plus one mutated document hash/size rejection and a mixed attachment-limit case. Assert exact bytes/names and rejection before disk write/composer mutation. Maximum 30 seconds per focused invocation; no whole-worker suite.

## 07-files-prompts-F2 — enforce the file byte bound before decoding

**Priority: medium; confirmed validation-order/resource defect.** `src/responses/file-content.ts:68–77` strips whitespace, validates syntax, decodes the complete input, then re-encodes the complete buffer to check canonical base64. Only `resolvedFile` at lines 113–117 checks the 20 MB cap. `resolveInlineCodexFile:129–139`, called by `parser.ts:72–77`, performs these allocations before it even rejects an invalid filename/type. An otherwise well-formed oversized inline payload therefore incurs decoded and encoded copies before inevitable rejection. This finding does not assume unlimited HTTP bodies or claim an observed OOM.

**Concrete change:** after allowed whitespace compaction and syntax/padding validation, compute decoded byte length and reject values above `CODEX_INPUT_FILE_MAX_BYTES` before `Buffer.from`. Retain canonical pad-bit checks, empty rejection, MIME/signature checks, and the existing whitespace tolerance. Validate cheap name/type metadata before decoding where this preserves the public error contract. Do not silently add a raw-string limit that rejects formerly allowed whitespace-heavy input. Use the same bounded decoder for prepared documents where suitable, without routing authorized file IDs through an inline resolver.

**Owned write set:** `src/responses/file-content.ts`; its targeted regression fixture. This stays in lane 07 even though it is under responses. No parser ownership transfer is necessary. F1 and F2 share the same sequential implementation owner.

**Smallest verification:** canonical payload exactly at the limit and one byte above, plus existing whitespace and noncanonical-pad rejection controls. Verify the oversized path rejects before buffer decoding (a narrow decoder seam is acceptable); do not infer this from eventual rejection alone. Maximum 30 seconds, no memory benchmark or broad parser suite.

## 07-files-prompts-F3 — portable filename policy must agree with the Electron guard

**Priority: medium; confirmed cross-platform policy mismatch.** `src/responses/file-content.ts:46–52` uses host-default `basename`. On POSIX, `folder\\report.txt` is a plain basename and passes the other checks. The same string fails on Windows. In contrast, `launcher/electron/task-artifact-download.cjs:10–20` rejects both slash directions on every OS. Callers include input resolution, browser document preparation (`browser-worker.ts:2268`), artifact visible names (`artifacts.ts:109–113`), and suggested download names (`artifacts.ts:394`). Thus a descriptor accepted as a plain filename by the core on macOS/Linux is not a valid Electron lease filename. This is a portability/contract defect, not an asserted POSIX directory traversal exploit.

**Concrete change:** make the core plain-filename rule explicitly reject `/` and `\\` after NFKC normalization, preserving trim, length, control-character, and dot-name checks. Keep the stricter guard behavior. Maintain a small matching contract table across TS/CJS; avoid a new runtime/package dependency merely to share this tiny predicate. Do not sanitize unsafe names into apparently authorized ones. Preserve all completed canonical-Unicode and collision-alias behavior.

**Owned write set:** `src/responses/file-content.ts` and focused filename fixtures; `launcher/tests/task-artifact-download.test.cjs` only if the existing guard controls need extension. No production guard change is required. Same lane owner as F1/F2.

**Smallest verification:** both validators reject each slash direction, including an NFKC form normalizing into a separator; both retain a normal Unicode filename and trim normalization. Reuse existing guard canonical-name controls. Maximum 15 seconds per focused command; native Windows launch is unnecessary for this explicit separator rule.

## 07-files-prompts-F4 — separate artifact format policy and verified storage from acquisition

**Priority: medium; architecture improvement, no new cleanup bug claimed.** `artifacts.ts` combines DOM card discovery (116–152), transaction cancellation (197–236), ZIP validation (252–345), format checks/digesting (347–385), two transfer paths (387–522), manifest replay (524–564), and orchestration/publication (567–708). The two paths repeat final-name derivation, existing-file type/digest checks, partial cleanup, and promotion at 439–452 and 495–509. Supporting another output format requires navigating browser and filesystem lifecycle code unnecessarily.

**Concrete change:** extract `artifact-format.ts` for output MIME/signature/ZIP policy, and `artifact-storage.ts` for bounded digesting, manifest verification, and shared content-addressed promotion. Keep `artifacts.ts` as the existing facade and acquisition owner; retain public exports through re-exports. Each transport must still validate its own authority before handing an owned partial to storage. Explicitly pass byte bounds and the existing transaction race/signal contract. Preserve exact trace/assistant binding, symlink/realpath checks, digest verification, manifest format, deadlines, and cleanup ownership. Leave Electron lease state and host completion cleanup intact; do not create a universal download state machine or merge input/output MIME allowlists.

**Owned write set:** `artifacts.ts`, new `artifact-format.ts`, new `artifact-storage.ts`, selected existing file-transfer fixtures. No host or download-guard edits needed. Disjoint from attachment files; still one lane implementation owner.

**Smallest verification:** selected existing valid-format/rejected-container case, guarded receipt mismatch rejection, and one promotion/replay flow with unchanged final path/hash. Reuse existing cancellation/cleanup cases touched by movement, without rerunning unrelated host suites. Maximum 30 seconds per targeted invocation.

## Handoff

Implement F1–F3 sequentially under the lane 07 owner; F4 is a separable extraction in that owner’s area. Parent coordinates browser caller wiring, accepts/defer decisions, and owns integration, development build/UI checks, git and publication. No UI changes are proposed from this backend lane. Verification above is a proposal only; **no tests were run**.
