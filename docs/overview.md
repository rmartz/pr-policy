---
type: Reference
title: What pr-policy is
description: The suite of read-only PR content classifiers behind the single blocking pr-policy check-run — what each check judges, what it may write, and where it sits relative to merge-safety and pr-lifecycle.
tags: [pr-policy, overview, merge-gate]
---

# What pr-policy is

`@rmartz/pr-policy` answers one question about a pull request: **is its content
acceptable under policy?** Each policy rule is a **check**: a read-only
classifier over the PR's current title, labels, and changed files (and, for
checks that need them, the changed files' contents). Every check's findings are
folded into **one** [`pr-policy` check-run](check-run-contract.md).

## How a PR is evaluated

1. **Gather facts** about the PR's current content (`PullRequestFacts` in
   `src/policy.ts`).
2. **Run every registered check** (`CHECKS` in `src/checks/index.ts`). Each one
   returns zero or more findings. A finding is either **blocking** or
   informational.
3. **Build one report** (`buildReport` in `src/report.ts`). Any blocking finding
   makes the check-run `failure`. Otherwise it is `success`, and informational
   findings are listed in the summary.
4. **Post the check-run**, and write any labels a check owns outright.

Steps 1–3 exist today and run offline through `ai-pr-policy evaluate --facts`.
Step 4 needs the GitHub plumbing, which lands with the first check. The
distribution wrapper comes after that: see [distribution.md](distribution.md).

## Where it sits in the fleet

| Package         | Question                                         | Kind                                                     |
| --------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `merge-safety`  | Is this PR safe to merge against _current_ base? | Classifier of the PR's **relation to its base**          |
| **`pr-policy`** | Is this PR's **own content** acceptable?         | Classifier. Reports only; never overrides another party. |
| `pr-lifecycle`  | Where is this PR in its review lifecycle?        | Reconciler of lifecycle labels; arms auto-merge          |

The three are independent. None imports another or reads another's outputs.
They meet only in the consumer's ruleset, where each is a required check. The
boundary reasoning is in [decisions.md](decisions.md).
