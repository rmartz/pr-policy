# @rmartz/pr-policy

**Is this pull request's content acceptable under policy?** `pr-policy` answers
that on every PR, statically, from the PR's diff, title, and changed paths. It
doesn't rely on a reviewer remembering to check.

Each policy rule is a small read-only classifier. All of them report into **one**
`pr-policy` check-run, which the consumer's ruleset requires. A fixable problem
(a bad title) turns it red; a PR waiting on a human sign-off shows it as
pending, not failing. Either holds the merge. Adding a rule later never adds a
new required-status name.

## Checks

| Check                                                           | Blocks when                                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI-change classification** ([docs](docs/checks/ci-change.md)) | A `.github/workflows/**` change loosens CI (a removed job, `continue-on-error`, a narrowed trigger, …) and no human has applied `CI change approved` (shows as pending). Owns `CI approval needed`.  |
| **Title-type rules** ([docs](docs/checks/title.md))             | The squash title isn't a valid Conventional Commit, puts `!` on a non-functional type, disagrees with the `breaking change` label, or types a linter/formatter bump as a non-release, non-`ci` type. |
| Domain labels (backlog)                                         | Never blocks. Additive path-glob → domain-label map.                                                                                                                                                 |
| Milestone inheritance (backlog)                                 | Never blocks. Issue → PR milestone.                                                                                                                                                                  |

The design, and why this is separate from `merge-safety` and `pr-lifecycle`, is
in [docs/decisions.md](docs/decisions.md).

## Using it

Add the [`rmartz/pr-policy-action`](https://github.com/rmartz/pr-policy-action)
caller workflow and require the `pr-policy` status on your default branch. Setup
is in its [consumer guide](https://github.com/rmartz/pr-policy-action/blob/main/docs/consuming.md).

## Library and CLI

Every check is importable. The `ai-pr-policy` CLI is a thin wrapper around them:

```bash
ai-pr-policy evaluate --pr 12 --repo rmartz/pr-policy          # post the check-run + labels
ai-pr-policy evaluate --pr 12 --repo rmartz/pr-policy --json   # evaluate only, change nothing
ai-pr-policy evaluate --facts pr.json                          # offline, from a JSON facts file
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
