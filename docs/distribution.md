---
type: Design
title: How pr-policy reaches consuming repos
description: The npm package this repo publishes, the planned rmartz/pr-policy-action composite-Action wrapper that consumers pin and Dependabot bumps, and why its caller needs pull_request_target.
tags: [pr-policy, distribution, github-actions]
---

# How pr-policy reaches consuming repos

## The package (this repo)

`@rmartz/pr-policy` is published to GitHub Packages by
[release.yml](../.github/workflows/release.yml) on every releasable push to
`main`. The version lives only in the git tag. `package.json` stays `0.0.0`.

## The wrapper (planned: `rmartz/pr-policy-action`)

Consumers won't install the CLI themselves. Following the fleet's current
pattern (`rmartz/repo-hygiene-action`, `rmartz/bot-automerge-action`), a separate
composite-Action repo will pin a released CLI in its own lockfile. It will
release itself whenever Dependabot bumps that pin. A consumer then adds one
caller workflow, pins the Action by SHA, and Dependabot keeps the pin current:

```yaml
# .github/workflows/pr-policy.yml in a consuming repo (planned shape)
name: pr-policy
on:
  pull_request_target:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled]
permissions:
  checks: write # post the pr-policy check-run
  pull-requests: write # write the labels pr-policy owns (CI approval needed)
  contents: read # read changed files at the merge base and head
  packages: read # install the CLI from GitHub Packages
jobs:
  pr-policy:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: rmartz/pr-policy-action@<sha> # vX.Y.Z
        with:
          pr: ${{ github.event.pull_request.number }}
```

### Why `pull_request_target`

Under `pull_request`, fork PRs and every Dependabot PR get a read-only token.
Those include Dependabot's own action-version bumps, the PRs that most often
touch workflow files. The check could post neither the check-run nor the label
there. `pull_request_target` runs in the base repo's context with a write token.
That is safe here only because the wrapper **never checks out or executes PR
code**. It reads the PR's files through the API as data.

### Why these event types

`edited` re-runs the title rules when the title changes. `labeled` and
`unlabeled` let `CI change approved` clear the CI finding. `synchronize` keeps
the verdict on the current head.

## Self-consumption

Once `v0.1.0` and the wrapper exist, this repo adds the caller above and makes
`pr-policy` a required check on its own ruleset.
