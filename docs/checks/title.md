---
type: Library
title: Title-type rules
description: The title check — the Conventional-Commit grammar a squash title must meet, the `[WIP]` marker block, the breaking-marker and label consistency rules, the dependency-major rule and its `contained break` waiver, dependency major bumps as breaking changes, when ci-typing is required or only recommended, the paths a docs, refactor, or test PR may change, why a shipped reusable workflow is product code, and the release-please exemption. Violations block until the title is edited; the check never renames a PR.
resource: src/checks/title/index.ts
tags: [pr-policy, title, conventional-commits, releases]
---

# Title-type rules

The repo squash-merges with the PR title, so the title **is** the commit subject
that reaches `main` and drives semantic-release. Nothing rewrites it at merge,
so the `title` check (`src/checks/title/`) blocks until it is right. Every rule
below is a `block`: the author (or a fix pass) can always clear it by editing
the title or a label. The one exception is the own-CI note, which is `info`. The
check never renames the PR itself.

## The rules

| Rule                     | Blocks when                                                                                                                                                           | Fix                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **`[WIP]` marker**       | The title contains `[WIP]` anywhere (any case). A marker inside a word or without brackets doesn't count. The other rules judge the title without it.                 | Remove `[WIP]` when the work is done.                                                                             |
| **Grammar**              | The title isn't `<type>[(<scope>)][!]: <subject>` with a known type. Same grammar as `commit-convention.yml`, the post-merge tripwire.                                | Retitle.                                                                                                          |
| **`!` type**             | `!` on a non-functional type (anything but `feat`/`fix`/`perf`/`revert`). It would cut a spurious major.                                                              | Drop the `!`.                                                                                                     |
| **Label type**           | `breaking change` on a non-functional type.                                                                                                                           | Remove the label, or retitle to the functional type.                                                              |
| **Label without `!`**    | A functional type labelled `breaking change` or `hotfix` whose title has no `!`, so the release would miss the major.                                                 | Add the `!` (the finding spells out the exact title).                                                             |
| **`!` without label**    | A functional `!` title without `breaking change`. The two must agree.                                                                                                 | Add the label, or drop the `!`.                                                                                   |
| **Dependency majors**    | A functional type with neither `!` nor a breaking label, whose `package.json` or `requirements*.txt` raises a dependency's major version.                             | Add the `!` and `breaking change` (the finding spells out the title), or [waive it](#waiving-a-dependency-major). |
| **Waiver conflict**      | `contained break` alongside a `!` title or a breaking label.                                                                                                          | Remove `contained break`, or drop the `!` and the breaking label.                                                 |
| **Sensitive tool bumps** | A version change to `eslint`, `prettier`, `black`, `ruff`, or `pylint` in a `package.json` or `requirements*.txt`, on a type that is neither `ci` nor a release type. | Retitle `ci(deps): …`. Never `!` or `breaking change` for it.                                                     |
| **`docs` paths**         | A `docs` title on a PR that changes any non-Markdown (`.md`) file: code, CI, config, or a manifest. A rename's old path counts.                                       | Retitle to the non-docs change's type, or split the PR.                                                           |
| **`refactor` tests**     | A `refactor` title on a PR that adds, changes, removes, or renames a non-Markdown test file.                                                                          | Land the test change first as a `test:` PR, then refactor.                                                        |
| **`test` paths**         | A `test` title on a PR that changes any file that is neither a test nor Markdown: code, CI, or config.                                                                | Retitle to the non-test change's type, or split the PR.                                                           |

A new linter or formatter can change results on files a PR never touched, so the
coordinator must re-test in-flight PRs against it, and it keys that off the `ci`
type. A **release type** (`feat`/`fix`/`perf`/`revert`) is never told to retitle
to `ci`: that would suppress the release.

A dependency major bump is treated as a breaking change on a functional type, so
the release cuts a major. The versions are compared structurally, like the
sensitive-tool rule: each manifest is parsed on both sides, and a package only
added, only removed, or downgraded is not a bump. The manifest's own `version`
field is not a dependency, so a release PR never trips it. A person can waive it
with `contained break` when the bump doesn't reach this package's consumers; see
[Waiving a dependency major](#waiving-a-dependency-major). This rule moved here
from merge-safety, which used to add the label itself.

## Waiving a dependency major

A dependency's major bump isn't always a break for the package's consumers. A
wrapper Action that absorbs its CLI's renamed bin keeps its inputs, outputs,
and behavior. Marking it `!` would cut a spurious major.

When a reviewer confirms that, they add `contained break` instead of the `!` and
the label. It counts only when a user with write, maintain, or admin permission
applied it, read through `signOffState` like every sign-off (see
[who can sign off](uat.md#who-can-sign-off)). An agent acting with that user's
token qualifies. A trusted waiver replaces the block with an `info` finding
naming who waived it. An untrusted one leaves the block and says why it doesn't
count.

It waives only the dependency-major rule. On a PR that is also marked breaking
it contradicts the `!`, so the check blocks until one of them goes.

## Type-versus-paths rules

`docs`, `refactor`, and `test` don't release, so each type makes a promise about
what the PR touches (`src/checks/title/type-paths.ts`):

- **`docs` changes only Markdown.** Otherwise a code, CI, or config change
  merges under a type that never releases, and never ships.
- **`refactor` leaves the tests alone.** A refactor claims to keep behaviour the
  same, and the unchanged tests are the evidence. Coverage comes first, in a
  `test:` PR that adds tests without changing code; the refactor lands
  against those tests. A refactor that must touch test imports (after moving a
  module, for example) is split the same way.
- **`test` changes only tests.** It locks in current behaviour, so it may add or
  change test files and fixtures but no code. Test tooling config (such as
  `vitest.config.ts`) is not a test path, so it needs its own type.

`refactor` and `test` may both change docs alongside their main change: Markdown
is always allowed and is never counted as a test, even under a test directory.

A test path is a test, snapshot, or mock directory, a `*.test.*` / `*.spec.*` JS
or TS file, a Storybook story (`*.stories.*` JS and TS files, and
`*.stories.mdx`), or a Python or Go test-file convention: whatever the UAT
gate's [tests category](uat.md) counts. Both checks read the one definition in
`src/checks/test-paths.ts`, so a path is never a test to one and code to the
other.

## Own-CI changes: a note, never a block

A substantive change to this repo's own CI on a non-`ci`, non-release type gets
an `info` finding recommending `ci(<scope>): …`. It never gates. The coordinator
now rebases siblings on a CI change by its **paths** (`.github/workflows/**`,
`.github/actions/**`), not its title, so the type no
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
local path (`uses: ./.github/workflows/<file>`) would be misread as shipped. A fleet
survey found none, and the facts carry only
changed workflows, so the check can't see an unchanged caller.

## Exemptions

A **release-please release PR** is skipped entirely: one carrying
`autorelease: pending`, or titled `chore[(scope)]: release …`. Its title is a
contract with release-please, which must parse its own merged release PR.

## Not covered here

Whether a CI **loosening** was bundled with unrelated work is a judgment about
the PR's composition, not its title, and stays with the review.
