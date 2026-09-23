# @rmartz/pr-policy

**Is this pull request's content acceptable under policy?** `pr-policy` answers
that on every PR, statically, from the PR's diff, title, and changed paths. It
doesn't rely on a reviewer remembering to check.

Each policy rule is a small read-only classifier. All of them report into **one**
`pr-policy` check-run, which the consumer's ruleset requires. A blocking finding
turns it red and holds the merge. Adding a rule later never adds a new
required-status name.

> **Status: scaffold.** The suite framework, CLI, and repo infrastructure are in
> place. No policy checks are registered yet, so every PR passes. The planned
> checks are listed below.

## Planned checks

| Check                           | Blocks when                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI-change classification**    | A `.github/workflows/**` change loosens CI (a removed job, `continue-on-error`, a narrowed trigger, …) and no human has applied `CI change approved`. Owns `CI approval needed`. |
| **Title-type rules**            | The squash title isn't a valid Conventional Commit, puts `!` on a non-functional type, or types a workflow change as anything but `ci` without the `breaking change` label.      |
| Domain labels (backlog)         | Never blocks. Additive path-glob → domain-label map.                                                                                                                             |
| Milestone inheritance (backlog) | Never blocks. Issue → PR milestone.                                                                                                                                              |

The design, and why this is separate from `merge-safety` and `pr-lifecycle`, is
in [docs/decisions.md](docs/decisions.md).

## Library and CLI

Every check is importable. The `ai-pr-policy` CLI is a thin wrapper around them:

```bash
ai-pr-policy evaluate --facts pr.json   # print the pr-policy report as JSON
```

## Documentation

- [What pr-policy is](docs/overview.md)
- [The check-run and label contract](docs/check-run-contract.md)
- [Adding a policy check](docs/adding-a-check.md)
- [How pr-policy reaches consuming repos](docs/distribution.md)
- [Design decisions](docs/decisions.md)

---

🤖 Created by Claude Opus 5.5
