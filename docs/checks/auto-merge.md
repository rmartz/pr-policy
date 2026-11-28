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
| A bot's PR, armed by a bot, holding only that bot's verified commits             | `info`   | passes this gate |
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
   ignored. Disabling auto-merge needs no clean-up for that reason. The tag is
   pinned in `src/contract.ts`, since a later release reads what an earlier one
   wrote.
2. **Enabled after the push.** With no current record, auto-merge enabled
   strictly after the current head was pushed was armed on that head. The push
   time comes from records the author can't forge, like the
   [UAT head binding](uat.md#sign-offs-are-bound-to-the-head)'s, but stricter:
   the head must have a check suite of its own, so a force-push event from an
   older head can't date a later normal push. The check arms on the head and
   writes the record. A record, when there is one, wins over this rule, so a
   head moved to a commit pushed earlier elsewhere still compares.
3. **Otherwise it blocks.** Auto-merge enabled before the head was pushed, with
   no record, leaves the armed head unknown. That covers auto-merge enabled
   before this check shipped, and a run that should have written the record but
   didn't complete. Failing closed costs one disable-and-re-enable; passing
   would merge an unreviewed head. Re-enable once CI has started on the head:
   its push time is read from its first check suite, which GitHub creates a
   moment after the push.

Rule 2 knows when auto-merge was enabled, not what the person enabling it had
reviewed: a push that lands just before arming is armed too. Arm against the
reviewed SHA so GitHub refuses a moved head:
`gh pr merge --auto --match-head-commit <sha>`, or GraphQL
`enablePullRequestAutoMerge` with `expectedHeadOid`.

### Why a comment, and why it can't be forged

pr-policy reads the PR through the API and never checks out its code, so the
record has to live on GitHub, written with the caller's existing
`pull-requests: write`. The alternatives were weaker:

- A **commit status** can be set by anyone with write access, using their own
  token, so it would be trivially forgeable.
- A **check-run** can't be forged by a user, but it hangs off a commit SHA,
  and finding the armed head's run once the head has moved means already
  knowing the armed SHA.

A marker is trusted only when all three hold:

- **A bot authored it.** A user's token can't post a comment as a bot.
- **Nobody has edited it** (`created_at` equals `updated_at`). A write
  collaborator who edits a bot's comment moves its `updated_at`, which is why
  the check posts a new marker rather than editing the old one.
- **Its author posted pr-policy's commit status on the SHA it records.** That
  ties the marker to pr-policy's identity (`github-actions[bot]` under the
  Action, the App under a hosted caller) without configuration, so another
  App, such as an assistant that echoes text a user wrote, can't plant one. A
  user can post a status, but not as that bot.

So the caller needs `statuses: write`: without it no marker is ever trusted,
and every move after arming blocks. A new marker is trusted only once the same
run posts the status after it, so re-arming keeps the previous marker as a
fallback and deletes only older ones, and only the same identity's.

**What it doesn't stop.** Under the Action, pr-policy's identity is
`github-actions[bot]`, which every workflow in the repo shares, including a
`pull_request` workflow added on the PR's own branch. Such a workflow can post
a marker for its head, which pr-policy's own status on that head then
vouches for. The `ci-change` check doesn't hold a new workflow, since adding
one is a strengthening. The same workflow could already fake the verdict
itself (a job named `pr-policy`), so this is no new exposure. The guard is
against an agent's honest mistake, not a workflow written to defeat it.

## Same change: a patch-id over the merge-base diff

When the head has moved past the record, the check reads both heads' net change
from the compare API (`compare/<base>...<sha>`, against the base SHA GitHub
reports for the PR, so each side's merge base with it) and reduces each one to
a fingerprint
(`src/checks/auto-merge/fingerprint.ts`), like `git patch-id`:

- Each file contributes its status, path and old path, and every hunk line in
  order: added, removed, context, and `\ No newline` markers, with a boundary
  between hunks.
- Hunk offsets, the header's function name, and blob SHAs are dropped. A base
  change merged elsewhere in the file moves those, but leaves the PR's hunks
  alone.
- A file with no patch (binary, or too large) contributes its head blob, which
  differs whenever its content does.

A merge of the base with no conflict resolution, or a pure rebase, leaves the
PR's hunks intact, so the fingerprints match and the check re-arms at the new
head. A new edit changes a hunk and blocks, and so does a conflict resolution
that changes one. The context lines anchor each change in place, so moving an
added line into another function blocks even with the same text. A base change
inside a hunk's context also blocks: a false block, failing closed.

What the fingerprint can't see, and so lets through:

- a file-mode-only change (the compare API reports no mode);
- a conflict resolution that leaves every hunk line exactly as it was;
- a hunk moved between two places whose context lines are identical, such as
  repeated YAML blocks.

If the PR's reported base SHA lags the branch, both sides compare against the
same stale base, which can only make the hunks differ: a false block.

The compare API lists at most 300 files, so a change that large can't be
fingerprinted, and a failed compare read leaves the fingerprint absent. Both
block. On a fork PR, the armed SHA may stop resolving in the base repo once it
is force-pushed away; that compare fails, and the PR blocks until re-armed.

## A bot's own PR, armed by a bot, is exempt

bot-automerge enables auto-merge on Dependabot and release-please PRs with its
GitHub App's token, so `auto_merge.enabled_by` is a `Bot`. Dependabot rebases
regenerate lockfiles, so those PRs' net change legitimately moves, and
bot-automerge re-runs on `synchronize` and judges each head itself. The guard
targets a person or an agent arming auto-merge after reviewing a head. Agents
act with the user's token, so their auto-merge is enabled by a `User` and stays
guarded.

The exemption needs all three:

- a bot enabled auto-merge (a user can't enable it as a bot);
- a bot opened the PR;
- every commit on the PR has that bot as its GitHub author, with a signature
  GitHub verified.

The last rule stops a person's fix pushed onto a Dependabot PR riding the bot's
auto-merge: bot-automerge trusts the PR by its author, so it would keep
auto-merge on. Requiring a verified signature stops a commit that merely claims
the bot's email. Dependabot's and bot-automerge's release-please commits are
both signed by GitHub. The rule reads actor types, not a named App, so this
package names no fleet identity, and any bot may be the enabler: an assistant
App arming a Dependabot PR is exempt too, while the commits stay the bot's own.

While a PR is exempt, no record is written. So a person pressing "Update
branch" on an armed Dependabot PR adds their own merge commit, ends the
exemption, and blocks with no record to compare against. Recording on exempt
PRs would put a marker comment on every bot PR; Dependabot rebases its own PRs,
so this is left failing closed.

## Failing closed

The check is inside the required `pr-policy` verdict. A read the decision rests
on (the PR's events, comments, commits, or the record's statuses) throws, so the
run posts no verdict and the new head has no passing `pr-policy`. A missing or
stale input blocks with a reason. A record that fails to post leaves the
previous one, so a later moved head blocks rather than passes.

Known gaps, all narrow:

- **Rule 2 and an older commit.** With no record, a head moved by a plain
  (not force) push to a commit first pushed elsewhere before auto-merge was
  enabled has an early push time, so rule 2 arms on it. A record prevents this,
  so it needs the record to be missing: a cancelled run, or a caller without
  `auto_merge_enabled` (below).
- **One-second timestamps.** GitHub's times have second resolution, so a marker
  posted in the same second auto-merge is re-enabled counts for the new
  request. A late marker from a stale run can only name an older head, which
  blocks rather than passes.

## The caller triggers it needs

The check only runs when the caller does. Consumers' `pr-policy` callers must
add the two auto-merge activity types to `pull_request_target`, so that arming
records the head and disarming re-evaluates the PR:

```yaml
on:
  pull_request_target:
    types: [..., auto_merge_enabled, auto_merge_disabled]
```

**Until a caller adds them, the guard is effectively bound to the SHA.** Arming
triggers no run, so no record is written unless another event runs the suite
on the same head first. The next push then has no record: even a clean branch
update blocks (failing closed), and the rule-2 gap above is the arming path. A
hosted caller subscribes to the same `pull_request` webhook actions.
See [distribution.md](../distribution.md#caller-triggers).
