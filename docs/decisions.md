---
type: Design
title: Design decisions
description: Why pr-policy is a suite behind one check-run, why it is read-only and separate from merge-safety and pr-lifecycle, what carried over from ci-change-guard, why a PR waiting on sign-off is pending rather than red, the title-rule port, and the questions still open.
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
freshness) is a larger trust grant than reporting. Those reconcilers live in
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

The difference: a workflow change needs the `ci` type only when it is
**substantive**. A pure action-pin bump or comment-only edit keeps its Dependabot
`chore` type. Otherwise every Dependabot `github-actions` PR in the fleet would
block, and the checklist deliberately gives those PRs `chore`.

## Open

### How the coordinator treats a pending `pr-policy`

A pending required check can look like "CI still running" to the coordinator,
which may wait on it rather than park the PR. The PR also carries
`CI approval needed`, which `GATE_CI_APPROVAL` already parks on, so the gate
model should key off the label and not wait out the check. Confirm in the
coordinator (rmartz/dotfiles) before relying on it there.
