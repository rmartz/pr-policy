/**
 * One changed file's text on both sides of the pull request. An absent side
 * means the PR added (no `baseText`) or deleted (no `headText`) the file.
 */
export interface FileChange {
  /** Repo-relative path at head (or at base, for a deletion). */
  path: string;
  /** Content at the merge base — not the base tip, so others' merges don't count. */
  baseText?: string;
  /** Content at the PR head. */
  headText?: string;
}

/**
 * A repository role, fine-grained where GitHub reports one. `none` covers a
 * non-collaborator and a lookup that failed, so an unknown actor never counts.
 */
export const REPO_PERMISSIONS = ['admin', 'maintain', 'write', 'triage', 'read', 'none'] as const;
export type RepoPermission = (typeof REPO_PERMISSIONS)[number];

/** Who last applied a label: the actor on its latest `labeled` event. */
export interface LabelActor {
  login: string;
  /** GitHub's actor type: `User`, `Bot`, `Organization`, or `Mannequin`. */
  type: string;
  permission: RepoPermission;
}

/**
 * Provenance for one sign-off label on the PR (see `SIGN_OFF_LABELS`).
 * `appliedBy` is absent when no `labeled` event names a live account.
 */
export interface SignOff {
  label: string;
  appliedBy?: LabelActor;
  /** When its latest `labeled` event happened (ISO 8601), as GitHub records it. */
  appliedAt?: string;
}

/** The account that opened a PR, as GitHub reports it (`dependabot[bot]`, `Bot`). */
export interface PullRequestAuthor {
  login: string;
  type: string;
}

/** An open PR, reduced to what the base-branch check reads. */
export interface OpenPullRequest {
  number: number;
  labels: readonly string[];
}

/** Where a PR merges: its base branch, and what that branch is. */
export interface PullRequestBase {
  /** The branch the PR merges into. */
  branch: string;
  /** The repository's default branch. */
  defaultBranch: string;
  /**
   * The open PRs whose head is `branch`. Empty for the default branch, which
   * is never looked up.
   */
  headOf: readonly OpenPullRequest[];
}

/**
 * pr-policy's own record of the head auto-merge was armed on: its latest
 * unedited arm-marker comment on the PR, written by the same bot that posted
 * pr-policy's commit status on the SHA it records.
 */
export interface ArmRecord {
  /** The head SHA the marker records. */
  sha: string;
  /** When the marker was created (ISO 8601), as GitHub records it. */
  at: string;
}

/** One PR commit's GitHub-resolved author and signature verification. */
export interface CommitAuthorship {
  /** The author's GitHub login, absent when GitHub can't link one. */
  login?: string;
  verified: boolean;
}

/**
 * The PR's native auto-merge request, present only while auto-merge is
 * enabled, plus what the `auto-merge` check needs to tell whether the change
 * has moved since it was armed.
 */
export interface AutoMergeFacts {
  /** Who enabled auto-merge, as `pull_request.auto_merge.enabled_by` reports it. */
  enabledBy: PullRequestAuthor;
  /**
   * Who authored each of the PR's commits, and whether GitHub verified its
   * signature. Gathered only when a bot enabled auto-merge, to tell whether
   * the PR holds only that bot's work.
   */
  commits?: readonly CommitAuthorship[];
  /**
   * When auto-merge was last enabled (ISO 8601): the latest `auto_*_enabled`
   * event on the PR. Absent when GitHub records none, so arming is unknown.
   */
  enabledAt?: string;
  /** The head SHA that would merge now. */
  headSha: string;
  /**
   * When the head was pushed, like `PullRequestFacts.headPushedAt` but absent
   * until the head has a check suite of its own, so a force-push event from an
   * older head can't date it. Auto-merge enabled after this armed on the head.
   */
  headPushedAt?: string;
  /** pr-policy's latest arm record, if it has written one. */
  armed?: ArmRecord;
  /**
   * The normalized net change at `armed.sha` and at `headSha` (a hash of each
   * one's merge-base diff, without hunk offsets or blob SHAs). Set only
   * when the record names a different head; absent when it couldn't be read.
   */
  armedChange?: string;
  headChange?: string;
}

/**
 * The facts about a pull request that policy checks judge. Every field is a
 * property of the PR's current state — its content and the labels on it, never
 * its review history.
 */
export interface PullRequestFacts {
  title: string;
  /**
   * The PR description. Optional so a facts document without one still parses;
   * `gatherFacts` always sets it (an empty description is `''`).
   */
  body?: string;
  /** Who opened the PR. `gatherFacts` always sets it. */
  author?: PullRequestAuthor;
  /** The branch the PR merges into. `gatherFacts` always sets it. */
  base?: PullRequestBase;
  /**
   * Whether the PR is a draft, which GitHub won't merge. `gatherFacts` always
   * sets it; absent reads as ready for review, so a WIP title fails closed.
   */
  draft?: boolean;
  labels: readonly string[];
  /** Every path the PR touches, including the old path of a rename. */
  changedFiles: readonly string[];
  /** Both sides of every changed `.github/workflows/**` file. */
  workflowChanges: readonly FileChange[];
  /** Both sides of every changed dependency manifest (`package.json`, `requirements*.txt`). */
  manifestChanges: readonly FileChange[];
  /** Who applied each sign-off label present on the PR. */
  signOffs: readonly SignOff[];
  /**
   * When the current head was pushed (ISO 8601), from times the author can't
   * forge: the latest force-push event and the head commit's earliest check
   * suite, never a commit date. `gatherFacts` sets it whenever a head-bound
   * sign-off (`UAT passed`, `no UAT needed`) is on the PR; absent, neither
   * counts.
   */
  headPushedAt?: string;
  /** The auto-merge request, present only while auto-merge is enabled. */
  autoMerge?: AutoMergeFacts;
}

/**
 * What a finding does to the `pr-policy` check-run:
 *
 * - `block` — red (`failure`). The author can fix it (a title edit, a code
 *   change), so it reads correctly as "this PR has a problem".
 * - `hold` — pending (`in_progress`). Nothing is broken; the PR is waiting on a
 *   human act, such as applying a sign-off label. Posting it red would read as a
 *   broken build and invite a fix pass that cannot clear it.
 * - `info` — listed in the summary, never gates.
 */
export const FINDING_EFFECTS = ['block', 'hold', 'info'] as const;
export type FindingEffect = (typeof FINDING_EFFECTS)[number];

/** One policy observation, attributed to the check that produced it. */
export interface Finding {
  check: string;
  message: string;
  effect: FindingEffect;
  /**
   * A short line that can stand as the check-run title when nothing gates —
   * e.g. "CI change signed off". The first headline wins.
   */
  headline?: boolean;
}

/**
 * What one check reports: its findings, plus edits to labels it owns outright.
 * A check never lists a label someone else owns.
 */
export interface CheckResult {
  findings: readonly Finding[];
  labelsToAdd?: readonly string[];
  labelsToRemove?: readonly string[];
  /**
   * A head SHA to record as the one auto-merge is armed on, written as
   * pr-policy's own marker comment (the `auto-merge` check only).
   */
  autoMergeArm?: string;
}

/**
 * A read-only classifier. It reports and plans label edits; the caller applies
 * them. It never mutates the PR itself.
 */
export interface PolicyCheck {
  name: string;
  evaluate(pr: PullRequestFacts): Promise<CheckResult>;
}
