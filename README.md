# @rmartz/pr-policy

**Is this pull request's content acceptable under policy?** `pr-policy` answers
that on every PR, statically, from the PR's diff, title, description, and changed paths. It
doesn't rely on a reviewer remembering to check.

Each policy rule is a small read-only classifier. All of them report into **one**
`pr-policy` check-run, which the consumer's ruleset requires. A fixable problem
(a bad title) turns it red; a PR waiting on a human sign-off shows it as
pending, not failing. Either holds the merge. Adding a rule later never adds a
new required-status name.

## Checks

| Check                                                                 | Blocks when                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocking labels** ([docs](docs/checks/merge-block.md))              | The PR carries `do not merge`, `dnm`, `blocked`, or `escalation needed` (shows as pending).                                                                                                                                                                                                                                |
| **CI-change classification** ([docs](docs/checks/ci-change.md))       | A `.github/workflows/**` change loosens CI (a removed job, `continue-on-error`, a narrowed trigger, …) and no human has applied `CI change approved` (shows as pending). Owns `CI approval needed`.                                                                                                                        |
| **Base branch** ([docs](docs/checks/base-branch.md))                  | The PR targets a branch other than the default and it isn't a non-epic PR on an open epic's branch. A stacked PR waits for its base PR (shows as pending); a base no open PR heads blocks.                                                                                                                                 |
| **Title-type rules** ([docs](docs/checks/title.md))                   | The squash title isn't a valid Conventional Commit, puts `!` on a non-functional type, disagrees with the `breaking change` label, types a linter/formatter bump as a non-release, non-`ci` type, or changes paths its type rules out (`docs`, `test`, `refactor`, `ci`).                                                  |
| **UAT sign-off** ([docs](docs/checks/uat.md))                         | The [sign-off classifier](docs/sign-off-classifier.md) says the PR needs UAT (it isn't trivial, a `docs`/`test`/`refactor` title, or covered by a CI sign-off, and the repo hasn't turned UAT off), and no trusted user has applied `no UAT needed`, or `UAT passed` (or `tested`) since the last push (shows as pending). |
| **Dependabot claim verification** ([docs](docs/checks/dependabot.md)) | A Dependabot PR touches a non-dependency path, changes a dependency its description doesn't claim, pins a version other than the claimed one, or edits anything Dependabot never edits (a `package.json` script, a workflow step).                                                                                         |
| Domain labels (backlog)                                               | Never blocks. Additive path-glob → domain-label map.                                                                                                                                                                                                                                                                       |
| Milestone inheritance (backlog)                                       | Never blocks. Issue → PR milestone.                                                                                                                                                                                                                                                                                        |

The design, and why this is separate from `merge-safety` and `pr-lifecycle`, is
in [docs/decisions.md](docs/decisions.md).

## Using it

Add the [`rmartz/pr-policy-action`](https://github.com/rmartz/pr-policy-action)
caller workflow and require the `pr-policy` status on your default branch. Setup
is in its [consumer guide](https://github.com/rmartz/pr-policy-action/blob/main/docs/consuming.md).
A repo with nothing to user-test adds `.github/pr-policy.yml` with `uat: off`
([repo config](docs/config.md)).

## Library and CLI

Every check is importable, and so is the [sign-off classifier](docs/sign-off-classifier.md)
(`classifySignOff`, `loadRepoConfig`) that rmartz/pr-lifecycle shares. The
`pr-policy` CLI is a thin wrapper around them:

```bash
pr-policy evaluate --pr 12 --repo rmartz/pr-policy        # post the check-run, status + labels
pr-policy evaluate --pr 12 --repo rmartz/pr-policy --json # evaluate only, change nothing
pr-policy evaluate --facts pr.json --config pr-policy.yml # offline, from a JSON facts file
```

## Documentation

- [What pr-policy is](docs/overview.md)
- [Policy checks](docs/checks/index.md)
- [The check-run and label contract](docs/check-run-contract.md)
- [Adding a policy check](docs/adding-a-check.md)
- [How pr-policy reaches consuming repos](docs/distribution.md)
- [Design decisions](docs/decisions.md)

---

🤖 Created by Claude Opus 5.5
