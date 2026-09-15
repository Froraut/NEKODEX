# Isolated ChatGPT accounts and task routing

Implemented in the development source branch. The existing default account keeps
its original Electron partition. Additional accounts receive internally generated
UUIDs and separate persistent Electron partitions; cookie storage remains managed
by Electron. The private registry contains only labels, IDs, enabled flags, selected
account and routing mode, with strict validation and atomic writes. No credentials
are stored in that metadata or copied between profiles.

Settings → ChatGPT accounts supports adding/selecting accounts, explicit embedded
sign-in, checking account model capabilities, checking the configured connector,
and enabling accounts for new work. Selected-account mode preserves the existing
primary workflow. Balanced mode chooses the least busy eligible account, including
pending starts in its load count. The configured global browser limit applies across
accounts, including admission against retained tab capacity. It is not multiplied
by the number of accounts.

Native task identity and retained conversation keys acquire persistent account
bindings before asynchronous browser acquisition. Heartbeats, termination, manual
retries, and terminal receipts resolve their original owner independently of the
visible UI account. Disabled accounts receive no new unbound work; already bound
tasks can finish there. There is no cross-account retry after a failed acquisition
or send. A missing retained conversation fails rather than starting on another
account. Changing model availability does not authorize a silent model fallback.

The root launcher descriptor advertises the exact owned targets from all account
hosts. Account-specific inspection uses its own descriptor and validated UUID-derived
partition. Existing loopback/token checks and exact browser target ownership remain.
Main-process IPC remains guarded by the renderer sender check. Login receives an
explicit account ID so a later UI selection cannot silently redirect authentication.

## Verification performed

- Actual Electron/Vite DEV launch on port 4183 with disposable profile
  `/tmp/codex-web-multi-account-20260915` displayed the new settings and persisted
  a second account. The initial add exposed reentrant host creation through a
  state notification. A construction guard was added; the restarted development
  app showed both saved accounts, with the second selected. The two descriptor
  files identified distinct partitions and one owned home surface each.
- Focused manual review found and corrected duplicate counting of active startup
  reservations, a total-tab allocation race, Manual-mode retry reassignment, and
  lost routing for repeated completion receipts.
- Two focused Node tests passed in about 40 ms. Synthetic browser hosts exercise
  concurrent admission, global tab bounds, task affinity after selection/enable
  changes, and manual start/completion retries. They do not log into ChatGPT or
  prove account-backed browser execution. No full suite or account load test ran.
- The explicit-account login refinement received manual review after those checks.

## Operational boundaries

Additional accounts use their own embedded sign-in flow. Existing Chrome and
external passkey session import remain restricted to the primary profile. The
account's connector must be available and checked before new tool tasks route to
that additional account. Capability/connector checks are runtime evidence, not
trusted persisted login flags; connector checks must be renewed after a restart.
The existing configured model catalog still determines which Web modes Codex offers.

Manual mode uses the visible selected account for new submissions; it does not
silently distribute a prompt the user is expected to paste and send. Account
selection and sign-in are available, but automatic account inspection is still
prohibited in Manual mode by the existing contract.

No second real account was authenticated, no model request was sent by these
checks, and end-to-end balancing across authenticated accounts remains unverified.
No signed release or installed-app replacement was performed. Production account
storage and settings were not changed. Temporary development processes were closed.
