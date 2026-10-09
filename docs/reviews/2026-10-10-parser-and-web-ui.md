# Codex Desktop reasoning replay and Web answer recovery

Installed locally: **6.1.24-nekodex.1**, code commit `54688c754a67d1c2b4a3c4f6b331f77bcb1fda7c`. No public release assets, tags or new notarization.

## Corrections

- Desktop replays absent optional reasoning fields as null. The parser now accepts those absences while rejecting malformed populated values. Native raw input remains intact. This fixes continuation and post-tool request parsing.
- Thinking models replace their initial response DOM element with the completed answer. The reader now reports a fresh, proven zero locator count as detachment so the existing owner can rebind to the unique accepted replacement. Evaluation errors on present nodes remain failures; an unrelated new user turn cannot supply the replacement.

## Development evidence

Three reasoning replay cases failed before the parser correction and passed afterward. The real prior Desktop file-read history also parses with its successful tool result preserved. Three focused headless-browser cases cover detached-to-completed replacement, rejection of a different user turn, and preservation of present-node evaluation errors. Type checking and version synchronization passed. No full repository suite was run.

## Installed Codex UI acceptance

All requests were selected and submitted in the native Codex interface. Each final check continued an existing conversation, incremented its previous answer, invoked the local terminal to read the same generated control file, then returned the correct number and file contents. Each command exited zero. The file marker was absent from the prompt.

| Selected model | Final number | Continuation + local read | Duration |
| --- | --- | --- | --- |
| `chatgpt-web/gpt-5.6-sol-instant` | 325 | passed | 15.5s |
| `chatgpt-web/gpt-5.6-sol-medium` | 668 | passed | 16.8s |
| `chatgpt-web/gpt-5.6-sol-high` | 1148 | passed | 19.4s |
| `chatgpt-web/gpt-5.6-sol-extra-high` | 1764 | passed | 16.5s |
| `chatgpt-web/gpt-6-pro` | 2492 | passed | 44.6s |

Medium, High and Extra High initially exposed the separate DOM-detachment failure on 6.1.23 despite having correct answers visible in ChatGPT. The final 6.1.24 repeats delivered those answers to Codex (667, 1147, 1763), followed by the successful continuation/tool checks above. Instant's earlier 323 and Pro's 2491 successful replies were retained; their final installed checks returned 325 and 2492 after reading the file.

Raw local evidence, containing host paths and task identifiers, is retained outside Git at `/Users/alex/.codex/tmp/nekodex-6124-ui-acceptance.json`. Account configuration, existing restricted key and connector were preserved.
