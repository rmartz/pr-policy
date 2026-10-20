---
type: Library
title: Sign-off classifier
description: The shared classifySignOff function that decides whether a PR needs no sign-off, a CI sign-off, or UAT — the order of its rules, why CI sign-off and UAT are mutually exclusive, how the uat check gates on it, and the sign-off reading (readUatSignOff, signOffState) exported with it for rmartz/pr-lifecycle.
resource: src/classify-sign-off.ts
tags: [pr-policy, uat, ci, sign-off, library]
---

# Sign-off classifier

`classifySignOff(facts, config)` decides which human sign-off a PR needs. It is
the one definition both sides call: the `uat` check here gates on it, and
rmartz/pr-lifecycle, the only label writer, shows its answer as labels. Neither
reads the other's output, so a PR's labels and its gate can't disagree. It is a
pure function of the PR's facts and the [repo config](config.md).

## The answer

`SignOffRequirement` is a union on `kind`, each with a `reason` a finding or a
label comment can show:

| `kind` | When                                                                                                                                                         | Gate                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `ci`   | A `ci` title whose workflow change loosens CI. `indicators` carries the evidence.                                                                            | `CI change approved` from a trusted person, via `ci-change` |
| `none` | The repo config sets `uat: off`; or the title is `docs`, `test`, or `refactor`; or every changed path is in a [trivial category](checks/uat.md#trivial-prs). | nothing                                                     |
| `uat`  | Everything else, including `chore`, which the review judges.                                                                                                 | a trusted, current `UAT passed` or `no UAT needed`          |

The rules apply in that order. The `docs`, `test`, and `refactor` titles are
trusted because the [title check](checks/title.md#type-versus-paths-rules)
blocks each one when its paths contradict it.

## CI sign-off and UAT are mutually exclusive

A PR that needs a person on its CI change is never also asked for UAT: the
classifier answers `ci`, and the `uat` check passes with an `info` finding. It
answers `ci` even with `uat: off`, since the CI gate doesn't depend on UAT.

Only a `ci` title gets that. A loosening bundled into another type is a
composition problem the review splits out. Until it does, the classifier answers
from the rest of the PR (usually `uat`), and `ci-change` still holds the
loosening for its own sign-off, so that PR needs both.

## The sign-off reading

Exported alongside, so both tools use one definition of "trusted" and
"current":

- `signOffState(pr, labels)`: whether a sign-off label counts, from who applied
  it ([who can sign off](checks/uat.md#who-can-sign-off)).
- `readUatSignOff(pr)`: the UAT sign-off on a PR. It sets aside a `UAT passed`
  that predates the current head ([head binding](checks/uat.md#uat-passed-is-bound-to-the-head)),
  then judges trust over the rest. `HEAD_BOUND_SIGN_OFFS` lists the labels bound
  to the head.

The label names (`UAT_PASSED_LABEL`, `NO_UAT_NEEDED_LABEL`,
`LEGACY_UAT_PASSED_LABEL`, `CI_CHANGE_APPROVED_LABEL`, …) are exported too. They
are frozen; see [check-run-contract.md](check-run-contract.md).

## Stability

This is public API that pr-lifecycle builds on. Its tests import only from the
package entry point (`test/api/`), so a change that breaks an importer breaks a
test here first. A new `kind` is a breaking change: importers switch over it
exhaustively.
