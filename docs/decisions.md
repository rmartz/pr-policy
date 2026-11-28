---
type: Design
title: Design decisions
description: Why pr-policy is a suite behind one check-run, why the verdict is mirrored to a commit status, why it is read-only and separate from merge-safety, how the CI approval label is reconciled, why CI sign-off is needed only for a loosened or changed check and how strictly-stricter edits and shipped reusable workflows are judged, why a PR waiting on sign-off is pending rather than red, how the title rules treat `!`, labels, and CI changes, why a dependency major is breaking unless a person waives it, why an own-CI change is never forced to ci, why the UAT gate lives here and classifies on its own since the PR automation was retired, why the uat-label check and the tested alias were dropped, why tests and refactors are UAT-exempt, how a repo turns it off, who can sign off, why both UAT sign-offs are bound to the head, why pr-policy writes a UAT needed label, why a blocking label holds from any actor, why the merge target is policy, why Dependabot PRs are checked against their own description, why auto-merge is bound to the change it was armed on and recorded in a marker comment, and the questions still open.
tags: [pr-policy, design, decisions]
---

# Design decisions

When a question below is settled, move it to the decided list and trim the
discussion.

## Decided

### A suite behind one check-run

The unifying property is **a deterministic fact about a PR's own content** that
today reaches a merge gate through an agent turn or an ad-hoc script. The first
two checks are CI-change classification and title-type rules. Every check reports
into one `pr-policy` check-run, so the required-status contract is set once and
never grows. See [check-run-contract.md](check-run-contract.md).

### Read-only

Overwriting labels another party owns (verdict labels, UAT labels) is a larger
trust grant than reporting. Reading a UAT label to gate the merge is not; see
[the UAT gate](#uat-is-a-hard-gate-here). This package writes only the two
labels it owns outright, `CI approval needed` and
[`UAT needed`](#pr-policy-labels-prs-waiting-for-uat), and its own
[auto-merge arm marker](#auto-merge-is-bound-to-the-change-it-was-armed-on)
comment.

### Title rules block; they never rename

The squash merge uses the PR title, so the title is the commit subject that
reaches `main`. Native auto-merge has no merge-time step that could rewrite it, and renaming the PR here would rewrite author-owned
text and re-trigger CI. So the title check stays
red until the author (or `/fix-review`) fixes the title. See
[checks/title.md](checks/title.md).

### Not part of merge-safety

1. **Dependencies.** CI classification needs a YAML parser, and merge-safety has
   no runtime dependencies by design.
2. **Different kind of red.** A merge-safety red clears itself (rebase, resolve,
   wait). A CI-loosening red waits on a person. Changing what the frozen
   `merge-safety` check means would be a fleet-wide semantic change.
3. **Different subject.** merge-safety judges whether a PR is still safe as its
   base moves. This judges the PR's own current state, including which branch
   it targets (see [below](#the-merge-target-is-policy)).

### The verdict is mirrored to a commit status

A `GITHUB_TOKEN` check-run can land in a superseded check suite, which the merge
gate ignores while it still reads green. So every verdict also sets a
`pr-policy` commit status, following rmartz/merge-safety#74. The check-run
stays, so the name and the "one check-run" contract are unchanged. A failed
status only warns, so a caller that hasn't granted `statuses: write` loses the
mirror, not the check. See
[check-run-contract.md](check-run-contract.md#the-commit-status-is-what-the-gate-relies-on).

### Distributed as a package plus a composite Action

See [distribution.md](distribution.md). The composite-Action wrapper follows
the same pattern as `repo-hygiene-action` and `bot-automerge-action`.

### The CI approval label and `/review`

The [`ci-change` check](checks/ci-change.md) follows two policies:

- **Label removal:** reconcile `CI approval needed` to the current head while no
  one has signed off. Never remove it once `CI change approved` is present; it
  stays as the audit record. A loosening pushed _after_ sign-off is still
  covered by it, because the gate reads the label; the check's findings still
  show it. Closing that gap is a gate-model change, not a change here.
- **`/review` defers entirely** for the classification, and now for title
  typing too (the title check owns `ci`-typing and the breaking-marker rules).
  The composition judgment that a loosening must stand alone stays with the
  review.

### CI sign-off only for a loosened or changed check

The fleet's CI sign-off rule asks for `CI change approved` only when a change
loosens CI or changes what an existing check enforces. A new check, or an
existing one made strictly stricter, is a strengthening and needs none, even in
a PR that also changes product code. So
the [`ci-change` check](checks/ci-change.md) holds on a loosening or ambiguous
indicator and passes a strengthening, whatever else the PR touches.

Telling "stricter" from "different" is the hard part, and the check only claims
what a workflow diff can show:

- **Additions are structural.** A new workflow, job, step, or matrix entry adds
  a check; the containment backstop proves it. Containment also passes a field
  an existing job or step gained, such as `working-directory:`, which is a gap
  (rmartz/pr-policy#134).
- **Stricter edits come from a closed vocabulary.** A lowered `max-warnings`,
  a raised `fail-under`, `strict` turned on, a lowered `timeout-minutes`. The
  list is explicit because names lie: `--min-severity` raised reports fewer
  issues, and `--max-depth` lowered scans less. A bound outside the list holds,
  whichever way it moved. So does a known bound added where there was none:
  the value in force before (a tool default or config file) is unknown.
- **A known direction names a loosening.** The same vocabulary that proves a
  bound tightened proves one loosened or removed (`threshold-loosened`), a
  strict switch turned off (`strict-disabled`), and a timeout raised
  (`timeout-raised`). These are loosening indicators, not ambiguous ones.
- **A swallowed failure is a loosening.** A command that gains an `||`, an
  `exit 0` (anywhere, including `then exit 0`), or a `set +e` /
  `set +o errexit` can now succeed when a check in it fails, so it is
  `failure-ignored` and holds even on a shipped workflow. Any `||` counts, not
  only `|| true` (`|| /bin/true` swallows just as well), except one whose right
  side still fails: `|| exit N` or `|| return N` with N from 1 to 9, or
  `|| false`.
- **A pure append adds a check.** A command that is exactly the base, then
  `&&` and one simple command, still runs the base and still fails the step,
  so it passes as `check-appended`. Anything after that command (a new line,
  `;`, `&`, grouping) may decide the status instead, and holds.
- **Anything else holds.** A rewritten command, a swapped action, or a changed
  or removed input may tighten or loosen, and a diff can't say which. A false
  hold costs one label; a false pass skips the sign-off.
- **A command is compared word by word.** A `run:` value is opaque shell with
  no tree to compare, so after the YAML is parsed it is split into words (a
  line break is a word). That is why only the base plus vocabulary edits, or a
  pure `&&` append, pass: it is a parsed value, not diff text.

A `with:` input an existing step gains passes, like every other field an
existing step gains, unless it is a known bound: a new `max-lines` may raise
the value the action defaulted to, so it holds. Holding every gained input
would cost a label on maintenance such as `cache: pnpm` on
`actions/setup-node`, while a gained `working-directory:` still passed, so
gained inputs are treated like every other gained field. The remaining gap for
all of them is rmartz/pr-policy#134.

Thresholds outside `.github/workflows/**`, such as a repo-hygiene file cap, are
outside this check's input, so a change to them is never gated here. Widening
the input would mean reading and comparing each tool's config format.

A shipped reusable workflow (`workflow_call` only, on every side that exists)
is product code, so only its loosening holds: loosening it still needs the
sign-off unless the change was expressly requested. Its ambiguous edits don't
hold, which accepts a gap: a loosening seen only as ambiguous, like an `if:`
rewritten to match less, passes there. Holding them would gate every product
edit to the workflow. Every loosening the classifier can read still holds.

An expressly requested CI change needs nothing from pr-policy (see
[`CI change approved`](check-run-contract.md#ci-change-approved-the-human-sign-off)).

The command comparison has known limits that only matter on a shipped
workflow, where `check-changed` passes: a repeated or commented-out flag, a
removed `set -e`, a new pipe under the default shell, and the identity of a
multi-line script that starts with `set …`. They are tracked in
rmartz/pr-policy#136. Each one only holds less on a shipped workflow, so they
were accepted, documented, rather than holding the whole change back.

### Waiting on a sign-off is pending, not red

Findings carry an effect: `block`, `hold`, or `info`. An unsigned CI loosening
is a `hold`, so `pr-policy` is posted `in_progress` (pending) while the PR waits
for `CI change approved`. Red is reserved for problems the author can fix, like
a bad title.

A `failure` would read as a broken build and send the PR round a fix pass that
can't clear a human gate. A `neutral` conclusion avoids the red, but it
**passes** a required check, which would let the loosening merge unsigned. Pending avoids both: it reads as waiting, and a
required check that isn't complete still holds the merge.

### Title rules: `!`, labels, and what counts as CI

The title check expresses the `!` ↔ label reconciliation as findings rather
than a rewrite: a functional title's `!` must agree
with `breaking change` / `hotfix` in both directions, and `breaking change` on a
non-functional type blocks. release-please release PRs are exempt.

Only a **substantive** workflow change counts as CI. A pure
action-pin bump or comment-only edit keeps its Dependabot `chore` type.
Otherwise every Dependabot `github-actions` PR in the fleet would be flagged, and
the checklist deliberately gives those PRs `chore`.

### A dependency major is breaking unless a person waives it

merge-safety reads a PR's breaking status from its title's `!` alone
(rmartz/merge-safety#85). Deciding which PRs need that `!` is title policy, so
the title check owns it: a dependency major bump on a functional type blocks
until the title has `!` and `breaking change`.

The diff can't tell whether a bump reaches consumers, so a person decides. The
waiver is a label, `contained break`, trusted through `signOffState`, because it
is the same kind of judgment as a UAT waiver. The alternatives were weaker:

- Honoring a human's _removal_ of `breaking change` would read the label's
  history, which a content check doesn't read.
- A per-repo list of exempt dependencies bakes in "this wrapper never exposes
  its CLI's majors", which is false the first time the CLI's break leaks through
  an input. A per-PR judgment is right each time.

It stays a `block`, not a `hold`: the author can always clear it by adding the
`!`, so nothing here waits only on a human. This replaces merge-safety's
add-only label, which re-added itself after every human removal
(rmartz/merge-safety#82).

### `docs`, `refactor`, `test`, and `ci` are checked against their paths

A `docs` PR may change only Markdown, a `test` PR only test files and Markdown,
and a `refactor` PR no test file (rmartz/pr-policy#28). A `ci` PR may change
only CI and tooling (rmartz/pr-policy#86). All four block.
Markdown is always docs, so `test` and `refactor` may update docs alongside
their change. A `docs` or
`test` title on code hides the change from the release. A refactor that edits
its own tests removes the evidence that behaviour is unchanged, so coverage
lands first as a `test:` PR. The strictness is deliberate: a refactor that must
update test imports is split too. The rules read the changed paths, plus both
sides of a changed workflow or manifest, so they stay content-only.

The `ci` rule allows the repo's own `scripts/**`, because a replay of 283 fleet
`ci:` PRs found those changes were always repo tooling (audits, CI checks,
release helpers). It keeps blocking `package.json` fields outside the
dependency blocks and build or deploy config (`vercel.json`, `tsconfig.json`):
each decides what is built, published, or deployed, so it can change what ships.

The `ci` rule exists because the review treats these four types as needing no
UAT, the `uat` check exempts `refactor`, and the author picks the title. An
unchecked type would be a way around UAT, so the exemption is only as strong as
these rules. The `ci` rule and
the UAT trivial-path rules read one module (`src/checks/path-kinds.ts`), so they
can't drift.

### `chore` is left to the review

`chore` claims the PR changes no behaviour, and that is a judgement about
content that no path list captures. Moving modules from a horizontal to a
vertical layout touches only source and changes nothing; a one-line config edit
can change everything. A static rule would either block honest chores or pass
dishonest ones, so the review judges it. The consequence is that a `chore`
title can't exempt a PR from UAT: the `uat` check judges it by the trivial-path
rules, like `feat` or `fix`, and leaves the rest to the review. Those rules
exempt every non-product path, CI and tooling included, so a `chore` that only
touches the repo's tooling needs no UAT.

### An own-CI change is never forced to `ci`

In an action or reusable-workflow repo the workflow is the product. Forcing a
workflow change to `ci` would suppress its release, and requiring
`breaking change` would cut a spurious major. So:

- A `workflow_call`-only workflow is shipped product code, and the title check
  ignores it. The `ci-change` check holds only on its loosening. The trigger
  alone decides this. See
  [checks/title.md](checks/title.md).
- The coordinator's sibling-rebase signal is path-based, so the `ci` type
  doesn't need to carry it. An own-CI change on a non-release type gets an
  `info` recommendation, never a block, and never needs `breaking change`.
- A release type is never told to retitle to `ci`. This covers the
  linter/formatter-bump rule too.

### UAT is a hard gate here

pr-policy enforces the hard gates a PR must pass before it merges
(rmartz/pr-policy#13). An armed PR waits on the required `pr-policy` check until
every gate is satisfied, so the UAT gate is a check that
[holds by default](checks/uat.md). It never writes a UAT sign-off label.

Static rules **only exempt** a PR from UAT, never require it. Requiring UAT is
a judgment the session driving the PR makes and expresses through the labels.

### pr-policy classifies on its own

Until pr-policy v3 dropped it, the retired PR automation decided which sign-off
each head needed and posted it as a sign-off commit status, which the `uat` and
`ci-change` checks trusted over their own classification (rmartz/pr-policy#89,
rmartz/pr-policy#109). The fleet retired that automation: each PR is now driven
by the agent session that opened it, which self-reviews, tests, and applies the
UAT label itself. So the status path, and the `--sign-off-status-creators` trust list it
needed, were removed, and the checks' own classification is the only path.

The opposite direction, rmartz/pr-policy#85, would have removed the fallback
and made the status mandatory. It was closed in favour of this.

Two things went with it:

- **The `uat-label` check.** It held a PR with no UAT label, which only worked
  while the retired PR automation kept exactly one on every PR. Nothing does
  now, and the `uat` gate already holds a PR that needs a sign-off and lacks one.
- **`escalation needed` as a blocking label.** The retired PR automation was its
  only writer.

`CI approval needed` is unchanged: this package always wrote it while no status
was present, and now always does.

### UAT is only for the product's user-facing behaviour

UAT is exclusively for the repository's **product's user-facing functional
behaviour**: what the product's users can observe it do. Nothing else needs it,
so a PR that can't change that has nothing to test. Tooling is never
user-facing. **CI is the clearest example:** a workflow, a composite action, a
repo script under `scripts/`, or lint, formatter, test-runner, or repo-hygiene
config changes how the repo is built and checked, not what its users see.
Whether such a change weakens a check is a CI-governance question. The review
and the [CI sign-off](checks/ci-change.md) answer it, never UAT. "It can change
what a check lets through" is therefore no reason to hold a PR for UAT.

Don't hold CI scripts or lint config for UAT because they "can change what a
check lets through": that conflates CI governance with user acceptance.

The exemptions on that ground:

- **Docs, CI, tooling, dependency pins, and repo metadata,** by path (the
  [trivial-PR rules](checks/uat.md#trivial-prs)).
- **Test-only changes,** including Storybook stories. A test locks in behaviour
  without changing it, and a story never ships in the app.
- **Refactors,** judged by the `refactor` title type rather than by paths. The
  title is the one signal of intent the paths can't give, and it is safe to
  trust here: the title check blocks a `refactor` that touches a test, and a
  behaviour change mislabeled `refactor` would also lose its release. It is
  still current content, so it stays inside "content, not history".

### A repo without UAT turns the gate off in its caller

Some repos choose not to run UAT, this one included. That's a decision, not a
claim that there is nothing to test: the library and Action this repo ships are
user-facing to their consumers. Without the switch, every non-trivial PR in such
a repo would wait on a `no UAT needed` label that says nothing. Such a repo runs the suite with `skipUat` (`--skip-uat`), set in its caller
workflow. The option lives with the caller, not in a file in the repo: a
`pull_request_target` caller runs from the base branch, so a PR can't switch off
a gate it would otherwise wait on. Options default to the strictest policy, and
a skipped check is left out entirely rather than reported as passed.

### Who applied a sign-off is current state, not history

A label records nobody, so trusting one means reading its latest `labeled`
event. That is a fact about the label on the PR now, not about the PR's review
history. It is the same kind of fact the label itself is, so it stays inside
"content, not history". A sign-off counts only from a `User` with write,
maintain, or admin permission, which is someone who could merge the PR anyway.
The rule lives in one place (`src/sign-off.ts`) and applies to both gates:

- **UAT:** it rejects a bot or a triage user applying `UAT passed` or
  `no UAT needed`. Agents act with the user's token, so the review agent's
  `no UAT needed` passes, as intended. That `UAT passed` is human-only stays a
  convention.
- **CI:** `CI change approved` gets the same check. Before, any label event
  cleared the gate, so a bot or triage user could sign off a loosening. An
  untrusted approval no longer freezes `CI approval needed` either.

A failed label-event read throws instead of holding, so the run fails loudly
rather than reporting a misleading "nobody applied it". A failed permission
lookup (a non-collaborator's 404) is `none`, so the gate fails closed.

### A blocking label holds, from anyone

`do not merge`, `dnm`, and `blocked` are enforced here because `pr-policy` is
the one required check every merge path waits on, so neither a person nor
auto-merge can merge past them. The label is a fact about the PR's current state, so it fits "content,
not history".

It is a `hold`, not a `block`: a person put the label on, and only a person
taking it off clears it. It is not read through `signOffState`, because it only
adds a gate. Honoring an untrusted actor's label fails safe. See
[checks/merge-block.md](checks/merge-block.md).

### Dependabot PRs are checked against their own description

`bot-automerge` merges Dependabot PRs unreviewed, so the `dependabot` check
verifies that a PR changes only what its description claims (rmartz/pr-policy#19).
That makes the description, and the PR's author, check input for the first
time. Both are current state, so they stay inside "content, not history". The
author only decides whether the check applies.

- **The claim comes from the body, not the title.** Review agents retitle
  Dependabot PRs; nothing rewrites the body. `pr-policy` runs on `edited`, so a
  body edit is re-checked.
- **A mismatch is a `block`.** Recreating the PR, or dropping the foreign
  commit, clears it. Nothing waits on a person, so it is not a `hold`.
- **Unverifiable files are `info`, not `hold`.** Lockfiles and other
  ecosystems' manifests are allowed but not yet read. A `hold` needs a human act
  that clears it, and there is no sign-off label for "I checked this lockfile".
  Adding one would be a contract change for a gap the lockfile follow-up will
  close. Until then the finding says plainly what wasn't verified.

See [checks/dependabot.md](checks/dependabot.md).

### The merge target is policy

Which branch a PR may merge into was merge-safety's stacked-base barrier. It
moved here because it is policy, not safety: it doesn't change as the base
moves, and the rule is the fleet's workflow choice, not a hazard. The base
branch, and the open PRs heading it, are current state, so the rule stays
inside "content, not history".

The policy changed as it moved:

- **Only `epic` accumulates.** merge-safety exempted children of a base PR
  labelled `release` or `epic`, from a caller input. Here a non-epic PR may
  merge into an epic's branch, and nothing else is exempt. The label is a
  contract name, not an input: every repo stacks the same way.
- **An epic never merges into another epic.** Stacked epics land on the default
  branch one at a time, from the bottom up, so each is reviewed and released
  on its own.
- **A base no open PR heads blocks.** merge-safety let it through, since nothing
  would ever release it. Here it is a `block`: the fix is a retarget, which the
  author can make. A stacked PR still waiting on its base is a `hold`.

merge-safety has since removed its barrier (rmartz/merge-safety#80), so this
check is the only one. See [checks/base-branch.md](checks/base-branch.md).

### UAT sign-offs don't survive a new head

A new head needs testing again. `UAT passed` and `no UAT needed` each count only
when applied after the current head was pushed (rmartz/pr-policy#87 for
`UAT passed`). That holds even for a clean rebase: an approval judges the diff,
but UAT judges the running code, and a rebase changes the code it runs with.

`no UAT needed` was first left unbound, as a judgment of what kind of change the
PR is. The retired PR automation stripped a stale waiver, and without it the
session had to remember to remove one. Under the session-driven process the waiver
means the session tested a minor change's current head and recorded the
evidence, which is a statement about the code, like `UAT passed`. Binding it
makes the gate enforce that: a push after the waiver re-holds `uat` until the
session re-tests and re-applies it. PRs that need no UAT carry no label, so
Dependabot and other path- or title-exempt PRs are unaffected.

It ships as a `feat`, not a breaking change, following the precedent of binding
`UAT passed` (rmartz/pr-policy#87). It needs no change in any consumer's code or
config. It only holds more often, and a hold is pending, never red, cleared by
re-applying the label. A major would send every consumer a Dependabot major for
a tightening they don't have to act on.

The push time must be one the author can't forge, so it comes from GitHub's own
records (the force-push event and the head's earliest check suite), never a
commit date. Like who applied a label, when they applied it is a fact about the
label on the PR now, so the rule stays inside "content, not history". See
[checks/uat.md](checks/uat.md#sign-offs-are-bound-to-the-head).

### pr-policy labels PRs waiting for UAT

The retired PR automation kept a visible UAT label on every PR. Without it,
`uat` applies `UAT needed` while it holds a PR for a sign-off and removes it
when the gate passes, so a person can filter for PRs waiting on them. It is reconciled the way
`CI approval needed` is: a label this package owns outright, computed from the
current verdict, so it stays inside "read-only" and "content, not history". It
isn't an audit record, so unlike `CI approval needed` it comes off on sign-off.

A draft never carries it: a draft isn't ready for UAT, and the caller already
re-runs on the draft flip, so skipping drafts costs one condition. The gate still
holds a draft; only the label waits. See
[checks/uat.md](checks/uat.md#uat-needed-marks-prs-waiting-for-a-sign-off).

### `tested` was dropped with the retired PR automation

`tested` was read as an alias of `UAT passed` while the retired PR automation
renamed it across the fleet. With that automation gone nothing writes it, and
the session applies `UAT passed` directly. The major release that removed the
status path was the cheapest point to drop it: a PR that still carries only `tested` waits
for `UAT passed`, which a head-bound sign-off needs after any push anyway.

### Auto-merge is bound to the change it was armed on

GitHub keeps auto-merge enabled across new pushes, so a review fix or conflict
resolution pushed after arming would merge with no new review. The
[`auto-merge` check](checks/auto-merge.md) fails `pr-policy` when the head that
would merge carries a different change from the head auto-merge was armed on.
It lives here, not in merge-safety, because it judges the PR's own change, not
its safety as the base moves. It sits inside the one required verdict, so no
consumer adds a required check.

- **Same change, not same SHA.** Binding to the SHA would block every branch
  update, and merge-safety asks for those. So the check compares each head's
  merge-base diff without hunk offsets, like a patch-id. Context lines stay in,
  so a moved line counts as a change; a base edit inside a hunk's context then
  blocks too, which fails closed. A clean update or rebase re-arms; anything
  that changes the PR's hunks blocks.
- **A block, not a hold.** The author clears it by disabling and re-enabling
  auto-merge after re-reviewing, so nothing waits only on someone else.
- **Fail closed.** Auto-merge enabled before this check existed, with the head
  moved since, has no record and blocks. That strands nothing: one
  disable-and-re-enable re-arms it.
- **A bot's own PR, armed by a bot, is exempt.** bot-automerge arms by rule
  with its App's token and re-judges every head, and Dependabot rebases
  legitimately move a lockfile. The exemption needs a bot enabler, a bot
  author, and only that bot's verified commits, so a person's fix pushed onto
  a Dependabot PR is guarded. It reads actor types, so no fleet App is named
  here. Commits are PR content, so this stays inside "content, not history".
  The stated limit: it assumes a bot that arms its own PR re-judges every head.
  An agent running as a GitHub App would be exempt; agents that act with the
  user's token are not. A consumer-listed allow-list of enablers was rejected
  for now: empty by default it would guard bot-automerge, whose Dependabot
  rebases legitimately move the change.

**The armed head is current state, recorded.** GitHub records when auto-merge
was enabled but not on which head, so the check keeps its own record: a marker
comment it owns, like the labels it owns. Which head the current auto-merge
request was armed on is a fact about that request, as who applied a label is a
fact about the label, so it stays inside "content, not history". The record is
trusted only unedited and from the bot that posted pr-policy's commit status on
the SHA it records, so neither a user's token nor another App can forge it. A
workflow in the repo shares that identity under the Action and could, but it
could fake the verdict too; the guard targets honest mistakes. A
commit status was rejected because any write user can set one; a check-run
because it can only be found from the very SHA it would record. Auto-merge
enabled strictly after the head was pushed arms on that head without a record,
so a cancelled run rarely matters.

The caller needs `auto_merge_enabled` and `auto_merge_disabled` in its
`pull_request_target` types (see
[distribution.md](distribution.md#caller-triggers)). It ships as a `feat`: a
caller without the new types fails closed, and nothing consumers rely on
changes meaning. The one library-API change, `GitHubClient.send` also taking
`DELETE`, widens a method the package's own clients implement; a caller's
calls are unaffected, so it isn't the real break `!` is reserved for.

The record makes findings depend on more than the diff: the same content can
pass or block depending on when auto-merge was enabled and what pr-policy
recorded. That is accepted for this check alone. Both inputs are current state
of the PR's auto-merge request, and the same facts document still always yields
the same findings.

## Open

No questions are open.
