# Lane 07 — files and prompts implementation

Worktree: `/Users/alex/Dev/nekodex-refactor-20260922`; baseline supplied by parent: `53d17361f3e9c81910055a7e2c18759ffce458bc`. Shared implementation wave; source changes only. Applied `right-size-test-runs`. No commit, push, app launch, live account/provider, build, installation, release, or additional agents.

## Finding disposition and independent validation

- **F1 implemented.** Independently inspected the original worker helpers, Manual materializer, prompt type, image preflight and selected-skill validator. Worker verified document size/hash while Manual decoded without comparing either. Extracted the original three public payload helpers plus the worker's attachment-count/skill assertion into `attachment-payloads.ts`, retaining their signatures. `prepareChatGptAttachments` exposes `{ name, mimeType, buffer, size, sha256 }`; Manual uses it before any directory/file write and keeps only trace/path ownership, reuse and instructions. Manual explicitly refuses skill-file payloads, retaining the compiler's prohibition. `ChatGptWebPromptFile` now extends `ResolvedCodexFile`, retaining only ref/original-name additions. Image encoding checks, document MIME/manifest checks, selected-skill validation and authorized-ID resolution remain separate. Document signature validation remains in the original resolver; no new authority is inferred from the shared descriptor. Collision allocation and original names are unchanged.
- **F2 implemented.** Confirmed the old inline decoder allocated decoded and re-encoded data before `resolvedFile` checked 20 MB. `decodeCodexFileBase64` checks exact decoded length after whitespace compaction and syntax validation, before `Buffer.from`. Canonical pad bits are checked directly, avoiding re-encoding a full buffer. The same bounded decoder now prepares verified document payloads. Kept cheap filename/MIME validation in its existing position to preserve malformed-base64 versus metadata error precedence; no raw-string cap was added. Authorized file IDs continue through their separate resolver.
- **F3 implemented.** Confirmed host-default `basename` accepted backslash names on POSIX while the Electron lease predicate rejected both separators. Core now explicitly rejects both slash directions after NFKC/trim, preserving other controls. The guard needed no production edit. A shared behavioral table exercises both core validation and the real guard registration API, including fullwidth slash/backslash and Unicode/trim acceptance.
- **F4 implemented.** Confirmed both acquisition paths duplicated final-name derivation, existing-file/digest validation and promotion. `artifact-format.ts` now owns output MIME/signature/JSON/ZIP policy; `artifact-storage.ts` owns bounded digesting, manifest verification and common content-addressed promotion. `artifacts.ts` remains the acquisition facade, preserving public types/constants and ZIP-validator re-exports. Both transports validate their authority before passing a partial and measured bytes to storage. Storage receives explicit byte limits and a narrow transaction signal/race contract. Existing directory, trace/assistant, symlink/realpath, digest, deadline and cleanup ownership checks remain. Format/manifest logic was moved without broad redesign.

No finding was rejected. The conditional metadata-validation reordering in F2 was intentionally omitted for error compatibility. No host or Electron guard ownership was needed.

## Cross-lane wiring

Contract readiness and exact replacements sent to parent, lane05 (`01a0c910-ff94-79a0-b2c3-0b485ef41593`) and lane11 (`01a0c911-0247-7ca0-a740-a2805abb0457`). Confirmed their resulting source wiring by inspection:

- Worker imports `assertChatGptPromptAttachments` and `chatGptPromptFilePayloads` from `./attachment-payloads`, re-exporting the original three payload helpers from the same module.
- Helper-main imports `chatGptDocumentFilePayloads` directly from `./attachment-payloads` for its existing validation call.

Those files were edited by their owners, not this lane. No synchronized consumer API change is required.

## Focused verification

Every test invocation below was executed through Python `subprocess.run(..., timeout=N, check=True)` with a 30-second maximum, except the Electron command, which had a 15-second maximum. No existing shared tests were edited.

1. `bun test tests/files-prompts-contracts.test.ts` — **7 passed, 0 failed**, 35 expectations, 172 ms. Covers exact 20 MB and one byte above with a `Buffer.from` spy proving no decode allocation; whitespace and canonical pad bits; mutated size/hash rejection before Manual writes; exact shared/Manual bytes/name/size/hash; mixed count and 50 MB bounds; Manual skill refusal; core/Electron portable names; bound guarded-receipt mismatch and partial cleanup.
2. `bun test tests/chatgpt-attachment-aliases.test.ts tests/web-file-transfer.test.ts --test-name-pattern 'attachment aliases|long and case-colliding|inline CSV|PDF, UTF-8|bad names|a bound response|generated ZIP|artifact transaction deadline|launcher network receipt is validated|post-download size rejection|verified manifests'` — **12 passed, 0 failed**, 7 filtered, 120 expectations, 326 ms. Reuses existing inline/multipart collision/byte proof, Manual materialization, document validation, promotion/manifest replay, container rejection, transaction cancellation and partial cleanup, guarded receipt success, symlink and manifest bounds.
3. Strengthened the new injected receipt-failure test to assert the exact nested mismatch cause, in addition to observed `hover → written → click → receipt → cancel` stages and reading valid partial bytes at the receipt boundary. Reran only `bun test tests/files-prompts-contracts.test.ts --test-name-pattern 'guarded receipt mismatch'` — **1 passed, 0 failed**, 6 filtered, 27 ms.
4. `node --test '--test-name-pattern=canonical filenames claim|canonical lease names reject' launcher/tests/task-artifact-download.test.cjs` — **2 passed, 0 failed**, 54 ms. Existing canonical receipt and unsafe lease-name controls.
5. `git diff --check -- src/responses/file-content.ts src/adapters/chatgpt-web/prompt.ts src/adapters/chatgpt-web/manual-attachments.ts src/adapters/chatgpt-web/artifacts.ts` — passed. Reviewed extraction/import direction and acquisition/storage call sites manually.

6. After the worker owner confirmed integration, ran a 30-second-bounded `bun -e` import-identity check (no repeated behavior pipeline):

   ```ts
   import * as worker from "./src/adapters/chatgpt-web/browser-worker";
   import * as payloads from "./src/adapters/chatgpt-web/attachment-payloads";
   for (const key of ["chatGptImageFilePayloads", "chatGptDocumentFilePayloads", "chatGptPromptFilePayloads"] as const) {
     if (worker[key] !== payloads[key]) throw new Error(`Facade mismatch: ${key}`);
   }
   console.log("3 worker payload exports resolve to shared implementations");
   ```

   **Passed**, all three worker exports are the shared function objects.

This is 21 distinct behavior cases; the receipt case was rerun after improving its boundary assertion. No full suite/typecheck/build or UI pipeline ran here. Parent owns integrated type/build/rendered-UI checks.

## Exact files changed by lane 07

- `src/responses/file-content.ts`
- `src/adapters/chatgpt-web/prompt.ts`
- `src/adapters/chatgpt-web/manual-attachments.ts`
- `src/adapters/chatgpt-web/attachment-payloads.ts` (new)
- `src/adapters/chatgpt-web/artifacts.ts`
- `src/adapters/chatgpt-web/artifact-format.ts` (new)
- `src/adapters/chatgpt-web/artifact-storage.ts` (new)
- `tests/files-prompts-contracts.test.ts` (new, lane-owned)
- `docs/reviews/architecture-refactor-20260922/07-files-prompts-implementation.md` (this report)

## Remaining constraints

No unresolved lane-local finding. Parent must complete integrated verification of the concurrently changing shared worktree. Results establish local source/fixture behavior, not live browser/provider transfers, UI behavior, installed-app state or release readiness. Existing worker/helper facade wiring is confirmed in source; their broader refactors remain owned by their lanes.

## Integrated type-check follow-up

Parent reported a Bun matcher generic mismatch at `tests/files-prompts-contracts.test.ts:47`: `readFile` returns `NonSharedBuffer`, while prepared payloads expose `Buffer<ArrayBufferLike>`. Replaced the matcher comparison with `expect((await readFile(manual!.path)).equals(prepared!.buffer)).toBe(true)`, preserving exact byte equality without casts. Ran only `bun test tests/files-prompts-contracts.test.ts --test-name-pattern 'Manual and shared payloads agree'` under a 30-second timeout: **1 passed, 0 failed**, 6 filtered. No global tsc was run by this lane; parent owns integrated type-check confirmation.
