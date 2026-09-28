---
type: Reference
title: What pr-policy is
description: The suite of read-only PR content classifiers behind the single required pr-policy check-run — what each check judges, what it may write, and where it sits relative to merge-safety and pr-lifecycle.
tags: [pr-policy, overview, merge-gate]
---

# What pr-policy is

`@rmartz/pr-policy` answers one question about a pull request: **is its content
acceptable under policy?** Each policy rule is a **check**: a read-only
classifier over the PR's current title, labels, and changed files (and, for
checks that need them, the changed files' contents). Every check's findings are
folded into **one** [`pr-policy` check-run](check-run-contract.md).

## How a PR is evaluated

1. **Gather facts** about the PR's current state (`PullRequestFacts` in
   `src/policy.ts`): title, labels, changed paths, both sides of every changed
   workflow file and dependency manifest, and who applied each sign-off label on
   the PR (`src/github/sign-offs.ts`).
2. **Run every registered check** (`CHECKS` in `src/checks/index.ts`). Each one
   returns zero or more findings, each a **block** (fixable problem), a
   **hold** (waiting on a human), or **info**.
3. **Build one report** (`buildReport` in `src/report.ts`). Any block makes the
   check-run `failure`; otherwise any hold makes it pending; otherwise it is
   `success`. See [check-run-contract.md](check-run-contract.md).
4. **Post the check-run**, and write any labels a check owns outright.

`ai-pr-policy evaluate --pr <n>` runs all four against a live PR (the plumbing
is in `src/github/pull-request.ts`); `--facts` runs steps 2–3 offline. The
registered checks are listed in [checks/index.md](checks/index.md). Consumers
run it through the `rmartz/pr-policy-action` Action: see
[distribution.md](distribution.md).

## Where it sits in the fleet

| Package         | Question                                         | Kind                                                     |
| --------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `merge-safety`  | Is this PR safe to merge against _current_ base? | Classifier of the PR's **relation to its base**          |
| **`pr-policy`** | Is this PR's **own content** acceptable?         | Classifier. Reports only; never overrides another party. |
| `pr-lifecycle`  | Where is this PR in its review lifecycle?        | Reconciler of lifecycle labels; arms auto-merge          |

The three are independent. None imports another or reads another's outputs.
They meet only in the consumer's ruleset, where each is a required check. The
boundary reasoning is in [decisions.md](decisions.md).
