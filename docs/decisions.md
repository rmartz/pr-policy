---
type: Design
title: Design decisions
description: Why pr-policy is a suite behind one check-run, why it is read-only and separate from merge-safety and pr-lifecycle, how it relates to ci-change-guard, and the questions still open.
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
red until the author (or `/fix-review`) fixes the title. Port the predicate from
`lib/breaking_title.py`; don't reinvent it.

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

## Open

### Retiring rmartz/ci-change-guard

`rmartz/ci-change-guard` was scaffolded for check 1 before #302 was rescoped
into this suite. It already has a structural workflow classifier with per-rule
tests. **Proposed:** port its classifier as the CI-change check here, then
archive it. Its settled policies carry over:

- **Label removal:** reconcile `CI approval needed` to the current head while no
  one has signed off. Never remove it once `CI change approved` is present; it
  stays as the audit record.
- **`/review` defers entirely** for the classification. Composition judgments
  (a loosening must stand alone) stay with the review.

### Red vs. neutral for an unsigned CI loosening

`ci-change-guard` posted `neutral`, not `failure`, for an unsigned loosening. A
red check can send the coordinator into a fix loop that can't clear it, because
only a human label clears it. #302 makes `pr-policy` a required, red-on-violation
check. That is right for title findings, which a fix pass _can_ clear. For the
CI finding, the coordinator's routing must learn that a `pr-policy` failure
whose only blocking finding is the CI gate is waiting on a human, not a fix.
Settle this with check 1.
