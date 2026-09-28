---
type: Library
title: Blocking labels
description: The merge-block check — holds pr-policy pending while a PR carries do not merge, dnm, blocked, or escalation needed, how labels are matched, why it holds rather than blocks, and why any actor's label counts.
resource: src/checks/merge-block.ts
tags: [pr-policy, labels, merge-gate]
---

# Blocking labels

The `merge-block` check (`src/checks/merge-block.ts`) holds `pr-policy` pending
while the PR carries any of these labels:

| Label               | Usual meaning                                 |
| ------------------- | --------------------------------------------- |
| `do not merge`      | A person's explicit veto.                     |
| `dnm`               | Shorthand for `do not merge`.                 |
| `blocked`           | Waiting on something outside the PR.          |
| `escalation needed` | The review flow needs the author or a person. |

Because `pr-policy` is a required check, the label stops every merge path: a
person pressing merge, native auto-merge, and the coordinator. Before this
check, only the coordinator's `/merge` dispatch rule skipped these labels.

Matching ignores case and treats `-`, `_`, and spaces alike, so `Do Not Merge`,
`do-not-merge`, and `DO_NOT_MERGE` all count. The finding names each label as
spelled on the PR. The names are pinned in `src/contract.ts`.

| PR state                    | Findings                      | `pr-policy`      |
| --------------------------- | ----------------------------- | ---------------- |
| One or more blocking labels | one `hold` naming every label | pending          |
| No blocking label           | none                          | passes this gate |

The caller runs on `labeled` / `unlabeled`, so removing the label re-evaluates
the PR straight away.

## A hold, not a block

The label records a person's decision to stop the merge. The author can't clear
it by changing the PR's content, only a person removing the label can. That is
the definition of a [hold](../check-run-contract.md#pr-policy-the-check-run).

## Any actor's label counts

Unlike a sign-off, a blocking label isn't read through `signOffState`. A sign-off
_lifts_ a gate, so it counts only from someone who could merge. A blocking label
only _adds_ one, so honoring it from a bot or a triage user fails safe: the
worst case is a PR that waits for a person to look.

The check never applies or removes a blocking label.
