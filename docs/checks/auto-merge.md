---
type: Library
title: Auto-merge guard
description: The auto-merge check — fails pr-policy when native auto-merge would merge a head whose change differs from the head it was armed on, how a clean branch update or rebase is told apart from a new change, the arm-marker comment it records, the bot exemption, how it fails closed, and the caller triggers it needs.
resource: src/checks/auto-merge/index.ts
tags: [pr-policy, auto-merge, merge-gate]
---

# Auto-merge guard

GitHub keeps native auto-merge enabled across new pushes. An agent that arms
auto-merge on a reviewed head and then pushes a review fix, or resolves a
conflict, would merge that new change with nobody looking at it again. The
`auto-merge` check (`src/checks/auto-merge/`) closes that gap: **while auto-merge
is enabled, the head that will merge must carry the same change as the head
auto-merge was armed on.** A clean branch update or a pure rebase keeps it
green; anything else turns `pr-policy` red.

## What it decides

| PR state                                                                         | Findings | `pr-policy`      |
| -------------------------------------------------------------------------------- | -------- | ---------------- |
| Auto-merge off                                                                   | none     | passes this gate |
| Auto-merge enabled by a bot                                                      | `info`   | passes this gate |
| Armed on the current head                                                        | `info`   | passes this gate |
| Head moved, same change (branch update from base, rebase): **re-armed** there    | `info`   | passes this gate |
| Head moved, different change (a new commit, a review fix, a conflict resolution) | `block`  | red              |
| Armed head unknown (no record, no enable event, a change that can't be read)     | `block`  | red              |

Auto-merge off means `pull_request.auto_merge` is `null`, so a manual merge is
never affected. The fix for every `block` is the same, and the message says so:
re-review the change, then disable and re-enable auto-merge. Re-enabling arms it
on the current head.

## How the armed head is known

GitHub doesn't record which head auto-merge was enabled on, only when: the PR's
latest `auto_merge_enabled`, `auto_squash_enabled`, or `auto_rebase_enabled`
issue event. The check works from that time and its own record:

1. **Its record.** Whenever the check sees auto-merge armed on a head, it posts
   an arm marker, a PR comment whose first line is
   `<!-- pr-policy:auto-merge-armed <sha> -->`, and deletes the marker it
   supersedes. A record counts only if it was written at or after auto-merge was
   last enabled, so a record from an earlier arming that was since disabled is
   ignored. Disabling auto-merge needs no clean-up for that reason.
2. **Enabled after the push.** With no current record, auto-merge enabled
   strictly after the current head was pushed was armed on that head. The push
   time is the one the [UAT head binding](uat.md#sign-offs-are-bound-to-the-head)
   uses, from records the author can't forge. The check arms on the head and
   writes the record. A record, when there is one, wins over this rule, so a
   head moved to a commit pushed earlier elsewhere still compares.
3. **Otherwise it blocks.** Auto-merge enabled before the head was pushed, with
   no record, leaves the armed head unknown. That covers auto-merge enabled
   before this check shipped, and a run that should have written the record but
   didn't complete. Failing closed costs one disable-and-re-enable; passing
   would merge an unreviewed head.

### Why a comment, and why it can't be forged

pr-policy reads the PR through the API and never checks out its code, so the
record has to live on GitHub, written with the caller's existing
`pull-requests: write`. The alternatives were weaker:

- A **commit status** can be set by anyone with write access, using their own
  token, so it would be trivially forgeable.
- A **check-run** can't be forged by a user, but it hangs off a commit SHA,
  and finding the armed head's run once the head has moved means already
  knowing the armed SHA.

A marker is trusted only when a **bot** authored it and **nobody has edited it**
(`created_at` equals `updated_at`). A user's token can't post a comment as a
bot, and a write collaborator who edits a bot's comment moves its `updated_at`.
That is why the check posts a new marker rather than editing the old one.
Deleting a marker only fails closed. The residual risk is a workflow in the repo
posting a fake marker with `GITHUB_TOKEN`. That is a deliberate act visible in
the repo's workflows, and such a workflow could equally post a fake `pr-policy`
status.

## Same change: a patch-id over the merge-base diff

When the head has moved past the record, the check reads both heads' net change
from the compare API (`compare/<base>...<sha>`, from each head's merge base with
the base branch) and reduces each one to a fingerprint
(`src/checks/auto-merge/fingerprint.ts`), in the spirit of `git patch-id`:

- Each file contributes its status, path and old path, and its added and removed
  lines in order.
- Context lines, hunk headers with their offsets, and blob SHAs are dropped. A
  base change merged around the PR's lines moves those, but leaves the PR's own
  changed lines alone.
- A file with no patch (binary, or too large) contributes its head blob, which
  differs whenever its content does.

A merge of the base with no conflict resolution, or a pure rebase, leaves the
PR's changed lines intact, so the fingerprints match and the check re-arms at the
new head. A new edit changes those lines and blocks, and so does a conflict
resolution that changes them. A resolution that leaves every added and removed
line exactly as it was (only the surrounding base lines changed) carries the
same change, and passes.

The compare API lists at most 300 files, so a change that large can't be
fingerprinted, and a failed compare read leaves the fingerprint absent. Both
block.

## Bot-enabled auto-merge is exempt

bot-automerge enables auto-merge on Dependabot and release-please PRs with its
GitHub App's token, so `auto_merge.enabled_by` is a `Bot`. Dependabot rebases
regenerate lockfiles, so those PRs' net change legitimately moves, and
bot-automerge re-runs on `synchronize` and judges each head itself. The guard
targets a person or an agent arming auto-merge after reviewing a head. Agents
act with the user's token, so their auto-merge is enabled by a `User` and stays
guarded.

The exemption is by actor type, not by a named App, so this package names no
fleet identity. Any GitHub App installed on the repo is trusted to arm by rule.
A user can't enable auto-merge as a bot.

## Failing closed

The check is inside the required `pr-policy` verdict. A read the decision rests
on (the PR's events or comments) throws, so the run posts no verdict and the
new head has no passing `pr-policy`. A missing or stale input blocks with a
reason. A record that fails to post leaves the previous one, so a later moved
head blocks rather than passes.

The known gap: if the run that should write the record is cancelled, and the
head then moves to a commit first pushed before auto-merge was enabled, rule 2
arms on it. Both have to happen together.

## The caller triggers it needs

The check only runs when the caller does. Consumers' `pr-policy` callers must
add the two auto-merge activity types to `pull_request_target`, so that arming
records the head and disarming re-evaluates the PR:

```yaml
on:
  pull_request_target:
    types: [..., auto_merge_enabled, auto_merge_disabled]
```

Without `auto_merge_enabled`, the record is written by the next run on the same
head, if there is one before the next push. Otherwise the push blocks, failing
closed. A hosted caller subscribes to the same `pull_request` webhook actions.
See [distribution.md](../distribution.md#caller-triggers).
