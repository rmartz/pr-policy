---
type: Library
title: UAT sign-off
description: The uat check — a hard merge gate that holds every PR until it is statically trivial, is titled refactor, or carries a trusted no UAT needed, or a UAT passed applied after the current head was pushed — the trivial-PR rules and their fleet replay, the label actor check, the head binding and the push time it reads, turning the gate off for a repo without UAT, and what it deliberately leaves to other parties.
resource: src/checks/uat/index.ts
tags: [pr-policy, uat, sign-off, merge-gate]
---

# UAT sign-off

The `uat` check (`src/checks/uat/`) makes user-acceptance testing a hard merge
gate. It **holds by default**: `pr-policy` stays pending until one of these is
true.

1. **The PR is statically trivial:** every path it touches is in an exempt
   category (below), or its title is a [`refactor`](#refactors).
2. **`no UAT needed` is on the PR,** applied by the review agent or a person.
3. **`UAT passed` is on the PR,** applied by a person **after the current head
   was pushed** (see [below](#uat-passed-is-bound-to-the-head)). Its old name,
   `tested`, counts too while the fleet rename is in progress.

A missing label is a `hold`, never "not required". That's what makes the gate
race-free: pr-lifecycle can approve a PR and arm auto-merge at any point, and
the merge still waits here. The check never applies or removes a UAT label.

## Trivial PRs

A PR is trivial when **every** changed path (including the old path of a
rename) falls in one of these categories. One path outside them and the gate
holds. The rules **only ever exempt**; they never add a requirement. Deciding a
PR _does_ need UAT is the review agent's judgment, expressed through the labels.

| Category         | Paths                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **docs**         | `*.md` anywhere, and anything under `docs/`. Not `*.mdx`, which renders as UI.                                                                                                                                                                                                                                                                                                                                                                             |
| **tests**        | Anything under a `test`, `tests`, `__tests__`, `__snapshots__`, `__mocks__`, or `e2e` directory; `*.test.*` / `*.spec.*` JS and TS files; Storybook stories (`*.stories.*` JS and TS files, and `*.stories.mdx`); `test_*.py`, `*_test.py`, `conftest.py`; `*_test.go`. A test-only change has nothing to user-test, and a story never ships in the app. The title check's `test` and `refactor` rules share this definition (`src/checks/test-paths.ts`). |
| **ci**           | `.github/workflows/**` and `.github/actions/**`, except a [shipped reusable workflow](title.md#shipped-reusable-workflows-are-product-code) (`workflow_call`-only), which is the product consumers call.                                                                                                                                                                                                                                                   |
| **dependencies** | Lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `poetry.lock`, `uv.lock`, …), `requirements*.txt`, and a `package.json` whose change touches **only** the dependency blocks and `packageManager`. A change to `scripts`, `exports`, or `pnpm.overrides` doesn't qualify.                                                                                                                                                                    |
| **metadata**     | The rest of `.github/**` (Dependabot config, `CODEOWNERS`, templates), `.vscode/**`, and root-level `LICENSE`, `CODEOWNERS`, `.gitignore`, `.gitattributes`, `.editorconfig`.                                                                                                                                                                                                                                                                              |

The `package.json` rule parses both sides and compares what's left after
removing the dependency fields. The same structural helpers back the
[ci-change](ci-change.md) and [title](title.md) checks. The categories are
defined once, in `src/checks/path-kinds.ts`, which the title check's
[`ci` rule](title.md#ci-changes-only-ci-and-tooling) reads too.

### Validated against merged fleet PRs

The rules were replayed over 329 recently merged PRs in hidden-role-game,
firebase-nextjs-template, group-picks, trip-planner, personal-budget, and
storybook-ci, and compared with the UAT label `/review` gave each one:

- By path, they exempted **200 of the 297** PRs marked `no UAT needed`,
  including all 103 Dependabot bumps. The replay compared paths only; the
  structural `package.json` rule can only exempt fewer.
- They disagreed with review once by path, and the structural rule resolves it.
  hidden-role-game#827 was a `pnpm.overrides` pin that fixed a production outage
  and was UAT-tested. It fails the dependency-only rule, so the gate holds.
- The 97 not exempted mostly change CI scripts (`scripts/*.mjs`), lint config
  (`eslint.config.js`), or `.repo-hygiene.yml`. Those can change what ships, or
  what a check lets through, so they stay with the review's judgment.

There is no per-repo override yet. Add one only if a repo's replay shows rules
that don't fit it.

### Refactors

A PR whose title parses as `refactor` (any scope) passes too, whatever code it
changes. A refactor changes no behaviour, so there is nothing to user-test. The
[title check](title.md) already blocks a `refactor` that touches a test file,
and a behaviour change mislabeled `refactor` would also lose its release. Why a
title may exempt here is in [decisions.md](../decisions.md#uat-needs-a-behaviour-change).

## Who can sign off

A label records nobody, so the check reads the PR's `labeled` events. A sign-off
counts only if the **latest** `labeled` event for it names a `User` with
**write, maintain, or admin** permission on the repo. That rejects GitHub Apps,
bots, and triage-only users. Agents act with the user's token, so they pass,
which is intended for `no UAT needed`. That `UAT passed` is human-only stays a
convention, not a rule. The same trust rule applies to the CI gate's
`CI change approved`. Why this reads label events is in
[decisions.md](../decisions.md).

When a sign-off label is present but doesn't count, the check still holds and
adds an `info` finding saying why, for example "`app[bot]` is a Bot, not a
person".

| PR state                               | Findings                          | `pr-policy`      |
| -------------------------------------- | --------------------------------- | ---------------- |
| Trivial                                | `info`: the categories it touches | passes this gate |
| Trusted sign-off label                 | `info` headline: label and who    | passes this gate |
| Sign-off label from an untrusted actor | `hold`, plus `info` saying why    | pending          |
| `UAT passed` from before the head      | `hold`, plus `info` saying why    | pending          |
| No sign-off label                      | `hold`                            | pending          |

The caller runs on `labeled` / `unlabeled`, so applying a label re-evaluates
the PR straight away. See the Action's consumer guide in
[distribution.md](../distribution.md).

## Repos without UAT

A repo with nothing to user-test can drop the gate. Pass `--skip-uat` to the
CLI, or `selectChecks({ skipUat: true })` to `evaluatePolicy` in the library.
The `uat` check then doesn't run: it adds no findings and gets no per-check
status. The title and CI-change checks, and the `CI change approved` trust
check, are unchanged. The setting belongs to the caller, never the PR. See
[decisions.md](../decisions.md).

## `UAT passed` is bound to the head

`UAT passed` (and `tested`) says a person tested the code, so it counts only
when it was applied **after the current head was pushed**. Any new head needs a
person to look again, including a verified clean rebase. Why is in
[decisions.md](../decisions.md#uat-passed-doesnt-survive-a-new-head).

The check compares two times GitHub records, never a commit date, which the
pusher writes and can forge:

- **Applied at:** the time of the label's latest `labeled` event, the same event
  the [actor check](#who-can-sign-off) reads.
- **Pushed at:** the later of the PR's latest `head_ref_force_pushed` event and
  the creation of the head commit's earliest check suite. GitHub creates a
  commit's check suites when it is first pushed.

The label must be strictly later. When either time is unknown, the label doesn't
count, so the gate fails closed. A stale `UAT passed` is set aside before trust
is judged: the check holds with an `info` finding saying why, and a trusted
`no UAT needed` beside it still passes. The check never removes the stale
label.

A commit first pushed to another branch has its earliest check suite from that
first push. So a commit pushed elsewhere, then fast-forwarded onto the PR after
`UAT passed` was applied, would read as already pushed. A force push is caught
by its event.

The push time is read only while `UAT passed` or `tested` is on the PR. A
caller passing a facts document sets `headPushedAt` and each sign-off's
`appliedAt`; without them, `UAT passed` doesn't count.

### `no UAT needed` isn't bound to the head

A `no UAT needed` applied to an earlier head still counts. Its staleness is
pr-lifecycle's job. A push that isn't a verified clean rebase makes the approval
stale and disarms auto-merge, and the review agent refreshes its UAT labels
before the next verdict. The waiver carries across exactly the rebases an
approval does, so a stale waiver never sits on an armed PR.
