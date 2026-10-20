# Offline native C and CPython builds in the development VM

## Result

The fixed Alpine ARM64 development image now contains GCC 15.2.0-r5,
Python/Python headers 3.14.8-r0, musl headers 1.2.6-r2, Make 4.4.1-r4 and
pkgconf 2.5.1-r0 with their locked dependency closure. These are guest programs;
no compiler, Python distribution or package-manager settings were installed into
the user's macOS environment. The VM still has no NIC or host directory shares.

Actual Native/GUI acceptance on 2026-10-19 compiled a C shared library and a
CPython C extension inside one VM, invoked both from Python, compared their
calculation with the selected JSON input, and exported the exact CSV through
the separately approved existing workspace owner. The Goal reached
`verified_complete` after independent file observation and explicit QA verification.

## Producer and provenance

`sources.lock.json` adds one fixed development profile, not a general package
solver. Its 29 additional APK payloads have official Alpine v3.24/main/aarch64
URLs, versions, byte SHA-256, dependencies/provides, licenses, source commits and
source links. The official index capture is pinned as
`9ee5c0674b9b8288f052692423aaba4d06b62a3012a7908b45ad64c221bb3f7b`.
Existing minirootfs providers are retained where their explicit constraints match;
the ambiguous libisl provider is selected explicitly in the lock.

The producer validates this fixed closure and every added APK's `.PKGINFO`, then
extracts payloads without executing package hooks/triggers. Path escapes, parent
symlinks, duplicate entries, case aliases and unexpected collisions fail closed.
The one explicit replacement changes binutils' `usr/bin/strings` over the exact
old BusyBox symlink. Base-installed APK DB entries and additional extracted payloads
are recorded separately; this is not an `apk add` installation claim.

Acquisition assurance is official HTTPS plus exact captured hashes. Independent
APK publisher signature verification was not performed. Production publisher,
licensing/source-offer, update and installed-runtime admission remain separate work.
Alpine's [package documentation](https://wiki.alpinelinux.org/wiki/Apk) describes
the package/repository model; the checked-in lock binds this particular closure.

An isolated `--build-dir` supports preparation before bundle replacement. An
unchanged guest source snapshot and hash-checked Go tree are reused. Manifest
tool versions derive from the same locked profile. No guest program runs on the
host during preparation. The pinned cached host Go builds only the static guest
agent, whose resulting hash is unchanged from the accepted earlier image.

## Exact development evidence

- Guest agent: `1c863003155e9a33f034b4ac5605083aefe84748b8d3cab9edceeebe1b3dbb16`.
- Kernel: `1993474a172566b1573234900ff611c9fa4307b9398742c4c210b1e9664d6e56`.
- New initrd: `5bd9f1559f1fa3270e982ad111992fd46ab4cdfe040e5f90429d6944e69e51a6` (about 134 MiB).
- Canonical guest manifest after path relocation:
  `3234621868c7ba5eeb31d1a29e95c204fa4140f54c5b2c209588ba4c534789e0`.
- Task: `e0aeedc5-54a3-4d0e-b62a-47a8d4eca773`, GPT-6.1-Sol,
  final generation 3 / revision 3, `verified_complete`.
- Exactly one completed VM action: `409dda7f-9031-4127-b992-af1e637ae1cc`;
  operation `35598d9fd77fafe2236ef0e1f6f380372c4b2d09a3f65dcd8b0ebf9a0a26f205`.
- Actual script: `/usr/bin/python3 -I -S build.py`, five explicitly selected
  inputs and two private output candidates. Exit 0, no truncated logs,
  physically stopped with no retained owner, network false / hostShares false.
- Python identified aarch64, UID 1000 and extension suffix
  `.cpython-314-aarch64-linux-musl.so`; both compiled implementations returned 138.
- Compiled C shared-library SHA:
  `1b0cfaed6133eee67957abcc558fd7baf02dfbf2346f40ffd93eedfbe3ee19c6`.
- Compiled CPython extension SHA:
  `17fb678b056e0c29d67d26a9c90ad3f81a39db9870dc6a40f24479acbc9c6926`.
- Private `build-info.json` (317 bytes) was read through the authenticated
  candidate-read boundary and its versions/architecture/UID/hash fields validated.
- Export review: `f4621841-646f-4f7e-8d77-ec24886d3b9e`. Its destination workspace
  was independently checked against the selected canonical test output directory.
- Exported `result.csv`: 71 bytes, SHA
  `e69ef240804430a3598d919ad7c90cdf6f36efe42c9637b0a5666bca3c5060e9`;
  exact source marker `VM-NATIVE-778f4b37-4477-4ea6-8e88-cf179b690daa`, native total 138.

There were five Native offers including one initial invalid fixture instruction
before any VM request. A literal newline mistakenly split the intended stage;
explicit correction fixed the fixture before execution. That first turn is not a
VM or compiler failure. One later stage correction added publication while retaining
the completed build. Neither compilation nor export was replayed.

Focused validation: Python syntax, fixed dependency closure, all 29 added APK
metadata identities, actual candidate image preparation, actual Native/VM/native
build/export/main-file-observer/QA Verify. The later change deriving display
versions from the lock preserves the already generated values; it does not change
the accepted image. Existing protocol, physical stop, export and recovery checks
were reused; no broad suite or unchanged UI battery was rerun.

The core alone was replaced (old GUI stayed open). After acceptance Native was
closed, VM active operations/bindings were empty, and the temporary expanded tree,
duplicate candidate image and superseded image were removed. The current image,
accepted CSV, receipts and exact APK download cache remain available.

## Remaining scope

This proves C shared-library and CPython extension compilation/execution for this
fixed offline Linux ARM64 development profile. It does not prove all C/C++ projects,
arbitrary build systems, pip/setuptools/sdist/PEP508 automation, dependency fetching,
Darwin dylibs/frameworks/Xcode, network grants, production or installed delivery.
Linux native artifacts do not acquire the Apple-Python environment brand.
The final post-export model summary confirmed the written receipt but lacked prior
raw values after the stage revision; the build summary and independent observers
provide the concrete evidence. Long-task semantic context remains separate work.
Full P16/P17 and the rest of the macOS program remain open.
