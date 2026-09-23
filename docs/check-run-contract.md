---
type: Reference
title: The check-run and label contract
description: The external names pr-policy is bound to — the pr-policy check-run, CI approval needed, and CI change approved — what red and green mean, and why there is exactly one check-run.
tags: [pr-policy, contract, labels, check-run]
---

# The check-run and label contract

Three strings in this package are read outside this repo. They are declared once
in [`src/contract.ts`](../src/contract.ts) and pinned by `test/contract.test.ts`.
Renaming any of them is a coordinated cross-repo migration, never a local
refactor.

## `pr-policy`: the check-run

The one check-run this package posts. Consumers mark it a **required status
check** on the default-branch ruleset, and match it by literal name. That's why
the name is frozen from `v0.1.0`.

- **`success`**: no check produced a blocking finding.
- **`failure`**: at least one did. The summary lists every finding, attributed
  to the check that produced it.

There is exactly **one** check-run, however many checks the suite grows. A new
check reports into it rather than posting its own, so adding a check never
requires a ruleset edit in every consumer. `repo-hygiene` bundles its checks
behind a single status for the same reason.

## `CI approval needed`: the CI merge-gate label

Owned by the [CI-change check](checks/ci-change.md). It is applied when a
workflow change is classified as loosening or ambiguous, and it stays on after
sign-off as the audit record. The coordinator's gate model already parks
a PR carrying it until `CI change approved` is also present. While it is present
without the sign-off, the CI-change check reports a blocking finding.

## `CI change approved`: the human sign-off

Read-only here. **This package never applies it.** It is the deliberate human act
the CI gate exists to require, and it is the only sanctioned sign-off. The check
re-runs on `labeled`, so applying it clears the finding.
