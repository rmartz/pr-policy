---
type: Design
title: How pr-policy reaches consuming repos
description: The npm package this repo publishes, the rmartz/pr-policy-action composite Action that consumers pin and Dependabot bumps, how this repo gates itself through that same Action, and how a hosted caller runs the library with a token instead of gh.
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

## Hosted callers: the library with a token

A caller with no `gh` binary, such as the gate App's webhook server in
[`rmartz/pr-lifecycle-app`](https://github.com/rmartz/pr-lifecycle-app), runs
the library directly. Every GitHub call in `src/github/` goes through one
`GitHubClient` ([`src/github/client.ts`](../src/github/client.ts)), with two
implementations:

| Client              | Used by                | Reaches GitHub through                                                     |
| ------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `createGhClient`    | the CLI and the Action | the vendored `gh` transport, with its retry and GraphQL fallback (default) |
| `createFetchClient` | hosted callers         | `fetch` with a bearer token, following `Link` pagination, with no retry    |

The I/O functions (`gatherFacts`, `openPullRequestsAtHead`, `applyLabelEdits`,
`postVerdict`) take a target whose optional `client` selects the transport.
Without one they use `gh` in the target's `cwd`, so the CLI is unchanged:

```ts
const client = createFetchClient({ token: installationToken });
const target = { repo: 'owner/name', pr: 42, client };
const { facts, headSha } = await gatherFacts(target);
const evaluation = await evaluatePolicy(facts, selectChecks({ skipUat: false }));
await applyLabelEdits(target, evaluation);
await postVerdict(target, headSha, evaluation);
```

Both clients fail the same way. A read returns `null`, and a read the facts
depend on throws rather than reading as "absent". The tests run every gatherer
over both clients against the same raw API responses.
