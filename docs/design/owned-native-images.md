# Bounded owned Native image input

This source batch carries approved tool-result image bytes through the existing
Native owner. It introduces no image path/fetch API, temporary image files,
second sender, native tool execution or new task authority.

`src/agent-mode/native-images.ts` accepts exact top-level MCP image blocks from
the matching ToolJournal continuation result. It binds tool-call ID, immutable
receipt and attachment index, rejects nested/alternate image representations and
projects text-side results to attachment metadata. Pixel bytes travel separately
in typed `envelope.images`; they are never flattened into host-context text.
The durable Bun preclaim hashes the complete envelope before the one main offer.
Main validates it again and prepares fixed `detail:'high'` PNG/JPEG data URLs for
`turn/start`. Text-only envelope identity remains compatible.

A qualified model must advertise image capability in both its original full
ModelInfo `input_modalities` and actual picker `inputModalities`. Capability is
per model/admission, carried through descriptor and binding, never inferred from
a model name or a compiled helper. The separate local fixture checks its sealed
catalog capability; that alone cannot qualify an official account.

The shared CJS validator checks canonical base64, byte count/hash, MIME/signature,
PNG chunk structure/CRC and bounded JPEG structure/dimensions. It permits at most
8192 pixels on either axis and 16 Mi pixels. This is bounded structural admission,
not a full codec decode or proof of a real screenshot source. Main and the leaf
journal enforce a cumulative **two attachments / 160 KiB per binding**, including
all prior offers and uncertain outcomes. Budget admission precedes a new send;
a failed/unknown offer does not grant more image budget. Unlike Web request projection, pruning historical pixels cannot restore this
Native binding budget. Longer Native vision loops beyond two cumulative images
are not implemented by this batch.

The worker requires exact canonical typed user-input echo: client identity,
content order, data URLs, bytes and detail must match. Uploaded `fileId`, omitted
media, text-only echo or another ambiguous representation yields held unknown,
retaining physical ownership and late correlation without replay. Real remote
file-upload correlation is untested. Canonical receipts/journals retain bounded
image metadata and hashes, not image bytes or paths. The final-summary history
policy is unchanged: only validated `final.summary` can be retained under its
separate consent/lease; images, host inputs and raw JSON are outside it.

Source/leaf/Bun-projection checks and one actual wrapper loopback proof are
recorded in [evidence](../reviews/2026-10-18-owned-native-images.md). Real account
login/catalog/inference, actual UI image flows, actual whole Bun/ToolJournal/main HTTP integration passed1/40 with a fake leaf;
root TS18:30/renderer TS18:29, renderer195/plainCLI638/exact `.9` and final
module-map/paths passed at 18:32. Source commit/CI remain pending.

Status 2026-10-21: the batch was committed as `70ffe3b` and reached `main` with the
adoption stack (`296addd`, CI passed). Real-account image input has since passed in
installed `.13`: a direct PNG-only vision task on 2026-10-19 and, on 2026-10-20 at
about 00:59 UTC, an approved `skill-resource/read` PNG tool result carried into the
Native continuation, whose final matched a withheld expected answer
([acceptance](/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/native-login-20261020/p16-native-consumer/skill-resource-image/independent-final-acceptance.json)).
The two-image/160 KiB binding budget is unchanged, and real file-upload correlation
remains untested.
