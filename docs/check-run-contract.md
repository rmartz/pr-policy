---
type: Reference
title: The check-run and label contract
description: The external names pr-policy is bound to — the pr-policy check-run, the CI gate labels, and the UAT sign-off labels — what its failure, pending, and success states mean, which checks report into it, and why there is exactly one check-run.
tags: [pr-policy, contract, labels, check-run]
---

# The check-run and label contract

The strings below are read outside this repo. They are declared once
in [`src/contract.ts`](../src/contract.ts) and pinned by `test/contract.test.ts`.
Renaming any of them is a coordinated cross-repo migration, never a local
refactor.

## `pr-policy`: the check-run

The one check-run this package posts. Consumers mark it a **required status
check** on the default-branch ruleset, and match it by literal name. That's why
the name is frozen from `v0.1.0`.

Each finding has an **effect** (`src/policy.ts`), and the strongest one sets the
check-run's state:

| Effect  | Meaning                                 | Check-run state                         |
| ------- | --------------------------------------- | --------------------------------------- |
| `block` | A problem the author can fix (a title). | `completed` / `failure` (red)           |
| `hold`  | Waiting on a human act (a sign-off).    | `in_progress`, no conclusion (pending)  |
| `info`  | Context only.                           | doesn't gate; `success` if nothing else |

A `block` outranks a `hold`, so the author sees what they can act on. The
summary lists every finding, attributed to its check.

**Why a hold is pending, not red.** Nothing is broken while a PR waits for a
sign-off. A red check reads as a failing build to people and to every routing
rule that scans for failures, and would send the PR round a fix pass that
cannot clear it. A required check that is `in_progress` still holds the merge.

A pending run is never completed by the job that posted it. The next evaluation
of the same head **updates** that run instead of creating another, so no
orphaned pending run sits beside the real verdict. GitHub marks a run that stays
incomplete for 14 days as `stale`; that still holds the merge, and the next
event on the PR posts a fresh run.

Findings come from three checks, in this order: [`title`](checks/title.md),
[`ci-change`](checks/ci-change.md), and [`uat`](checks/uat.md). A PR waiting on
both a CI sign-off and UAT holds twice, and the title reads "Waiting on 2 human
sign-offs".

There is exactly **one** check-run, however many checks the suite grows. A new
check reports into it rather than posting its own, so adding a check never
requires a ruleset edit in every consumer. `repo-hygiene` bundles its checks
behind a single status for the same reason.

## `CI approval needed`: the CI merge-gate label

Owned by the [CI-change check](checks/ci-change.md). It is applied when a
workflow change is classified as loosening or ambiguous, and it stays on after
sign-off as the audit record. The coordinator's gate model already parks
a PR carrying it until `CI change approved` is also present. While it is present
without the sign-off, the CI-change check reports a `hold`, leaving `pr-policy`
pending.

## `CI change approved`: the human sign-off

Read-only here. **This package never applies it.** It is the deliberate human act
the CI gate exists to require, and it is the only sanctioned sign-off. It counts
only when a user with write, maintain, or admin permission applied it (see
[who can sign off](checks/uat.md#who-can-sign-off)). The check re-runs on
`labeled`, so applying it clears the finding.

## `UAT passed`, `tested`, and `no UAT needed`: the UAT sign-offs

Read-only here. **This package never applies or removes them.** Any one of them,
applied by a trusted user, passes the [UAT gate](checks/uat.md). `UAT passed`
is a person's statement that they tested the PR. `tested` is its old name, read
until rmartz/dotfiles#1572 finishes the rename. `no UAT needed` is a waiver from
the review agent or a person.
