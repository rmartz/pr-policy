---
type: Library
title: UAT sign-off
description: The uat check — a hard merge gate that holds every PR until it is statically trivial or carries a trusted no UAT needed or UAT passed label — the trivial-PR rules and their fleet replay, the label actor check, and what it deliberately leaves to other parties.
resource: src/checks/uat/index.ts
tags: [pr-policy, uat, sign-off, merge-gate]
---

# UAT sign-off

The `uat` check (`src/checks/uat/`) makes user-acceptance testing a hard merge
gate. It **holds by default**: `pr-policy` stays pending until one of these is
true.

1. **The PR is statically trivial:** every path it touches is in an exempt
   category (below).
2. **`no UAT needed` is on the PR,** applied by the review agent or a person.
3. **`UAT passed` is on the PR,** applied by a person. Its old name, `tested`,
   counts too while the fleet rename (rmartz/dotfiles#1572) is in progress.

A missing label is a `hold`, never "not required". That's what makes the gate
race-free: pr-lifecycle can approve a PR and arm auto-merge at any point, and
the merge still waits here. The check never applies or removes a UAT label.

## Trivial PRs

A PR is trivial when **every** changed path (including the old path of a
rename) falls in one of these categories. One path outside them and the gate
holds. The rules **only ever exempt**; they never add a requirement. Deciding a
PR _does_ need UAT is the review agent's judgment, expressed through the labels.

| Category         | Paths                                                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **docs**         | `*.md` anywhere, and anything under `docs/`. Not `*.mdx`, which renders as UI.                                                                                                                                                                                                          |
| **tests**        | Anything under a `test`, `tests`, `__tests__`, `__snapshots__`, `__mocks__`, or `e2e` directory; `*.test.*` / `*.spec.*` JS and TS files; `test_*.py`, `*_test.py`, `conftest.py`.                                                                                                      |
| **ci**           | `.github/workflows/**` and `.github/actions/**`, except a [shipped reusable workflow](title.md#shipped-reusable-workflows-are-product-code) (`workflow_call`-only), which is the product consumers call.                                                                                |
| **dependencies** | Lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `poetry.lock`, `uv.lock`, …), `requirements*.txt`, and a `package.json` whose change touches **only** the dependency blocks and `packageManager`. A change to `scripts`, `exports`, or `pnpm.overrides` doesn't qualify. |
| **metadata**     | The rest of `.github/**` (Dependabot config, `CODEOWNERS`, templates), `.vscode/**`, and root-level `LICENSE`, `CODEOWNERS`, `.gitignore`, `.gitattributes`, `.editorconfig`.                                                                                                           |

The `package.json` rule parses both sides and compares what's left after
removing the dependency fields. The same structural helpers back the
[ci-change](ci-change.md) and [title](title.md) checks.

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
| No sign-off label                      | `hold`                            | pending          |

The caller runs on `labeled` / `unlabeled`, so applying a label re-evaluates
the PR straight away. See the Action's consumer guide in
[distribution.md](../distribution.md).

## Stale labels across pushes

A `no UAT needed` applied to an earlier head stays on the PR after a push that
might need UAT. This check doesn't track heads, because two other parties cover
it: pr-lifecycle disarms auto-merge on a push (the approval goes stale), and the
review agent updates its UAT labels **before** posting its verdict
(rmartz/dotfiles#1583). A re-armed PR therefore never passes on a stale
exemption. Whether a person's `UAT passed` should survive a push that changes
what was tested is still open. See [decisions.md](../decisions.md).
