# Native stages, bounded concurrency and terminal release

Native Agent tasks previously accepted only one worker even though the shared
account server admitted two subscriptions. Increasing the task bound alone
would leave completed stage subscriptions loaded and prevent a third, dependent
stage from starting. This batch changes both boundaries together.

## Resulting behavior

Qualified model metadata advertises optional `maxConcurrent` (one or two).
Legacy rows without the field retain one; saved task bounds do not increase.
Exact model/admission capacity is enforced at creation, refresh, scheduling,
provider dispatch and transport claim validation. The account quota is still
shared with other tasks and retained conversations; monetary accounting remains
unknown and `maxSpend` remains null.

The real task form now offers sequence, all-independent and explicit dependency
modes. Dependencies may refer only to earlier stages, so the editor cannot
construct a cycle. A visible plan preview and saved-task view expose the chosen
dependencies. Editing instructions resets the plan to sequence. Only one stage
is edited at a time, avoiding a quadratic number of mounted checkboxes for large
plans. The default worker count remains one. A catalog downgrade resets an
unsupported draft count to one without modifying existing tasks.

The main bridge recognizes only the fixed, schema-valid semantic final branch.
It retains the canonical result, joins the original offer operation, retires the
exact binding and awaits physical subscription closure before publishing task
completion. Tool and user waits retain their continuation binding. Failed
retirement preserves an unknown held owner and canonical leaf evidence; it does
not send another offer. The intermediate cleanup projection cannot replace a
pending terminal-release result with a false unknown.

The task form and run hint now identify Native Codex correctly instead of
calling it the Responses provider. Task detail shows its saved worker bound,
independently of the model currently selected in the new-task form.

## Focused verification

Pinned Bun 1.4.0; **seven cases, 252 assertions passed**:

- Four new multiworker cases (37 assertions): two overlapping fixture
  subscriptions in one real task runtime, exact closure before a fresh third
  fan-in stage, retained tool/user continuations, held unknown unload, and strict
  capability/default/downgrade checks.
- Three affected retained cases (215 assertions): main bridge ownership,
  private HTTP durable claims, and account-server transport. The last explicitly
  observes acknowledged/held after unsubscribe ACK and requires the exact
  `thread/closed` event before completed; later invalidation does not unsubscribe
  twice.
- Core TypeScript passed. Final renderer TypeScript and build passed (222
  modules, 1.14 seconds). Static independent frontend and backend review
  completed; the frontend catalog-downgrade finding was fixed.
- Actual CUA used the real `AgentModeSurface` and styles in an offline Electron
  fixture with only its API replaced. The form created one synthetic Goal with
  `maxConcurrent:2`, two dependency-free roots and a third stage depending on
  both. The retained create payload and visible task detail agree. A subsequent
  catalog downgrade changed the draft count from two to disabled one. Reloading
  the final renderer showed the corrected Native caption. The fixture quit
  normally; PID33929 is absent. Native, network and tool calls were zero.

Those checks are transport/runtime fixtures and a real UI check. A subsequent
[real Native Goal](2026-10-19-native-semantic-goal.md) supplied controlled
overlapping-root, fan-in and substantive-correction evidence, and exposed a
separate concurrent MCP-discovery defect fixed in that follow-up. It does not
establish arbitrary business outcomes or installed acceptance. The installed
profile's postponed human sign-in is separate.

Raw local UI evidence is retained under
`/Users/alex/Documents/ChatGPT/Nekodex/reviews/evidence/native-integrated-20261019/native-dependencies-ui-fixture/`.
This source batch has not been packaged or installed. The previously installed
`.9` application and its deferred `.8` core activation remain separate states.
