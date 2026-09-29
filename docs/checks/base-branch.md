---
type: Library
title: Base branch
description: The base-branch check — which branch a PR may merge into, why only an epic's branch accumulates other PRs, why stacked epics land one at a time from the bottom up, and when a stacked PR holds versus blocks.
resource: src/checks/base-branch.ts
tags: [pr-policy, stacking, epic, merge-gate]
---

# Base branch

The `base-branch` check (`src/checks/base-branch.ts`) decides whether a PR may
merge into the branch it targets:

- **Any PR may merge into the default branch.**
- **A PR without the `epic` label may merge into an open epic PR's branch.** A
  large feature accumulates its changes on the epic's branch, then lands as one.
- **Nothing else merges into a non-default branch.** An epic stacked on another
  PR, or any PR stacked on a non-epic PR, waits for its base PR to merge. When
  it does, GitHub retargets the PR to that PR's base, and it is judged again.

So stacked epics are never folded into each other. Each one merges into the
default branch on its own, from the bottom of the stack up.

| Base branch                                   | This PR  | Findings | `pr-policy`      |
| --------------------------------------------- | -------- | -------- | ---------------- |
| The default branch                            | any      | none     | passes this gate |
| The head of an open **epic** PR               | not epic | none     | passes this gate |
| The head of an open **epic** PR               | epic     | `hold`   | pending          |
| The head of an open non-epic PR               | any      | `hold`   | pending          |
| Not the default branch, and no open PR's head | any      | `block`  | red              |

The `epic` label is matched ignoring case, so the fleet roster's `Epic` counts.
The name is pinned in `src/contract.ts`. If several open PRs head the same
branch, one epic among them is enough.

## Hold, or block

A stacked PR can't merge yet, but it has nothing to fix. Its base PR merging
releases it, and GitHub's retarget fires `edited`, which the caller re-runs on.
That is a [hold](../check-run-contract.md#pr-policy-the-check-run). Review and
fixes carry on while it waits.

A base branch that no open PR heads will never be released that way: nothing
is left to merge. Only a retarget clears it, which the author can do, so it
blocks. This also covers a base PR that merged without GitHub retargeting its
children (its branch was kept).

## What the check reads

`gatherFacts` reads the base branch and the repository's default branch from
the PR itself. For a non-default base it lists the open PRs whose head is that
branch, with their labels, since GitHub has no branch-level labels. A failed
lookup throws rather than reading as "no PR heads this branch".

The check runs on the PR's own events. Labelling the base PR `epic` after the
fact doesn't re-evaluate its children: push to, relabel, or re-run the child to
pick it up.

## Why it lives here, not in merge-safety

merge-safety's stacked-base barrier used to answer this. Which branch a PR may
target is policy, not safety: it doesn't change as the base moves. See
[decisions.md](../decisions.md#the-merge-target-is-policy).

The check never applies or removes a label.
