# Computer Use image and Windows errors — upstream issue #457

Reviewed **2026-09-12** against fork commit
[`72801f3`](https://github.com/Froraut/codex-chatgpt-web/commit/72801f39c9074b30a507c2d2686ce86ffbce50ff).
[Upstream issue #457](https://github.com/miuuyy/codex-chatgpt-web/issues/457)
reports upstream 5.0.6, Codex 26.908.40834 and Windows 11 25H2, with the reproduction using
Zero Risk, now called Manual mode. The issue had no comments when inspected.

**The image omission has a source-supported explanation, but Manual mode image support is
not fixed.** The two Windows tool errors are separate symptoms with insufficient evidence for
a correction in this repository. This review changes documentation only.

## Separate symptoms

| Reported symptom | Evidence and disposition |
| --- | --- |
| `<image content omitted because you do not support image input>` | Manual routes advertise text-only input. Official Codex replaces unsupported MCP image results with this exact placeholder. This explains the reported output without attributing it to Temporary Chat or image-upload policy. |
| Separate boundary: initial or replayed images in a Manual prompt | Manual prompt preparation retains image references in text, but does not transfer or export the corresponding bytes to the launcher. Users must attach images themselves in ChatGPT. This incomplete handoff prevents a truthful global image-capability declaration; it is distinct from Codex stripping a fresh MCP screenshot. |
| `Native app bindings are unavailable for windows` | Neither this message nor the native app-binding implementation is present in the fork. The attachment does not identify the failing tool invocation or its platform-specific implementation. No Windows binding fix is claimed. |
| `unsupported key: asciitilde` | The fork does not contain this key mapping or error. The report lacks the exact tool name, arguments and backend needed to distinguish an unsupported key name from a bridge defect. No guessed key translation is applied. |

The public diagnostic attachment was inspected in memory only: **650,061 bytes and 3,545
NDJSON records**, spanning September 10–12. It records **62 Manual turn starts**, but none of
the three quoted error strings. It therefore supports the mode observation without proving
the complete screenshot or key-event failure path. No raw attachment, transcript, screenshot,
account data or private tool arguments are included here.

## Why Codex removes the image

The fork's [model catalog](../src/model-catalog.ts) declares
`input_modalities: ["text"]` for both Manual routes and is the only modality boundary Codex
reads. Automatic routes advertise text and image input.

Official Codex commit **`c4017a87aacc7558002b7cb510025e967c1d765e`** calls
`sanitize_mcp_tool_result_for_model` with the selected model's input modalities. When Image
is absent, the function replaces MCP image blocks with the placeholder above before returning
the result to the model. Its unit tests cover both removal and preservation of supported media.
See the pinned [call site](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/core/src/mcp_tool_call.rs#L547),
[sanitizer](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/core/src/mcp_tool_call.rs#L896)
and [tests](https://github.com/openai/codex/blob/c4017a87aacc7558002b7cb510025e967c1d765e/codex-rs/core/src/mcp_tool_call_tests.rs#L983).

This is a deterministic source-level explanation, not a reproduction of the reporter's complete
Windows task. Once Codex replaces an image with text, the bridge cannot recover its bytes from
that placeholder. Encoding bytes as ordinary base64 text would not turn a text-only input into
visual input and would enlarge the prompt. Image data needs a supported structured image path.

## Existing paths and the missing Manual handoff

[Prompt compilation](../src/adapters/chatgpt-web/prompt.ts) separates image bytes into
`compiled.images` and puts `image_attachment` references in the text. The automatic browser
path converts those images to native attachment payloads and uploads the referenced files.
[Responses parsing](../src/responses/parser.ts) preserves inline images as structured parts;
the [adapter's broker conversion](../src/adapters/chatgpt-web/index.ts) and
[MCP result conversion](../src/adapters/chatgpt-web/mcp-server.ts) can preserve image blocks
that actually reach them. These implementation paths do not prove live Computer Use support
for every host, tool or account.

The Manual branch in [the adapter](../src/adapters/chatgpt-web/index.ts) passes only
`compiled.text` and an optional resume text to the launcher.
[LauncherManualTurnStart](../src/launcher-browser-host.ts) has no image payload, exported-file
manifest or attachment confirmation. Its existing user instruction says to add images manually,
and [the Manual image-handoff test](../tests/zero-risk-adapter.test.ts) verifies that instruction.
It does not verify that image bytes were delivered to ChatGPT.

Consequently, changing the catalog to advertise images would promise a capability without a
complete Manual input path. The text-only declaration remains unchanged. A future implementation
needs a bounded image export and reference contract, a clear manual attachment step, and tests
for initial images, tool screenshots and later context handoffs before changing that declaration.
Real account and host verification remains necessary after those contracts pass.

For current visual tasks, use an automatic or native route that advertises image input and verify
the actual screenshot result. This does not repair unavailable Windows bindings or unsupported
keys. In Manual mode, treat omitted screenshots as unavailable visual evidence; manually attaching
an image in ChatGPT does not enable automatic screenshot delivery through the Codex route.

## Focused validation

The following existing synthetic checks passed during this review with Bun 1.4.0:

| Test file and selected test | Result | Assertions |
| --- | --- | --- |
| `tests/model-catalog.test.ts` — `Manual mode publishes exactly one generic model without capability inference` | Passed | 8 |
| `tests/zero-risk-adapter.test.ts` — `Manual mode keeps image handoff manual and says so in the paste instruction` | Passed | 4 |
| `tests/chatgpt-web-harness.test.ts` — `keeps inline images out of the context JSON and prepares native browser attachments` | Passed | 12 |

**Total: 3 tests passed, 24 assertions, no failures.** Each was selected with Bun's
`--test-name-pattern`; no full suite or live account request was run for this read-only review.
The first two verify the current limitation and its manual instruction. The third verifies
automatic attachment preparation, not live Windows screenshot delivery. No runtime code,
upstream message, issue state, account setting or permission was changed.
