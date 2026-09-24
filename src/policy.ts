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
 * The facts about a pull request that policy checks judge. Every field is a
 * property of the PR's own content — never its review history, which belongs to
 * the separate lifecycle reconciler (rmartz/ai-tools#306).
 */
export interface PullRequestFacts {
  title: string;
  labels: readonly string[];
  changedFiles: readonly string[];
  /** Both sides of every changed `.github/workflows/**` file. */
  workflowChanges: readonly FileChange[];
  /** Both sides of every changed dependency manifest (`package.json`, `requirements*.txt`). */
  manifestChanges: readonly FileChange[];
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
   * e.g. "CI loosening signed off". The first headline wins.
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
}

/**
 * A read-only classifier. It reports and plans label edits; the caller applies
 * them. It never mutates the PR itself.
 */
export interface PolicyCheck {
  name: string;
  evaluate(pr: PullRequestFacts): Promise<CheckResult>;
}
