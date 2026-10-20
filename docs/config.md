---
type: Library
title: Repo config
description: The .github/pr-policy.yml file a repo uses to tune pr-policy and pr-lifecycle — its schema (uat on or off), why it is read from the base branch and never the PR head, how a bad file fails closed, the loadRepoConfig and parseRepoConfig exports, and the deprecated skip-uat override it replaces.
resource: src/repo-config.ts
tags: [pr-policy, config, uat]
---

# Repo config

A repo tunes the policy with one file, **`.github/pr-policy.yml`**. pr-policy
and rmartz/pr-lifecycle both read it, so the gate and the label writer can't
disagree about a setting.

```yaml
uat: off # this repo has nothing to user-test
```

| Key   | Values                                | Default | Effect                                                                                                                                           |
| ----- | ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uat` | `on`, `off` (or YAML `true`, `false`) | `on`    | `off` makes the [sign-off classifier](sign-off-classifier.md) answer `none` for every PR that doesn't need a CI sign-off, so no PR waits on UAT. |

## Read from the base branch

The file is read from the PR's **base branch**, never its head. A PR that adds
or edits the file can't turn a gate off for itself: the change applies to later
PRs, once it has merged.

## A bad file fails closed

- **Missing file:** the defaults (UAT on). No finding.
- **Unparseable YAML, a non-mapping, an unknown key, or an unknown value:** the
  whole file is ignored and the defaults apply. A half-read file never loosens a
  gate. The `uat` check adds an `info` finding saying the file was ignored and
  why.
- **A failed read** (the API call itself fails): the run fails loudly, like every
  other fact read, rather than guessing.

## Library API

Both are exported from the package entry point, for rmartz/pr-lifecycle.

- `parseRepoConfig(text | undefined)` is pure. Pass the file's text, or
  `undefined` when the base branch has none. It returns `{ config, problems }`;
  `problems` is empty unless the file was ignored.
- `loadRepoConfig({ repo }, baseRef)` reads the file at `baseRef` through `gh`
  and parses it. It lists `.github/` first, because `gh` reports a missing file
  and a failed read the same way.

`selectChecks({ repoConfig })` takes the loaded result. The CLI loads it from the
PR's base branch with `--pr`; with `--facts`, `--config <path>` supplies a local
file instead.

## `skip-uat` is deprecated

`--skip-uat` (CLI), `selectChecks({ skipUat })`, and pr-policy-action's
`skip-uat` input still drop the UAT gate entirely, and win over the file. Set
`uat: off` instead. rmartz/pr-policy#85 removes the override once the fleet has
moved to the file.
