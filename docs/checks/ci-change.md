---
type: Library
title: CI-change classification
description: The ci-change check — every loosening, ambiguous, and tightening indicator it detects structurally in a PR's workflow diff, the containment backstop, and how it drives the CI approval needed label and the pr-policy check-run.
resource: src/checks/ci-change/index.ts
tags: [pr-policy, ci-change, classification, merge-gate]
---

# CI-change classification

The `ci-change` check (`src/checks/ci-change/`) classifies a PR's
`.github/workflows/**` diff as tightening or loosening. Ported from
`rmartz/ci-change-guard` (retired).

## What it reports

| Verdict               | Findings                                                    | `CI approval needed`                                  |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| No workflow change    | none                                                        | removed if stale and unsigned                         |
| Tightening            | one informational note                                      | removed if stale and unsigned                         |
| Loosening, unsigned   | one **hold** (pending) finding, plus one note per indicator | applied                                               |
| Loosening, signed off | informational only                                          | kept (never removed once `CI change approved` is set) |

An unsigned loosening leaves `pr-policy` **pending**, not failed: nothing is
broken, the PR is waiting on a person (see
[check-run-contract.md](../check-run-contract.md)). Applying `CI change approved`
re-runs the check (`labeled`), releases the hold, and titles the check-run
"CI loosening signed off". Why the label freezes once signed off is in
[decisions.md](../decisions.md).

`CI change approved` counts only when a user with write, maintain, or admin
permission applied it, following the same rule as the UAT sign-offs (see
[who can sign off](uat.md#who-can-sign-off)). A bot's or a triage user's
approval keeps the hold, adds a note saying why, and doesn't freeze the gate
label.

Workflow files are read at the **merge base** and the head. If a side the file
list says exists can't be read, the run fails rather than guess: a modified file
mistaken for a new one would never be classified as loosening.

## How classification works

Classification is **structural**. Both sides of every changed workflow file are
parsed into a document tree, and the rules compare those trees. A line-regex over
a unified diff cannot tell a removed step from a reindented one, or a shrunk
matrix from a reformatted list.

Any indicator at all — loosening **or** ambiguous — produces the `loosening`
verdict and the `CI approval needed` label. The two classes are kept apart only
so the check-run can tell a reader which it saw.

## Loosening indicators

| Indicator                 | Fires when                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `workflow-removed`        | A workflow file is deleted, taking every check in it away.                                                                          |
| `job-removed`             | A job key present at the merge base is absent at head. A renamed job reads as one.                                                  |
| `step-removed`            | A job lost a step (see [step identity](#step-identity)).                                                                            |
| `continue-on-error-added` | `continue-on-error` became truthy on a job or step that did not have it.                                                            |
| `if-added`                | An `if:` appeared on a job or step that previously always ran.                                                                      |
| `trigger-narrowed`        | An `on:` event disappeared; an inclusive filter lost entries or appeared where there was none; an `*-ignore` filter gained entries. |
| `matrix-reduced`          | A matrix dimension disappeared or lost values, or `exclude` gained a combination.                                                   |
| `needs-reduced`           | A job stopped waiting on a dependency.                                                                                              |

`continue-on-error` counts as enabled for **any** value that is not absent and
not literal `false` — including a `${{ }}` expression, whose value is unknowable
statically and must not be read as "off".

## Ambiguous indicators

The CI directive says to treat these as loosening, because none can be shown to
be benign from the diff alone.

| Indicator             | Fires when                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `runs-on-changed`     | A job's runner target changed.                                                                     |
| `permissions-changed` | A workflow- or job-level `permissions` block changed.                                              |
| `env-changed`         | A workflow-, job-, or step-level `env` block changed.                                              |
| `timeout-changed`     | A `timeout-minutes` changed, in either direction.                                                  |
| `unparseable`         | A file could not be parsed at head or at the merge base, so nothing can be compared.               |
| `unclassified-change` | The change is not purely additive and matched no rule — the [backstop](#the-containment-backstop). |

A raised timeout is itself a loosening under the CI directive, which is why
`timeout-changed` fires on any change rather than only on an increase.

## Tightening and maintenance

These produce no indicator, and so no label:

- Steps or jobs only added; a brand-new workflow file.
- Action version bumps (`uses: actions/checkout@v4` → `@v5`).
- New trigger events, branches, paths, or matrix dimensions.
- Comment-only or purely cosmetic edits.
- Steps reordered — reordering is not a loosening.

## Step identity

Steps are paired across revisions by a stable key, not by index: an insertion
near the top of a job would otherwise report every step after it as removed. The
key is the first of `id:`, `name:`, `uses:` (with its `@ref` stripped), `run:`,
and finally the step's own serialized content.

A step whose identifying field is _edited_ therefore reads as a replacement
rather than a modification — the old key vanishes and a new one appears. That is
not reported as `step-removed`, because the containment backstop catches the edit
first and reports it as `unclassified-change`; either way the change is gated.

## The containment backstop

When no named rule fires, the classifier asks one more question: **does the head
document still contain everything the base one did?** If yes, the change is
additive or cosmetic, and the verdict is `tightening`. If no, something
structural changed that no rule recognises, and the verdict is `loosening` via
`unclassified-change`.

Containment is recursive and order-insensitive for sequences, and it compares
`uses:` values with their `@ref` stripped, so a Dependabot action bump does not
trip it. A node that merely _gained_ a field still contains its base version — a
step that acquired `continue-on-error: false` is the same step grown, not a
removal plus an addition.

This backstop is what makes the classifier deliberately trigger-happy, and that
is the intended posture. A false positive costs a human one label on a change
they were going to look at anyway. A false negative merges a CI loosening with no
sign-off at all.

## Scope

Only `.github/workflows/**/*.yml` and `.yaml` are classified. A composite action
under `.github/actions/` can change behaviour too, but it is invoked _by_ a
workflow step, so a change there that matters shows up here — and widening the
scope would put a human sign-off gate on every consuming repo's Action edits.
