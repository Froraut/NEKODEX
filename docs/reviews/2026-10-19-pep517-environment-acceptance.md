# Actual offline PEP 517 environment build and use

On 19 October 2026, the real `PythonBuildController` completed Review → Prepare → explicit environment attachment. A second VM imported the prepared CPython C extension and called it successfully. This used the existing macOS VM executor and its user-wide durable authority; no Native sign-in, model offer, GUI, host Python installation, network interface or host directory share was involved.

The selected in-tree PEP 517 backend had `build-system.requires=[]`, `backend-path=["."]` and the standard `get_requires_for_build_wheel` / `build_wheel` hooks. It compiled selected C source with the fixed guest GCC and Python headers, then constructed a wheel with SHA-256 RECORD entries. The product validated the wheel's metadata, RECORD, native ABI, output scope and runtime pins before issuing its process-local environment object. The attachment function supplied the resulting snapshots to a distinct VM execution. That execution explicitly added only its `python-environment` directory to the isolated Python import path.

## Exact observed result

| Boundary | Evidence |
| --- | --- |
| Build action | `d7e79a1d-d093-44d7-aa9b-b13ea23a322f` |
| Build result | stopped; ownerHeld false; exit0; no signal or truncated logs; host-stop-completion |
| Wheel | 72,673 bytes; SHA-256 `f31aa77f317a46e03e8b8d3a14b45849265db1ab38a0c33031289ecdd2e5f5ef` |
| Environment closure | `f73f8f3dafb743be96b48aac7e84d83599e177e6564a39caa8737d1502fb308e` |
| Use action | `e654e44b-2f32-4eee-a7d5-fd99bbd4a6b6` |
| Actual import | `/workspace/python-environment/_nekodex_buildproof.cpython-314-aarch64-linux-musl.so` |
| Actual values | 43 + 59 = **102**; selected marker `PEP517-d8f5b498-3808-4039-807e-6dcd5f89922a` |
| Actual guest | Linux aarch64, CPython3.14.8, UID1000 |
| Independent candidate read | result.json226 bytes; SHA-256 `655ae415b8e2d1bae34944b99b3bc4bb36bd9ac20a030cd5e784d18058571780` |
| Settlement | second run stopped/ownerHeld false/exit0; executor closed, no retained VM owner |

The first synthetic backend attempt `a4578199-7d05-419b-a344-4cfad43e31f1` compiled the extension but failed while writing the ZIP with the guest's pre-1980 clock. Its stopped/ownerHeld false receipt was retained. A separate reviewed attempt fixed the backend's ZIP timestamp to1980 and regular-file mode; the first action was not replayed. This is a fixture correction, not a claim that all third-party backends handle an unset VM clock.

Raw local evidence is retained under `/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/pep517-real-v2/acceptance.json`, with selected sources and independently read result.json. The failed first attempt remains in the sibling `pep517-real` directory. Neither one-use acceptance script should be rerun against its retained intent.

## Production gate correction

This acceptance exposed a separate source defect: the Python controller and product status accepted only `development-linux-vm`, despite the executor already supporting publisher-admitted `production-linux-vm`. Review now accepts either exact runtime kind while retaining the executor's private runtime brand, immutable file pins and the fixed reviewed guest manifest hash. Status uses that same passive check, so a different toolchain or failed executor admission is unavailable before Review.

The focused production-kind regression passed **one case /13 assertions**, including executor refusal, absent runtime and mismatched manifest. Core TypeScript passed. The regression uses an injected trusted port: it establishes the policy and refusal boundary, not an actual signed production launch. The successful real build above used the admitted development artifacts and unchanged reviewed guest image.

## Remaining acceptance boundaries

This proves the controller's actual build, native output validation, attachment snapshots and subsequent VM import. It does not prove the final installed GUI picker/task-generation flow, a signed production VM launch, every external PEP 517 backend, other distributions, arbitrary wheel data schemes or network access. Those remain separate requirements. No new installer was built for this follow-up; the already installed `.9` does not acquire the new source fix automatically.
