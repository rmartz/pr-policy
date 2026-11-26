---
type: Library
title: UAT sign-off
description: The uat check — a hard merge gate that holds every PR until its paths or a refactor title exempt it, or it carries a trusted UAT passed or no UAT needed applied after the current head was pushed — the trivial-PR rules and their fleet replay, why Dependabot PRs pass with no labels, who applies each sign-off under the session-driven process, the label actor check, the head binding and the push time it reads, the UAT needed label it keeps on PRs waiting for a sign-off, turning the gate off for a repo without UAT, and why the legacy tested alias was dropped.
resource: src/checks/uat/index.ts
tags: [pr-policy, uat, sign-off, merge-gate]
---

# UAT sign-off

The `uat` check (`src/checks/uat/`) makes user-acceptance testing a hard merge
gate. It **holds by default**: `pr-policy` stays pending until one of these is
true.

1. **The PR doesn't need UAT.** Every path is in an exempt category (below), or
   the title is a [`refactor`](#refactors).
2. **`UAT passed` or `no UAT needed` is on the PR,** applied by a trusted user
   **after the current head was pushed** (see
   [below](#sign-offs-are-bound-to-the-head)).

A missing sign-off is a `hold`, never "not required". That's what makes the gate
race-free: auto-merge can be armed at any point, and the merge still waits here.
The check never applies or removes a sign-off label. It keeps its own
[`UAT needed`](#uat-needed-marks-prs-waiting-for-a-sign-off) label in step with
the verdict.

## Who applies the sign-off

Each PR is driven by the agent session that opened it. For a **minor** change
(a bug fix, a small adjustment) the session tests the changed behaviour itself
on the current head, records what it checked on the PR, and applies
`no UAT needed`. For a **major**
change a person tests it, and the session applies `UAT passed` once they OK the
current head. Agents act with the user's token, so both count as a trusted user
(see [who can sign off](#who-can-sign-off)).

## Trivial PRs

**UAT is exclusively for the product's user-facing functional behaviour**:
what the repository's product does for its users. Every path that isn't the
product is exempt. Tooling is never user-facing, and CI is the clearest
example: a workflow, a repo script, or lint config changes how the repo is
built and checked, not what its users see. Whether it weakens a check is the
[CI sign-off](ci-change.md)'s question, never UAT's. See
[decisions.md](../decisions.md#uat-is-only-for-the-products-user-facing-behaviour).

A PR is trivial when **every** changed path (including the old path of a
rename) falls in one of these categories. One path outside them and the gate
holds. The rules **only ever exempt**; they never add a requirement. Deciding a
PR _does_ need UAT is the judgment of the session driving the PR, expressed
through the labels.

| Category         | Paths                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **docs**         | `*.md` anywhere, and anything under `docs/`. Not `*.mdx`, which renders as UI.                                                                                                                                                                                                                                                                                                                                                                             |
| **tests**        | Anything under a `test`, `tests`, `__tests__`, `__snapshots__`, `__mocks__`, or `e2e` directory; `*.test.*` / `*.spec.*` JS and TS files; Storybook stories (`*.stories.*` JS and TS files, and `*.stories.mdx`); `test_*.py`, `*_test.py`, `conftest.py`; `*_test.go`. A test-only change has nothing to user-test, and a story never ships in the app. The title check's `test` and `refactor` rules share this definition (`src/checks/test-paths.ts`). |
| **ci**           | `.github/workflows/**` and `.github/actions/**`, except a [shipped reusable workflow](title.md#shipped-reusable-workflows-are-product-code) (`workflow_call`-only), which is the product consumers call.                                                                                                                                                                                                                                                   |
| **tooling**      | Linter, formatter, test-runner, and repo-tooling config by file name at any depth (`eslint.config.*`, `.prettierrc*`, `vitest.config.*`, `.repo-hygiene.yml`, `.pre-commit-config.yaml`, `.releaserc*`, …), and the repo's own scripts under a top-level `scripts/` (audits, CI checks, release helpers). Build, app, and deploy config (`tsconfig.json`, `next.config.*`, `vercel.json`) is product, not tooling.                                         |
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
- Most of the 97 not exempted then changed CI scripts (`scripts/*.mjs`), lint
  config (`eslint.config.js`), or `.repo-hygiene.yml`. None of those is
  user-facing, so the **tooling** category now exempts them too.

There is no per-repo override yet. Add one only if a repo's replay shows rules
that don't fit it.

### Refactors

A PR whose title parses as `refactor` (any scope) passes too, whatever code it
changes. A refactor changes no behaviour, so there is nothing to user-test. The
[title check](title.md) already blocks a `refactor` that touches a test file,
and a behaviour change mislabeled `refactor` would also lose its release. Why a
title may exempt here is in [decisions.md](../decisions.md#uat-is-only-for-the-products-user-facing-behaviour).

### Dependabot PRs

`bot-automerge` merges Dependabot PRs unreviewed, and nothing labels them, so
in a repo with UAT on each must pass this check with no labels at all. They do:
an npm bump changes only `package.json` dependency blocks and the lockfile
(**dependencies**), and a GitHub Actions bump changes only workflow pins
(**ci**). `test/evaluate.test.ts` pins both through the whole suite.

The gaps: an Actions bump to a
[shipped reusable workflow](title.md#shipped-reusable-workflows-are-product-code),
which is product, holds; so does a bump in an ecosystem with no exempt path
kind, such as `pyproject.toml`, `go.mod`, `Gemfile`, or a `Dockerfile`. None of
the repos that keep UAT on uses either: they are npm and GitHub Actions only.

## Who can sign off

A label records nobody, so the check reads the PR's `labeled` events. A sign-off
counts only if the **latest** `labeled` event for it names a `User` with
**write, maintain, or admin** permission on the repo. That rejects GitHub Apps,
bots, and triage-only users. Agents act with the user's token, so they pass,
which is intended for both labels. That `UAT passed` follows a person's OK
stays a convention, not a rule. The same trust rule applies to the CI gate's
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
| Sign-off applied before the head       | `hold`, plus `info` saying why    | pending          |
| No sign-off label                      | `hold`                            | pending          |

The caller runs on `labeled` / `unlabeled`, so applying a label re-evaluates
the PR straight away. See the Action's consumer guide in
[distribution.md](../distribution.md).

## Repos without UAT

A repo can choose to drop the gate. Pass `--skip-uat` to the
CLI, or `selectChecks({ skipUat: true })` to `evaluatePolicy` in the library.
The `uat` check then doesn't run: it adds no findings and gets no per-check
status. The title and CI-change checks, and the `CI change approved` trust
check, are unchanged. The setting belongs to the caller, never the PR. Nothing
removes a [`UAT needed`](#uat-needed-marks-prs-waiting-for-a-sign-off) left from
before the switch, so remove those by hand. See
[decisions.md](../decisions.md).

## Sign-offs are bound to the head

`UAT passed` and `no UAT needed` both say the current head was tested: by a
person, or by the session for a minor change. So each counts only when it was
applied **after the current head was pushed**. Any new head needs testing
again, including a clean rebase. A push after the sign-off re-holds the gate
until whoever tests re-applies the label. Why is in
[decisions.md](../decisions.md#uat-sign-offs-dont-survive-a-new-head).

The check compares two times GitHub records, never a commit date, which the
pusher writes and can forge:

- **Applied at:** the time of the label's latest `labeled` event, the same event
  the [actor check](#who-can-sign-off) reads. Only removing the label and
  adding it again moves this time forward: adding a label the PR already has
  records no event. The stale-label finding says so.
- **Pushed at:** the later of the PR's latest `head_ref_force_pushed` event and
  the creation of the head commit's earliest check suite. GitHub creates a
  commit's check suites when it is first pushed.

The label must be strictly later. When either time is unknown, the label doesn't
count, so the gate fails closed. A stale sign-off is set aside before trust is
judged: the check holds with an `info` finding saying why, and a current trusted
sign-off beside it still passes. The check never removes the stale label.

A commit first pushed to another branch has its earliest check suite from that
first push. So a commit pushed elsewhere, then fast-forwarded onto the PR after
the sign-off was applied, would read as already pushed. A force push is caught
by its event.

The push time is read only while a sign-off is on the PR. A caller passing a
facts document sets `headPushedAt` and each sign-off's `appliedAt`; without
them, neither sign-off counts.

PRs that [need no UAT](#trivial-prs), Dependabot's included, carry no sign-off,
so the binding never touches them.

## `UAT needed` marks PRs waiting for a sign-off

The check applies `UAT needed` while it holds a PR for a sign-off, so people can
filter for PRs waiting on their UAT. It removes the label once a trusted,
current `UAT passed` or `no UAT needed` passes the gate, or once the PR no
longer needs UAT (its paths or title now exempt it). A push that leaves the
sign-off stale puts it back. The label is the check's own: it is
[contract](../check-run-contract.md#uat-needed-the-uat-wait-label) and this
package owns it outright, as it owns `CI approval needed`. Unlike that label it
isn't an audit record, so it comes off when the gate passes.

**Drafts never carry it.** A draft isn't ready for UAT, so the check removes the
label when a PR turns draft and adds it when the PR is marked ready, if the gate
still holds. The gate itself holds a draft just the same; only the label waits.
A facts document without `draft` reads as ready for review. The caller re-runs
on `ready_for_review` and `converted_to_draft`, so the label follows the flip.

Adding a label a repo doesn't have creates it, as GitHub does for any label
added to an issue, with a default colour and no description. With the gate
[turned off](#repos-without-uat) the check doesn't run, so it never applies or
removes the label.

## `tested` no longer counts

`tested` was the old name of `UAT passed`, read while pr-lifecycle renamed it
across the fleet. With pr-lifecycle retired nothing writes it, and the session
that drives each PR applies `UAT passed` directly, so the same major release
dropped it. An open PR that carries only `tested` holds until `UAT passed` is applied,
which a head-bound sign-off needs after any push anyway.
