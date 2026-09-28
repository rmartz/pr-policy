---
type: Library
title: Dependabot claim verification
description: The dependabot check — for a PR opened by dependabot[bot], parse the updates its description claims and block on any path, dependency, version, or edit the claim doesn't cover, so bot-automerge only merges what the bot said it changed — the claim forms, the per-ecosystem rules, what is allowed but not yet verified, and the fleet replay.
resource: src/checks/dependabot/index.ts
tags: [pr-policy, dependabot, dependencies, auto-merge]
---

# Dependabot claim verification

The `dependabot` check (`src/checks/dependabot/`) verifies that a Dependabot PR
changes only the updates its description claims. `bot-automerge` merges these
PRs without a human review, which rests on an unstated premise: the PR is what
the bot says it is. Dependabot doesn't lie. The risk is someone else, a person
or an agent, pushing a commit onto a Dependabot branch, which then rides the
auto-merge path. This check enforces the premise.

It applies only to PRs opened by `dependabot[bot]`. For any other author it
reports nothing.

Every mismatch is a `block`. The fix is the author's to make: drop the foreign
change, or comment `@dependabot recreate`. A clean PR gets one headline `info`,
"Dependabot PR matches its N claimed updates".

## The claim

The claim is read from the **description**, not the title. A review agent may
retitle the PR (`chore(deps):` → `ci(deps):`), but nothing rewrites the body.
The body is also re-checked when it changes, because `pr-policy` runs on
`edited`. `src/checks/dependabot/claims.ts` reads these forms:

| Form                                                    | Gives                                                |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `Bumps [name](url) from A to B.`                        | `name`, target `B` (a single update)                 |
| ``Updates `name` from A to B``                          | `name`, target `B` (each entry of a grouped update)  |
| ``\| [name](url) \| `A` \| `B` \|``                     | `name`, target `B` (a row of a large group's table)  |
| `Bumps the <group> group …: [a](url) and [b](url).`     | `a`, `b`, no target (the names a group header lists) |
| `Updates the requirements on [name](url) …` / `Removes` | `name`, no target (a range change or a removal)      |

Dependabot truncates a long description, which cuts off the per-package
`Updates` lines. The table and the group header come first and survive, so a
truncated group still claims every package. A claim with no target allows any
version.

Two claim rules:

- **No claim is a block.** A Dependabot-authored PR whose body yields no claim
  was edited or truncated beyond recognition.
- **The title must agree.** If the title names one package
  (`bump prettier from 3.9.8 to 3.9.9`), that package must be claimed. A group
  title names none and isn't checked.

## What is verified

Every changed path, including the old path of a rename, must be a dependency
file (`src/checks/dependabot/paths.ts`). Any other path is a block.

| Path                                   | How it's checked                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`                         | Both sides parsed. Every changed entry in the dependency blocks, `overrides`, `resolutions`, `pnpm.overrides`, and `packageManager` must be claimed, and the new spec must pin the claimed version (`^3.9.9` pins `3.9.9`; `^3.9.10` doesn't). Any other field changing (`scripts`, `exports`, the rest of `pnpm`) is a block. |
| `requirements*.txt`                    | The same, per pinned requirement, with PEP 503 name normalization. Any other line changing (a `-r` include, an `--extra-index-url`) is a block.                                                                                                                                                                                |
| `.github/workflows/*.yml`              | The documents must be equal once every `uses:` ref is stripped, which is the normalization the ci-change and title checks use. Every action whose ref moved must be claimed (case-insensitive).                                                                                                                                |
| Lockfiles, other ecosystems' manifests | Allowed, but not content-verified. Reported in one `info` finding so the check never implies it read them. Covers `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `poetry.lock`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `Gemfile`, a `Dockerfile`, a composite `action.yml`, and similar.                               |

A verified manifest or workflow that was added or deleted is a block, because
Dependabot only edits existing files. So is one that no longer parses.

A claimed package that changed only in the lockfile passes. A range that
already allowed the new version needs no manifest edit.

## What it leaves out

These are tracked in rmartz/pr-policy#23:

- **Lockfile contents.** A lockfile carries legitimate transitive churn, so it
  can't be held to the claimed set. The planned rules bound it instead: an
  unclaimed direct dependency's resolved version must not move; no `integrity`
  or `resolved` change at the same version; no registry-host change.
- **Action versions.** A SHA-pinned `uses:` carries its version only in a
  `# vX.Y.Z` comment, which the YAML parse drops. So the check verifies the
  action's name, not its version.
- **Other ecosystems' manifests,** including composite `action.yml` files.

## Validated against fleet Dependabot PRs

The check was replayed read-only over the 100 most recent Dependabot PRs across
the rmartz fleet, open and merged: npm (pnpm and npm lockfiles), grouped and
single updates, github-actions, and reusable-workflow bumps. All 100 pass. The
replay found both truncation cases above: a 19-update group with only its table
intact (pr-shepherd#423) and a 4-update group that lost its last `Updates` line
(pr-shepherd#406). The table and group-header forms were added for them.
