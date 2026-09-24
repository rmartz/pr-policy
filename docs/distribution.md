---
type: Design
title: How pr-policy reaches consuming repos
description: The npm package this repo publishes, the rmartz/pr-policy-action composite Action that consumers pin and Dependabot bumps, and how this repo gates itself through that same Action.
tags: [pr-policy, distribution, github-actions]
---

# How pr-policy reaches consuming repos

## The package (this repo)

`@rmartz/pr-policy` is published to npmjs (public, with provenance; versions up to
0.2.0 were also published to GitHub Packages and stay there) by
[release.yml](../.github/workflows/release.yml) on every releasable push to
`main`. The version lives only in the git tag. `package.json` stays `0.0.0`.

## The Action: `rmartz/pr-policy-action`

Consumers don't install the CLI themselves. The
[`rmartz/pr-policy-action`](https://github.com/rmartz/pr-policy-action) composite
Action pins a released CLI in its own lockfile and re-releases whenever
Dependabot bumps that pin, following `repo-hygiene-action` and
`bot-automerge-action`. A consumer adds one `pull_request_target` caller
workflow, pins the Action by SHA, and requires the `pr-policy` status. The caller,
its permissions, and why `pull_request_target` is safe here are in the Action's
[consumer guide](https://github.com/rmartz/pr-policy-action/blob/main/docs/consuming.md).

So a change here reaches consumers in three hops: a release of this package, a
Dependabot bump and release of the Action, then each consumer's Dependabot bump
of its Action pin.

## Self-consumption

This repo gates its own PRs through the same released Action
([pr-policy.yml](../.github/workflows/pr-policy.yml)), and `pr-policy` is a
required check on its ruleset. It is judged by the **released** policy, never by
the code under review, so a change to a check takes effect here only after it
ships through the Action like it does everywhere else.
