---
type: Library
title: Title-type rules
description: The title check — the Conventional-Commit grammar a squash title must meet, the breaking-marker and label consistency rules, when a PR must be ci-typed, and the release-please exemption. Every violation blocks until the title is edited; the check never renames a PR.
resource: src/checks/title/index.ts
tags: [pr-policy, title, conventional-commits, releases]
---

# Title-type rules

The repo squash-merges with the PR title, so the title **is** the commit subject
that reaches `main` and drives semantic-release. Nothing rewrites it at merge any
more, so the `title` check (`src/checks/title/`) blocks until it is right. Every
finding is a `block`: the author (or a fix pass) can always clear it by editing
the title or a label. The check never renames the PR itself.

The rules are ported from rmartz/dotfiles `breaking_change.py` and
`lib/breaking_title.py`, which applied them by rewriting the title at merge time.

## The rules

| Rule                     | Blocks when                                                                                                                            | Fix                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Grammar**              | The title isn't `<type>[(<scope>)][!]: <subject>` with a known type. Same grammar as `pr-title-lint.yml` and `commit-convention.yml`.  | Retitle.                                                                      |
| **`!` type**             | `!` on a non-functional type (anything but `feat`/`fix`/`perf`/`revert`). It would cut a spurious major.                               | Drop the `!`.                                                                 |
| **Label type**           | `breaking change` on a non-functional type.                                                                                            | Remove the label, or retitle to the functional type.                          |
| **Label without `!`**    | A functional type labelled `breaking change` or `hotfix` whose title has no `!`, so the release would miss the major.                  | Add the `!` (the finding spells out the exact title).                         |
| **`!` without label**    | A functional `!` title without `breaking change`. The label is the source of truth.                                                    | Add the label, or drop the `!`.                                               |
| **CI changes are `ci`**  | A substantive change to `.github/workflows/**` on a non-`ci` type.                                                                     | Retitle `ci(<scope>): …`, or bundle on a functional type + `breaking change`. |
| **Sensitive tool bumps** | A version change to `eslint`, `prettier`, `black`, `ruff`, or `pylint` in a `package.json` or `requirements*.txt`, on a non-`ci` type. | Retitle `ci(deps): …`. Never `!` or `breaking change` for it.                 |

The `ci` type matters because the coordinator re-tests in-flight PRs against a
merged `ci` change, and a new linter or formatter can change results on files a
PR never touched.

## What counts as a CI change

A workflow change is **substantive** unless the head document equals the base
after normalizing `uses:` refs. So a pure action-pin bump (every Dependabot
`github-actions` PR) or a comment-only edit keeps its `chore` type, per the
Dependabot convention. An added, deleted, or unparseable workflow always counts.
The comparison reuses the [ci-change](ci-change.md) structural helpers.

## Exemptions

A **release-please release PR** is skipped entirely: one carrying
`autorelease: pending`, or titled `chore[(scope)]: release …`. Its title is a
contract with release-please, which must parse its own merged release PR.

## Not covered here

Whether a CI **loosening** was bundled with unrelated work is a judgment about
the PR's composition, not its title, and stays with the review.
