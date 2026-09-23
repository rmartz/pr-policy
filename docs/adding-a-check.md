---
type: Reference
title: Adding a policy check
description: The steps to add a check to the pr-policy suite — a module under src/checks/, registration in CHECKS, per-rule tests, and a docs/checks/ page — plus the rules every check must obey.
tags: [pr-policy, checks, contributing]
---

# Adding a policy check

A check is a `PolicyCheck` (`src/policy.ts`): a `name` and an async `evaluate`
that turns `PullRequestFacts` into a `CheckResult`: findings, plus edits to any
label the check owns outright. [ci-change](checks/ci-change.md) is the reference
implementation.

## Before you start

A rule belongs here only if it is a **fact about the PR's own content** that
doesn't depend on history. Rules about review state, approvals, or UAT belong
in `pr-lifecycle` (rmartz/ai-tools#306). Rules about the PR's relation to its
base belong in `merge-safety`. If the rule needs to overwrite a label someone
else owns, it is a reconciler and doesn't belong here.

## Steps

1. **Module.** Create `src/checks/<name>.ts` exporting the check, or a
   `src/checks/<name>/` directory (like `ci-change/`) once it has several rule
   modules. Split before a file approaches its cap.
2. **Register.** Add it to `CHECKS` in `src/checks/index.ts`. Array order is
   report order.
3. **Facts.** If the check needs input beyond `PullRequestFacts`, extend the
   interface, `gatherFacts` (`src/github/pull-request.ts`), and `parseFacts`
   (`src/facts.ts`). Keep every field a property of current content, and make
   gathering fail closed: a read error must not look like "nothing changed".
4. **Tests.** Add `test/checks/<name>.test.ts` with one `it` per rule. Cover the
   blocking case and the nearest case that must _not_ fire. Tests stay hermetic.
5. **Docs.** Add `docs/checks/<name>.md` (OKF `type: Library`,
   `resource: src/checks/<name>.ts`) documenting every rule, and link it from
   [`docs/checks/index.md`](checks/index.md). Update the planned-checks table in the README and
   trim any "planned" wording the check just made obsolete.

## Rules every check obeys

- **Report into the one check-run.** Never post a separate check-run.
- **Blocking means actionable.** Say in the finding message exactly what would
  clear it: a title edit, a human label, a code change.
- **Deterministic.** The same content always yields the same findings. No LLM
  judgment, and no network beyond reading the PR itself.
- **Err toward blocking when a miss is costly.** If a false positive costs a
  human one look and a false negative bypasses a gate, make the check
  trigger-happy, and fix false positives by adding a named rule.
