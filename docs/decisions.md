---
type: Design
title: Design decisions
description: Why pr-policy is a suite behind one check-run, why the verdict is mirrored to a commit status, why it is read-only and separate from merge-safety, how the CI approval label is reconciled, why a PR waiting on sign-off is pending rather than red, how the title rules treat `!`, labels, and CI changes, why a dependency major is breaking unless a person waives it, why an own-CI change is never forced to ci, why the UAT gate lives here and classifies on its own since pr-lifecycle was retired, why the uat-label check and the tested alias were dropped, why tests and refactors are UAT-exempt, how a repo turns it off, who can sign off, why `UAT passed` is bound to the head and `no UAT needed` isn't, why a blocking label holds from any actor, why the merge target is policy, why Dependabot PRs are checked against their own description, and the questions still open.
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
[the UAT gate](#uat-is-a-hard-gate-here). This package writes only the one label
it owns outright, `CI approval needed`.

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
  ignores it. The trigger alone decides this. See
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
[holds by default](checks/uat.md). It never writes a UAT label.

Static rules **only exempt** a PR from UAT, never require it. Requiring UAT is
a judgment the session driving the PR makes and expresses through the labels.

### pr-policy classifies on its own

Until pr-policy v3 dropped it, pr-lifecycle decided which sign-off each head needed
and posted it as a `pr-lifecycle/sign-off` commit status, which the `uat` and
`ci-change` checks trusted over their own classification (rmartz/pr-policy#89,
rmartz/pr-policy#109). The fleet retired pr-lifecycle: each PR is now driven by the agent
session that opened it, which self-reviews, tests, and applies the UAT label
itself. So the status path, and the `--sign-off-status-creators` trust list it
needed, were removed, and the checks' own classification is the only path.

The opposite direction, rmartz/pr-policy#85, would have removed the fallback
and made the status mandatory. It was closed in favour of this.

Two things went with it:

- **The `uat-label` check.** It held a PR with no UAT label, which only worked
  while pr-lifecycle kept exactly one on every PR. Nothing does now, and the
  `uat` gate already holds a PR that needs a sign-off and lacks one.
- **`escalation needed` as a blocking label.** pr-lifecycle was its only writer.

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

### `UAT passed` doesn't survive a new head

A new head needs a person to look again. `UAT passed` counts only when it was
applied after the current head was pushed (rmartz/pr-policy#85). That holds even
for a clean rebase: an approval judges the diff, but UAT judges the running
code, and a rebase changes the code it runs with.

The push time must be one the author can't forge, so it comes from GitHub's own
records (the force-push event and the head's earliest check suite), never a
commit date. Like who applied a label, when they applied it is a fact about the
label on the PR now, so the rule stays inside "content, not history". See
[checks/uat.md](checks/uat.md#uat-passed-is-bound-to-the-head).

### `no UAT needed` isn't bound to the head

A waiver judges what kind of change the PR is (a bug fix the session tested
itself, a change with nothing user-facing), not the code it runs. A push that
keeps the PR that kind of change leaves the judgment true, and re-applying the
label after every fix push would be noise. pr-lifecycle used to strip a stale
waiver; now the session that drives the PR, which applied the label, removes it
if a later push makes the change one a person must test. Binding it to the head
would be a gate-model change, not part of removing pr-lifecycle.

### `tested` was dropped with pr-lifecycle

`tested` was read as an alias of `UAT passed` while pr-lifecycle renamed it
across the fleet. With pr-lifecycle retired nothing writes it, and the session
applies `UAT passed` directly. The major release that removed the status path
was the cheapest point to drop it: a PR that still carries only `tested` waits
for `UAT passed`, which a head-bound sign-off needs after any push anyway.

## Open

No questions are open.
