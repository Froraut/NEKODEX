# Hermes model-forwarding compatibility

`codex-model-forwarding.patch` is a narrow compatibility patch for the installed Hermes runtime
inspected at commits `5eb99eb284` and `1782bf79c8`. It forwards Hermes' selected model in the native Codex
`turn/start` request; it does not change tool permissions, credentials or provider endpoints.

The launcher's packaged copy is `launcher/electron/hermes-model-forwarding.patch`. Keep the two
copies identical when updating compatibility. The installer checks the patch, backs up affected
source files and refuses mismatching versions. It can detect an already applied patch.

The original Hermes code belongs to Nous Research and its contributors under the Hermes
repository's MIT license. This patch is maintained by FroRaut as part of the Codex Web GPT fork.
It is not an upstream-merged Hermes change. A future Hermes update may require reapplication or
an updated compatibility patch.

## Manual update checks under GitHub API rate limits

`manual-update-rate-limit.patch` repairs a separate Hermes Desktop failure observed on
`1782bf79c8`: the GitHub API tip request returns HTTP 403 and the manual update check stops,
although Git transport can still query the public branch. The patch preserves passive API
polling and its existing cache. Only an explicit check may fall back on HTTP 403/429 to one
`git ls-remote` query, with a 60-second subprocess deadline. It downloads no pack and keeps
the count unknown when the remote commit is not in the local graph. Failed fallback remains
an error. A focused behavior test covers passive isolation, manual recovery and both failures.

The installed Hermes Desktop was rebuilt locally with this patch. It is deliberately separate
from model-provider setup; adding a provider does not silently rebuild another desktop app.
To reapply after a Hermes update has completed, check the current source first:

```sh
git -C "$HERMES_CHECKOUT" apply --check "$PATCH_DIRECTORY/manual-update-rate-limit.patch"
git -C "$HERMES_CHECKOUT" apply "$PATCH_DIRECTORY/manual-update-rate-limit.patch"
hermes gui --build-only
```

Set the two paths to the inspected Hermes checkout and this directory. Quit Hermes normally
before rebuilding and launch it once afterward. If `--check` fails, inspect the new upstream
implementation instead of forcing the patch. Hermes Desktop's updater uses `--keep-stash`,
so local source fixes can be parked during updates. These patches are not an upstream merge
or a guarantee that future Hermes builds retain them; the originals remain in the updater's
stash and the reviewed changes remain in this maintained repository.
