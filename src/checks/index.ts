import type { PolicyCheck } from '../policy.js';
import type { RepoConfigLoad } from '../repo-config.js';
import { baseBranchCheck } from './base-branch.js';
import { ciChangeCheck } from './ci-change/index.js';
import { dependabotCheck } from './dependabot/index.js';
import { mergeBlockCheck } from './merge-block.js';
import { titleCheck } from './title/index.js';
import { uatCheck, uatCheckFor } from './uat/index.js';

/**
 * Every registered policy check, in report order. Each check lives in its own
 * module under src/checks/ and is added here; all of them report into the single
 * `pr-policy` check-run. See docs/adding-a-check.md.
 */
export const CHECKS: readonly PolicyCheck[] = [
  mergeBlockCheck,
  baseBranchCheck,
  titleCheck,
  ciChangeCheck,
  uatCheck,
  dependabotCheck,
];

/**
 * How a consuming repo tunes the suite. Neither option comes from the PR, so a
 * PR can't switch off a gate it would fail. Every option defaults to the
 * strictest policy.
 */
export interface PolicyOptions {
  /**
   * The repo's `.github/pr-policy.yml`, loaded from the PR's base branch
   * (`loadRepoConfig`). Absent means the defaults.
   */
  repoConfig?: RepoConfigLoad;
  /**
   * @deprecated Set `uat: off` in `.github/pr-policy.yml` instead. Drops the
   * UAT gate entirely, for a repo with no user-acceptance testing to wait on.
   * Kept until rmartz/pr-policy#85 removes it.
   */
  skipUat?: boolean;
}

/** The checks to run for a repo configured with `options`, in report order. */
export function selectChecks(options: PolicyOptions = {}): readonly PolicyCheck[] {
  if (options.skipUat) return CHECKS.filter((check) => check !== uatCheck);
  const { repoConfig } = options;
  if (repoConfig === undefined) return CHECKS;
  return CHECKS.map((check) => (check === uatCheck ? uatCheckFor(repoConfig) : check));
}
