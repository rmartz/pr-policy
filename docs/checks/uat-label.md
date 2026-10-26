---
type: Library
title: UAT label presence
description: The opt-in uat-label check — it holds a PR that carries no UAT label, why presence counts from any actor and never relaxes the UAT gate, why it is off by default, that it runs even when the UAT gate is skipped, and the workflow_run re-run trigger a caller needs.
resource: src/checks/uat-label.ts
tags: [pr-policy, uat, labels, merge-gate]
---

# UAT label presence

The `uat-label` check (`src/checks/uat-label.ts`) makes every merged PR carry an
explicit, auditable UAT determination (rmartz/pr-policy#103). While **no** UAT
label is on the PR, it holds `pr-policy` pending: "waiting for a UAT
determination". Any one of these clears it:

| Label                     | Meaning                                      |
| ------------------------- | -------------------------------------------- |
| `no UAT needed`           | the PR needs no user testing                 |
| `UAT pending`             | it needs UAT, and isn't ready to test yet    |
| `UAT ready`               | it's ready for a person to test              |
| `UAT passed`              | a person tested it                           |
| `tested`, `ready for UAT` | legacy names of `UAT passed` and `UAT ready` |

Labels match regardless of case. pr-lifecycle keeps exactly one of them on every
open PR (rmartz/pr-lifecycle#131), recording `no UAT needed` even when UAT is
off, so this check catches a PR whose labeling never happened: pr-lifecycle not
running, a failed run, or a label removed by hand.

It's a `hold`, not a `block`: it clears on its own once pr-lifecycle runs, and
the author has nothing to fix.

## Presence only, from any actor

The check asks whether a UAT label is there, not who applied it. pr-lifecycle
writes these labels with `GITHUB_TOKEN`, as `github-actions[bot]`, and that has
to count.

That's safe because presence never passes a PR on its own. It only **adds** a
requirement. The [UAT gate](uat.md) still decides whether a PR that needs UAT is
signed off: from a `v2` status's reported sign-off, or else a trusted, current
`UAT passed` or a `no UAT needed` waiver it accepts. A PR carrying only `UAT
pending` or `UAT ready` passes this check and still waits on the UAT gate, and a
bot's `UAT passed` satisfies presence but never opens the gate by itself.

## Off by default

Turn it on with `--require-uat-label` (CLI), `selectChecks({ requireUatLabel:
true })` (library), or the pr-policy-action input `require-uat-label: true`. It
is off by default because on a repo not yet running pr-lifecycle it would hold
every PR, including the PR that adds pr-lifecycle: pr-policy runs from the base
branch (the same trap as [an untrusted sign-off status](../decisions.md#an-untrusted-status-is-ignored-not-held-on)).
Turn it on in the pr-policy caller once the repo's pr-lifecycle caller is on the
default branch.

It is not in `CHECKS`. `selectChecks` adds it just before `dependabot` when
asked, and it runs **even when `skipUat` is set**: a repo without UAT still gets
a `no UAT needed` label from pr-lifecycle, and that determination is what this
check records.

## Re-running when the label lands

A label written with `GITHUB_TOKEN` triggers no `labeled` run. So on `opened`,
pr-policy can evaluate before pr-lifecycle has labeled the PR, and then nothing
re-runs it. A caller that turns this check on must also re-run on pr-lifecycle's
completion: a `workflow_run` trigger on the `pr-lifecycle` workflow, mapped to
its PRs with `pr-policy evaluate --sha <head sha>`. pr-policy-action documents
the caller wiring.
