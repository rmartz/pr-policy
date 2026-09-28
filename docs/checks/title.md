---
type: Library
title: Title-type rules
description: The title check — the Conventional-Commit grammar a squash title must meet, the breaking-marker and label consistency rules, when ci-typing is required or only recommended, why a shipped reusable workflow is product code, and the release-please exemption. Violations block until the title is edited; the check never renames a PR.
resource: src/checks/title/index.ts
tags: [pr-policy, title, conventional-commits, releases]
---

# Title-type rules

The repo squash-merges with the PR title, so the title **is** the commit subject
that reaches `main` and drives semantic-release. Nothing rewrites it at merge any
more, so the `title` check (`src/checks/title/`) blocks until it is right. Every
rule below is a `block`: the author (or a fix pass) can always clear it by
editing the title or a label. The one exception is the own-CI note, which is
`info`. The check never renames the PR itself.

The rules are ported from rmartz/dotfiles `breaking_change.py` and
`lib/breaking_title.py`, which applied them by rewriting the title at merge time.

## The rules

| Rule                     | Blocks when                                                                                                                                                           | Fix                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Grammar**              | The title isn't `<type>[(<scope>)][!]: <subject>` with a known type. Same grammar as `pr-title-lint.yml` and `commit-convention.yml`.                                 | Retitle.                                                      |
| **`!` type**             | `!` on a non-functional type (anything but `feat`/`fix`/`perf`/`revert`). It would cut a spurious major.                                                              | Drop the `!`.                                                 |
| **Label type**           | `breaking change` on a non-functional type.                                                                                                                           | Remove the label, or retitle to the functional type.          |
| **Label without `!`**    | A functional type labelled `breaking change` or `hotfix` whose title has no `!`, so the release would miss the major.                                                 | Add the `!` (the finding spells out the exact title).         |
| **`!` without label**    | A functional `!` title without `breaking change`. The label is the source of truth.                                                                                   | Add the label, or drop the `!`.                               |
| **Sensitive tool bumps** | A version change to `eslint`, `prettier`, `black`, `ruff`, or `pylint` in a `package.json` or `requirements*.txt`, on a type that is neither `ci` nor a release type. | Retitle `ci(deps): …`. Never `!` or `breaking change` for it. |

A new linter or formatter can change results on files a PR never touched, so the
coordinator must re-test in-flight PRs against it, and it keys that off the `ci`
type. A **release type** (`feat`/`fix`/`perf`/`revert`) is never told to retitle
to `ci`: that would suppress the release.

## Own-CI changes: a note, never a block

A substantive change to this repo's own CI on a non-`ci`, non-release type gets
an `info` finding recommending `ci(<scope>): …`. It never gates. The coordinator
now rebases siblings on a CI change by its **paths** (`.github/workflows/**`,
`.github/actions/**`), not its title (rmartz/dotfiles#1581), so the type no
longer carries that signal. A release-typed PR that bundles an own-CI change
keeps its type with no `breaking change` label.

A workflow change is **substantive** unless the head document equals the base
after normalizing `uses:` refs. So a pure action-pin bump (every Dependabot
`github-actions` PR) or a comment-only edit keeps its `chore` type, per the
Dependabot convention. An added, deleted, or unparseable workflow always counts.
The comparison reuses the [ci-change](ci-change.md) structural helpers.

### Shipped reusable workflows are product code

A workflow whose **only** trigger is `workflow_call` is a shipped reusable
workflow. In an action or reusable-workflow repo it is the product consumers
call, so it takes a release type and the title check says nothing about it. It
is judged on its head content, or its base content for a deletion. Loosening one
still needs `CI approval needed`, because the [ci-change](ci-change.md) check is
unaffected.

Only the trigger is read. A `workflow_call`-only file that the repo also calls by
local path (`uses: ./.github/workflows/<file>`) would be misread as shipped. The
fleet survey for rmartz/dotfiles#1581 found none, and the facts carry only
changed workflows, so the check can't see an unchanged caller.

## Exemptions

A **release-please release PR** is skipped entirely: one carrying
`autorelease: pending`, or titled `chore[(scope)]: release …`. Its title is a
contract with release-please, which must parse its own merged release PR.

## Not covered here

Whether a CI **loosening** was bundled with unrelated work is a judgment about
the PR's composition, not its title, and stays with the review.
