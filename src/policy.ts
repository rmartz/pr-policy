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
}

/** One policy observation, attributed to the check that produced it. */
export interface Finding {
  check: string;
  message: string;
  /** A blocking finding turns the `pr-policy` check-run red. */
  blocking: boolean;
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
