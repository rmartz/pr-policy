/**
 * The facts about a pull request that policy checks judge. Every field is a
 * property of the PR's own content — never its review history, which belongs to
 * the separate lifecycle reconciler (rmartz/ai-tools#306). Checks that need more
 * (e.g. workflow blobs at the merge base and head) extend this as they land.
 */
export interface PullRequestFacts {
  title: string;
  labels: readonly string[];
  changedFiles: readonly string[];
}

/** One policy observation, attributed to the check that produced it. */
export interface Finding {
  check: string;
  message: string;
  /** A blocking finding turns the `pr-policy` check-run red. */
  blocking: boolean;
}

/**
 * A read-only classifier. It reports findings and never mutates the PR; label
 * writes it owns outright are planned from its result by the caller.
 */
export interface PolicyCheck {
  name: string;
  evaluate(pr: PullRequestFacts): Promise<readonly Finding[]>;
}
