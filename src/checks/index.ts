import type { PolicyCheck } from '../policy.js';
import { parseSignOffStatusCreators } from '../sign-off-status.js';
import { baseBranchCheck } from './base-branch.js';
import { ciChangeCheck, ciChangeCheckFor } from './ci-change/index.js';
import { dependabotCheck } from './dependabot/index.js';
import { mergeBlockCheck } from './merge-block.js';
import { titleCheck } from './title/index.js';
import { uatCheck, uatCheckFor } from './uat/index.js';
import { uatLabelCheck } from './uat-label.js';

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
 * How a consuming repo tunes the suite. The caller passes these (a CLI flag, an
 * Action input), never the PR, so a PR can't switch off a gate it would fail.
 * Every option defaults to the strictest policy.
 */
export interface PolicyOptions {
  /** Drop the UAT gate, for a repo with no user-acceptance testing to wait on. */
  skipUat?: boolean;
  /**
   * GitHub App logins (exact, ending in `[bot]`) trusted to post the
   * `pr-lifecycle/sign-off` status, besides a person who could merge. Empty by
   * default. `github-actions[bot]` is refused. Human sign-off labels are
   * unaffected: they still need a trusted person.
   */
  signOffStatusCreators?: readonly string[];
  /**
   * Hold every PR that carries no UAT label (`uat-label`, rmartz/pr-policy#103).
   * Off by default: turn it on once the repo's pr-lifecycle caller, which
   * applies the labels, is on the default branch. It runs even with `skipUat`.
   */
  requireUatLabel?: boolean;
}

/**
 * The checks to run for a repo configured with `options`, in report order.
 * The opt-in `uat-label` check is not in `CHECKS`; it runs just before
 * `dependabot` when `requireUatLabel` is set. Throws on an invalid
 * `signOffStatusCreators` entry.
 */
export function selectChecks(options: PolicyOptions = {}): readonly PolicyCheck[] {
  const trustedBots = parseSignOffStatusCreators(options.signOffStatusCreators ?? []);
  const configured =
    trustedBots.length === 0
      ? CHECKS
      : CHECKS.map((check) => {
          if (check === uatCheck) return uatCheckFor(trustedBots);
          if (check === ciChangeCheck) return ciChangeCheckFor(trustedBots);
          return check;
        });
  const selected = options.skipUat
    ? configured.filter((check) => check.name !== uatCheck.name)
    : configured;
  if (!options.requireUatLabel) return selected;
  return selected.flatMap((check) =>
    check === dependabotCheck ? [uatLabelCheck, check] : [check],
  );
}
