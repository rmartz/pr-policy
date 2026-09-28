---
type: Design
title: Design decisions
description: Why pr-policy is a suite behind one check-run, why it is read-only and separate from merge-safety and pr-lifecycle, what carried over from ci-change-guard, why a PR waiting on sign-off is pending rather than red, the title-rule port, why an own-CI change is never forced to ci, why the UAT gate lives here and who can sign off, and the questions still open.
tags: [pr-policy, design, decisions]
---

# Design decisions

Recorded from **rmartz/ai-tools#302** and its comment thread. When a question
below is settled, move it to the decided list and trim the discussion.

## Decided

### A suite behind one check-run

The unifying property is **a deterministic fact about a PR's own content** that
today reaches a merge gate through an agent turn or an ad-hoc script. The first
two checks are CI-change classification and title-type rules. Every check reports
into one `pr-policy` check-run, so the required-status contract is set once and
never grows. See [check-run-contract.md](check-run-contract.md).

### Read-only: the reconcilers live in pr-lifecycle

Overwriting labels another party owns (verdict labels, UAT labels, approval
freshness) is a larger trust grant than reporting. Reading a UAT label to gate
the merge is not; see [the UAT gate](#uat-is-a-hard-gate-here-the-lifecycle-stays-in-pr-lifecycle). Those reconcilers live in
`rmartz/pr-lifecycle` (rmartz/ai-tools#306). This package writes only labels it
owns outright, and neither package reads the other's outputs.

### Title rules block; they never rename

The squash merge uses the PR title, so the title is the commit subject that
reaches `main`. Today `merge-pr.py` rewrites it at merge time. Once pr-lifecycle
arms native auto-merge, no merge-time step is left to do that. Renaming the PR
here would rewrite author-owned text and re-trigger CI. So the title check stays
red until the author (or `/fix-review`) fixes the title. See
[checks/title.md](checks/title.md).

### Not part of merge-safety

1. **Dependencies.** CI classification needs a YAML parser, and merge-safety has
   no runtime dependencies by design.
2. **Different kind of red.** A merge-safety red clears itself (rebase, resolve,
   wait). A CI-loosening red waits on a person. Changing what the frozen
   `merge-safety` check means would be a fleet-wide semantic change.
3. **Different subject.** merge-safety judges a PR's relation to its base. This
   judges the PR's own content.

### Distributed as a package plus a composite Action

See [distribution.md](distribution.md). The composite-Action wrapper follows
`repo-hygiene-action` and `bot-automerge-action`, which replaced the fleet's
reusable workflows.

### CI-change check ported from ci-change-guard

`rmartz/ci-change-guard` was scaffolded for check 1 before #302 was rescoped
into this suite. Its classifier and per-rule tests were ported here as the
[`ci-change` check](checks/ci-change.md), and that repo is retired. Its settled
policies carried over:

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

This replaced an interim design where an unsigned loosening posted `failure`.
Red read as a broken build, and would have sent the PR round a fix pass that
can't clear a human gate. `ci-change-guard` had avoided that with `neutral`,
but a `neutral` conclusion **passes** a required check, which would have let the
loosening merge unsigned. Pending avoids both: it reads as waiting, and a
required check that isn't complete still holds the merge.

### Title rules: what was ported, and one deliberate difference

The title check ports dotfiles' predicate, with the `!` ↔ label reconciliation
expressed as findings rather than a rewrite: a functional title's `!` must agree
with `breaking change` / `hotfix` in both directions, and `breaking change` on a
non-functional type blocks. release-please release PRs are exempt.

The difference: only a **substantive** workflow change counts as CI. A pure
action-pin bump or comment-only edit keeps its Dependabot `chore` type.
Otherwise every Dependabot `github-actions` PR in the fleet would be flagged, and
the checklist deliberately gives those PRs `chore`.

### An own-CI change is never forced to `ci`

The title check used to block any substantive workflow change that wasn't
`ci`-typed or bundled on a functional type with `breaking change`. Both options
were wrong in an action or reusable-workflow repo, where the workflow is the
product: `ci` suppressed the release (storybook-ci#36 shipped to no one) and
`breaking change` cut a spurious major. rmartz/dotfiles#1581 changed the fleet
policy, and this check followed in #11:

- A `workflow_call`-only workflow is shipped product code, and the title check
  ignores it. The trigger alone decides this. See
  [checks/title.md](checks/title.md).
- The coordinator's sibling-rebase signal is now path-based, so the `ci` type no
  longer carries it. An own-CI change on a non-release type gets an `info`
  recommendation, never a block. The `breaking change` bundling escape is
  retired.
- A release type is never told to retitle to `ci`. This covers the
  linter/formatter-bump rule too.

### UAT is a hard gate here; the lifecycle stays in pr-lifecycle

rmartz/pr-policy#13 settled the split. **pr-lifecycle** moves a PR through
review, fix, and approval, and arms native auto-merge on `approved`.
**pr-policy** enforces the hard gates a PR must pass before it merges. An
approved, armed PR waits on the required `pr-policy` check until every gate is
satisfied. So the UAT gate moved in from pr-lifecycle as a check that
[holds by default](checks/uat.md). It still never writes a UAT label.

Static rules **only exempt** a PR from UAT, never require it. Requiring UAT is
a judgment the review agent makes and expresses through the labels.

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

## Open

### Should `UAT passed` survive a push?

A person's `UAT passed` stays on the PR after a later push that changes what was
tested, and nothing clears it. That matches the fleet's current `tested`
semantics. A stale `no UAT needed` is already covered: pr-lifecycle disarms on a
push, and the review agent refreshes its UAT labels before the verdict
(rmartz/dotfiles#1583). A stale human `UAT passed` isn't covered by either.

### How the coordinator treats a pending `pr-policy`

A pending required check can look like "CI still running" to the coordinator,
which may wait on it rather than park the PR. The PR also carries
`CI approval needed`, which `GATE_CI_APPROVAL` already parks on, so the gate
model should key off the label and not wait out the check. Confirm in the
coordinator (rmartz/dotfiles) before relying on it there.
