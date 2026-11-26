---
type: Library
title: CI-change classification
description: The ci-change check — every loosening, ambiguous, and strengthening indicator it detects structurally in a PR's workflow diff, the stricter-only vocabulary, how a shipped reusable workflow is judged, the containment backstop, and how it drives the CI approval needed label and the pr-policy check-run.
resource: src/checks/ci-change/index.ts
tags: [pr-policy, ci-change, classification, merge-gate]
---

# CI-change classification

The `ci-change` check (`src/checks/ci-change/`) gates a PR on the CI sign-off,
`CI change approved`, when the PR's `.github/workflows/**` diff **loosens CI**
or **changes what an existing check enforces** in a way it can't show to be
strictly stricter. It owns the `CI approval needed` label that marks such a PR.

A change that only **strengthens** CI passes with no label: new workflows,
jobs, steps, or matrix entries, and an existing check made
[strictly stricter](#strictly-stricter-edits). That holds whatever else the PR
changes: mixing product code with a CI change never holds on its own. Why is in
[decisions.md](../decisions.md#ci-sign-off-only-for-a-loosened-or-changed-check).

## What it reports

| Verdict               | Findings                                                    | `CI approval needed`                                  |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| No workflow change    | none                                                        | removed if stale and unsigned                         |
| Strengthening only    | one informational note, plus one per strengthening edit     | removed if stale and unsigned                         |
| Loosening, unsigned   | one **hold** (pending) finding, plus one note per indicator | applied                                               |
| Loosening, signed off | informational only                                          | kept (never removed once `CI change approved` is set) |

"Loosening" here is the verdict name: it covers a changed check as well
(`CI_CHANGE_VERDICTS` keeps `tightening` and `loosening` for API stability).

An unsigned loosening leaves `pr-policy` **pending**, not failed: nothing is
broken, the PR is waiting on a person (see
[check-run-contract.md](../check-run-contract.md)). Applying `CI change approved`
re-runs the check (`labeled`), releases the hold, and titles the check-run
"CI change signed off". Why the label freezes once signed off is in
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

Any loosening **or** ambiguous indicator produces the `loosening` verdict and
the `CI approval needed` label. The two classes are kept apart only so the
check-run can tell a reader which it saw. A `strengthening` indicator is
evidence only and never holds.

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

Each changes what an existing check enforces, and none can be shown to be
strictly stricter from the diff alone, so each needs the sign-off.

| Indicator             | Fires when                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `runs-on-changed`     | A job's runner target changed.                                                                          |
| `permissions-changed` | A workflow- or job-level `permissions` block changed.                                                   |
| `env-changed`         | A workflow-, job-, or step-level `env` block changed.                                                   |
| `timeout-changed`     | A `timeout-minutes` was raised, removed, or set to an expression.                                       |
| `check-changed`       | A kept step's `run:` command, or a step's or job's `with:` inputs, changed in a way not shown stricter. |
| `unparseable`         | A file could not be parsed at head or at the merge base, so nothing can be compared.                    |
| `unclassified-change` | The change is not purely additive and matched no rule — the [backstop](#the-containment-backstop).      |

A raised timeout is itself a loosening under the CI directive. A lowered one is
[strictly stricter](#strictly-stricter-edits).

## Strictly stricter edits

An edit to an existing check passes when it can only make that check reject
more. A workflow diff can't say what a tool's flag means, so this is read from
a small, explicit vocabulary (`src/checks/ci-change/stricter.ts`), not from
name patterns: `--min-severity` raised reports _fewer_ issues, so "min" alone
proves nothing.

| Indicator             | Fires when                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `threshold-tightened` | A known bound moved the strict way, or was added where there was none.                                    |
| `strict-enabled`      | A known strict switch turned on: a `with:` input set to `true`, or a bare flag added to a `run:` command. |
| `timeout-reduced`     | `timeout-minutes` was lowered, or first set at or under GitHub's 360-minute default.                      |

The known bounds, matched on the whole name or its trailing words (so
`--cov-fail-under` matches `fail-under`, and `maxWarnings` reads as
`max-warnings`), never on a negated `no-` name:

- **Lower is stricter:** `max-warnings`, `max-lines`, `max-lines-per-function`,
  `max-line-length`, `max-len`, `max-complexity`, `max-statements`,
  `max-params`.
- **Higher is stricter:** `fail-under`, `min-coverage`, `minimum-coverage`,
  `coverage-threshold`.
- **Strict switches:** `strict`, `fail-on-error`, `fail-on-warning`,
  `fail-on-warnings`.

A `run:` command passes only when the head is the base word for word, except
for known bounds tightened and known flags inserted. Any other edit is
`check-changed`, including an appended command: the diff can't tell
`pnpm test && pnpm lint` from `pnpm test || true` by intent. A `with:` input
passes only when every changed input is a known bound tightened or a strict
switch turned on; a removed or unknown input is `check-changed`.

Thresholds that live outside `.github/workflows/**`, such as a
`.repo-hygiene.yml` file cap or an eslint config, are outside this check's
input. Changing them is never gated here, in either direction.

## Shipped reusable workflows

A workflow whose only trigger is `workflow_call` is shipped product code, not
this repo's CI (the same test the [title check](title.md) uses). Only its
**loosening** indicators hold: loosening a shipped workflow still needs the
sign-off unless the change was expressly requested, and then the session that
was asked applies `CI change approved` itself, quoting the request. Its other
edits, ambiguous or stricter, are listed as "Shipped reusable workflow, not CI"
notes and never hold.

## Tightening and maintenance

These produce no holding indicator, and so no label:

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

A step whose `id:` or `name:` is _edited_ therefore reads as a removal plus an
addition, and is reported as `step-removed`. A step known only by its `run:`
command is the exception: when as many command-keyed steps vanished as
appeared, they are paired in order and their commands compared, so tightening a
bound on an unnamed step isn't read as removing it.

## The containment backstop

When no holding rule fires, the classifier asks one more question: **does the
head document still contain everything the base one did?** It ignores the
fields the stricter rules already judged (`run:`, `with:`, `timeout-minutes`).
If yes, the change is additive, stricter, or cosmetic, and the verdict is
`tightening`. If no, something
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
