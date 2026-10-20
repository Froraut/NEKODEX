# Selected Python skill: real Native execution on macOS

Source/development version: `6.1.32-nekodex.9`. Installed version remains
`6.1.32-nekodex.8`; no new installation, merge or release is implied.

## Implementation and focused checks

Python is a separate admitted runtime of the existing restricted script owner.
Explicit `.py` selection creates a v4 immutable package with
`text/x-python`/`runtime: python`; older text, image and JavaScript package
identities remain unchanged. Source review, attachment, workspace access and
individual ToolJournal approval remain separate actions. A fixed root-protected
Apple Xcode Python 3.9 closure is pinned without running a child during status.
The fixed `-I -S -B` bootstrap applies Seatbelt before reading/compiling selected
code. See the [execution contract](../design/restricted-skill-scripts.md).

Pinned Bun 1.4.0 validation covered the changed boundaries:

| Check | Result |
| --- | --- |
| Selected Python import, runtime admission gating and existing approval/dedup flow; retained JS resource/provider behavior | 3 tests, 150 assertions passed |
| Actual macOS Python sandbox, immutable code, environment/control FD, timeout/output/cancel reaping and a JS compatibility smoke | 3 tests, 31 assertions passed |
| Actual rendered Python source review/import, unavailable runtime, separate grant, generation/access acknowledgement reset and revoke | 1 test, 61 assertions passed; screenshot inspected |
| Root and renderer TypeScript | Passed |
| Renderer development bundle | 200 modules, 874 ms |
| Plain CLI bundle/version | 674 modules, exact `.9` |
| Scoped Agent workspace IPC check after duplicate-folder label correction | 1 test, 8 assertions passed |

An initial kernel test exposed fixture cleanup permissions and buffered stdout;
the exact retained owners were reconciled and physically absent before rerun.
Only fixture cleanup/flushing changed. The subsequent focused kernel target
passed and cleaned its own directories. Independent static review found no
remaining substantive issue in the new runtime/authority boundary.

## Real model and artifact

One explicitly prepared synthetic invoice task used the admitted real
`gpt-6.1-sol` Native account. The private source contained a reviewed Python
script and two selected JSON rows: 3 × 12.50 and 2 × 7.25. The script was imported,
explicitly attached and granted one disposable output directory. One Goal Run
produced the exact external `skill-script/run` request. The saved identities,
workspace grant and literal output argument were checked before one explicit QA
approval through the supported action owner.

The same ToolJournal executed Python once, with a sealed and reaped supervisor
receipt, exit zero and no truncated output. Its tool result reached a second
Native offer automatically; no manual Step or repeated script was used. Two
canonical completed Native offers share one thread and distinct turn IDs; the
final summary is `PYTHON_INVOICE_READY_52_00`.

The resulting `invoice-summary.csv` contains the two line totals and `TOTAL
52.00`, exactly **88 bytes**, SHA-256
`a1f4ef02af33a78c3710db9138ca036cad4fc29932cea8b9bb585c13d3659ce9`.
An independent file read matched those expected bytes. After an interrupted
development session, no model request was replayed: the ordinary GUI's signed
workspace observer read that same file and linked its SHA property to requirement
`r1`; Review and explicit Verify produced `verified_complete`. These QA actions
were performed by the agent, not personally confirmed by the user. The proof
certifies the declared fixture property, not arbitrary financial correctness.

Two chosen roots originally shared the name `data`; the Agent selector now
discloses the parent directory and short root ID for duplicate names, preserving
opaque IDs and withholding full paths in that IPC projection. The corrected
selection and observation were verified in the actual GUI.

## Retention and remaining scope

The workspace execution grant was revoked, future use of the imported version
was revoked, its source-reading grant was removed and no script operation
remained. Immutable bytes and old-generation references were retained without
purging. Global MCP remained off. The user requested the app remain open;
development app visibility/lifecycle is separate from completed script reaping.
Private canonical journals and QA receipts are not published in this repository.

Shell, PDF/OCR, network resources, general Python distributions/dependencies and
Windows/Linux execution remain separate work. The full 44-item macOS program
and installed acceptance remain open.
